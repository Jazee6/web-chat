import { and, asc, desc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { PushDestinationInfo, RoomSubscription } from "web-chat-share";
import webpush from "web-push";
import { parseImageKeys } from "./image-lifecycle";
import * as d1Schema from "./schema/d1";
import {
  pushDestinationTable,
  roomNotificationSubscriptionTable,
  roomTable,
} from "./schema/d1";

export const MAX_DESTINATIONS_PER_USER = 5;
export const NOTIFICATION_BATCH_SIZE = 40;
export const NOTIFICATION_EXPIRY_MS = 5 * 60 * 1000;

export interface NotificationQueuePayload {
  type: "fanout_page";
  roomId: string;
  messageId: string;
  senderId: string;
  messageType: "text" | "image";
  content: string;
  createdAt: number;
  cursor?: string;
}

export function isEligibleForNotification(message: {
  authorType: string;
  type: string;
}): boolean {
  return (
    message.authorType === "user" &&
    (message.type === "text" || message.type === "image")
  );
}

export function isExpiredJob(createdAt: number, now = Date.now()): boolean {
  return now - createdAt > NOTIFICATION_EXPIRY_MS;
}

export function notificationTopic(roomId: string): string {
  return roomId.replace(/[^A-Za-z0-9_-]/g, "").slice(-32);
}

export function remainingNotificationTtl(
  createdAt: number,
  now = Date.now(),
): number {
  return Math.max(
    0,
    Math.ceil((createdAt + NOTIFICATION_EXPIRY_MS - now) / 1000),
  );
}

export function isPermanentPushFailure(statusCode: unknown): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function notificationPage<Row extends { id: string }>(
  rows: Row[],
): {
  destinations: Row[];
  nextCursor?: string;
} {
  const destinations = rows.slice(0, NOTIFICATION_BATCH_SIZE);
  return {
    destinations,
    nextCursor:
      rows.length > NOTIFICATION_BATCH_SIZE
        ? destinations[destinations.length - 1]?.id
        : undefined,
  };
}

export class RoomVisibilityTracker<Socket> {
  private readonly visibleSocketsByUser = new Map<string, Set<Socket>>();

  set(userId: string, socket: Socket, visible: boolean): void {
    const sockets = this.visibleSocketsByUser.get(userId);
    if (!visible) {
      sockets?.delete(socket);
      if (sockets?.size === 0) this.visibleSocketsByUser.delete(userId);
      return;
    }

    if (sockets) {
      sockets.add(socket);
      return;
    }
    this.visibleSocketsByUser.set(userId, new Set([socket]));
  }

  remove(userId: string, socket: Socket): void {
    this.set(userId, socket, false);
  }

  getVisibleUsers(userIds: string[]): string[] {
    return userIds.filter(
      (userId) => (this.visibleSocketsByUser.get(userId)?.size ?? 0) > 0,
    );
  }

  clear(): void {
    this.visibleSocketsByUser.clear();
  }
}

export function formatNotificationPreview(
  messageType: "text" | "image",
  content: string,
): string {
  if (messageType === "text") {
    const trimmed = content.trim();
    if (trimmed.length <= 200) return trimmed;
    return `${trimmed.slice(0, 197)}...`;
  }

  try {
    const keys = parseImageKeys(content);
    if (keys.length > 1) {
      return `[图片] x ${keys.length}`;
    }
    return "[图片]";
  } catch {
    return "[图片]";
  }
}

export function formatNotificationPayload(options: {
  roomName: string;
  senderName: string;
  messageType: "text" | "image";
  content: string;
  roomId: string;
  messageId: string;
  createdAt: number;
}): string {
  const preview = formatNotificationPreview(
    options.messageType,
    options.content,
  );
  return JSON.stringify({
    title: options.roomName,
    body: `${options.senderName}: ${preview}`,
    tag: `room:${options.roomId}`,
    data: {
      roomId: options.roomId,
      messageId: options.messageId,
      url: `/room/${options.roomId}`,
    },
    icon: "/icon-192.png",
    badge: "/icon.svg",
    timestamp: options.createdAt,
  });
}

export async function registerPushDestination(
  d1: D1Database,
  params: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceLabel: string;
  },
): Promise<string> {
  const db = drizzle(d1, { schema: d1Schema });

  const existing = await db.query.pushDestinationTable.findFirst({
    where: eq(pushDestinationTable.endpoint, params.endpoint),
  });

  const now = new Date();

  if (existing?.userId === params.userId) {
    await db
      .update(pushDestinationTable)
      .set({
        p256dh: params.p256dh,
        auth: params.auth,
        deviceLabel: params.deviceLabel,
        lastUsedAt: now,
      })
      .where(eq(pushDestinationTable.id, existing.id));
    return existing.id;
  }

  const inserted = await db
    .insert(pushDestinationTable)
    .values({
      userId: params.userId,
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
      deviceLabel: params.deviceLabel,
      createdAt: now,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: pushDestinationTable.endpoint,
      set: {
        userId: params.userId,
        p256dh: params.p256dh,
        auth: params.auth,
        deviceLabel: params.deviceLabel,
        createdAt: now,
        lastUsedAt: now,
      },
    })
    .returning({ id: pushDestinationTable.id });

  const userDestinations = await db.query.pushDestinationTable.findMany({
    columns: { id: true },
    where: eq(pushDestinationTable.userId, params.userId),
    orderBy: [
      asc(pushDestinationTable.lastUsedAt),
      asc(pushDestinationTable.id),
    ],
  });
  const excess = userDestinations.length - MAX_DESTINATIONS_PER_USER;
  if (excess > 0) {
    await db.delete(pushDestinationTable).where(
      inArray(
        pushDestinationTable.id,
        userDestinations.slice(0, excess).map(({ id }) => id),
      ),
    );
  }

  return inserted[0].id;
}

export async function unregisterPushDestinationByEndpoint(
  d1: D1Database,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const db = drizzle(d1, { schema: d1Schema });
  const result = await db
    .delete(pushDestinationTable)
    .where(
      and(
        eq(pushDestinationTable.userId, userId),
        eq(pushDestinationTable.endpoint, endpoint),
      ),
    )
    .returning({ id: pushDestinationTable.id });
  return result.length > 0;
}

export async function findCurrentPushDestination(
  d1: D1Database,
  userId: string,
  endpoint: string,
): Promise<string | null> {
  const db = drizzle(d1, { schema: d1Schema });
  const destination = await db.query.pushDestinationTable.findFirst({
    columns: { id: true },
    where: and(
      eq(pushDestinationTable.userId, userId),
      eq(pushDestinationTable.endpoint, endpoint),
    ),
  });
  return destination?.id ?? null;
}

export async function revokePushDestinationById(
  d1: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const db = drizzle(d1, { schema: d1Schema });
  const result = await db
    .delete(pushDestinationTable)
    .where(
      and(
        eq(pushDestinationTable.id, id),
        eq(pushDestinationTable.userId, userId),
      ),
    )
    .returning({ id: pushDestinationTable.id });
  return result.length > 0;
}

export async function listPushDestinations(
  d1: D1Database,
  userId: string,
): Promise<PushDestinationInfo[]> {
  const db = drizzle(d1, { schema: d1Schema });
  const rows = await db.query.pushDestinationTable.findMany({
    columns: {
      id: true,
      deviceLabel: true,
      createdAt: true,
      lastUsedAt: true,
    },
    where: eq(pushDestinationTable.userId, userId),
    orderBy: desc(pushDestinationTable.lastUsedAt),
  });

  return rows.map((r) => ({
    id: r.id,
    deviceLabel: r.deviceLabel,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt.toISOString(),
  }));
}

export async function subscribeRoom(
  d1: D1Database,
  userId: string,
  roomId: string,
): Promise<void> {
  const db = drizzle(d1, { schema: d1Schema });
  const room = await db.query.roomTable.findFirst({
    columns: { id: true },
    where: and(eq(roomTable.id, roomId), isNull(roomTable.deletionRequestedAt)),
  });
  if (!room) {
    throw new Error("Room not found");
  }

  await db
    .insert(roomNotificationSubscriptionTable)
    .values({
      userId,
      roomId,
    })
    .onConflictDoNothing();
}

export async function unsubscribeRoom(
  d1: D1Database,
  userId: string,
  roomId: string,
): Promise<boolean> {
  const db = drizzle(d1, { schema: d1Schema });
  const result = await db
    .delete(roomNotificationSubscriptionTable)
    .where(
      and(
        eq(roomNotificationSubscriptionTable.userId, userId),
        eq(roomNotificationSubscriptionTable.roomId, roomId),
      ),
    )
    .returning({ id: roomNotificationSubscriptionTable.id });
  return result.length > 0;
}

export async function listSubscribedRooms(
  d1: D1Database,
  userId: string,
): Promise<RoomSubscription[]> {
  const db = drizzle(d1, { schema: d1Schema });
  const rows = await db
    .select({
      id: roomNotificationSubscriptionTable.id,
      roomId: roomNotificationSubscriptionTable.roomId,
      roomName: roomTable.name,
      createdAt: roomNotificationSubscriptionTable.createdAt,
    })
    .from(roomNotificationSubscriptionTable)
    .innerJoin(
      roomTable,
      and(
        eq(roomNotificationSubscriptionTable.roomId, roomTable.id),
        isNull(roomTable.deletionRequestedAt),
      ),
    )
    .where(eq(roomNotificationSubscriptionTable.userId, userId))
    .orderBy(desc(roomNotificationSubscriptionTable.createdAt));

  return rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    roomName: r.roomName,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function processNotificationQueueBatch(
  batch: MessageBatch<NotificationQueuePayload>,
  env: CloudflareBindings,
): Promise<void> {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey =
    env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
  const vapidSubject =
    env.VAPID_SUBJECT ||
    process.env.VAPID_SUBJECT ||
    "mailto:admin@chat.jaze.top";

  const hasVapid = Boolean(vapidPublicKey && vapidPrivateKey);

  for (const message of batch.messages) {
    try {
      const payload = message.body;
      const ttl = remainingNotificationTtl(payload.createdAt);
      if (isExpiredJob(payload.createdAt) || ttl === 0) {
        message.ack();
        continue;
      }

      if (!hasVapid) {
        console.warn(
          "VAPID credentials missing; dropping notification queue job",
        );
        message.ack();
        continue;
      }

      const db = drizzle(env.web_chat, { schema: d1Schema });

      const room = await db.query.roomTable.findFirst({
        columns: { name: true, deletionRequestedAt: true },
        where: eq(roomTable.id, payload.roomId),
      });

      if (!room || room.deletionRequestedAt) {
        message.ack();
        continue;
      }

      const queryLimit = NOTIFICATION_BATCH_SIZE + 1;
      const messageCreatedAt = new Date(payload.createdAt);
      const subscriptionExisted = lt(
        roomNotificationSubscriptionTable.createdAt,
        messageCreatedAt,
      );
      const destinationExisted = lt(
        pushDestinationTable.createdAt,
        messageCreatedAt,
      );
      const baseQuery = db
        .select({
          id: pushDestinationTable.id,
          userId: pushDestinationTable.userId,
          endpoint: pushDestinationTable.endpoint,
          p256dh: pushDestinationTable.p256dh,
          auth: pushDestinationTable.auth,
        })
        .from(pushDestinationTable)
        .innerJoin(
          roomNotificationSubscriptionTable,
          eq(
            pushDestinationTable.userId,
            roomNotificationSubscriptionTable.userId,
          ),
        )
        .where(
          and(
            eq(roomNotificationSubscriptionTable.roomId, payload.roomId),
            ne(pushDestinationTable.userId, payload.senderId),
            subscriptionExisted,
            destinationExisted,
            payload.cursor
              ? gt(pushDestinationTable.id, payload.cursor)
              : undefined,
          ),
        )
        .orderBy(asc(pushDestinationTable.id))
        .limit(queryLimit);

      const rows = await baseQuery;

      if (rows.length === 0) {
        message.ack();
        continue;
      }

      const { destinations: currentBatch, nextCursor } = notificationPage(rows);

      if (nextCursor && env.NOTIFICATION_QUEUE) {
        await env.NOTIFICATION_QUEUE.send({
          ...payload,
          cursor: nextCursor,
        });
      }

      // Check room visibility with Room DO
      const targetUserIds = Array.from(
        new Set(currentBatch.map((d) => d.userId)),
      );
      let visibleUserSet = new Set<string>();
      try {
        const roomStub = env.ROOM.get(env.ROOM.idFromString(payload.roomId));
        const visibleUsers = await roomStub.getVisibleUsers(targetUserIds);
        visibleUserSet = new Set(visibleUsers);
      } catch (err) {
        console.error("Failed to check room visibility with DO", err);
        message.ack();
        continue;
      }

      // Filter out destinations where recipient has room visible
      const eligibleDestinations = currentBatch.filter(
        (dest) => !visibleUserSet.has(dest.userId),
      );

      if (eligibleDestinations.length > 0) {
        // Fetch sender name
        const sender = await env.web_chat
          .prepare("SELECT name FROM user WHERE id = ?")
          .bind(payload.senderId)
          .first<{ name: string }>();

        const senderName = sender?.name ?? "Someone";
        const pushPayload = formatNotificationPayload({
          roomName: room.name,
          senderName,
          messageType: payload.messageType,
          content: payload.content,
          roomId: payload.roomId,
          messageId: payload.messageId,
          createdAt: payload.createdAt,
        });

        webpush.setVapidDetails(
          vapidSubject,
          vapidPublicKey!,
          vapidPrivateKey!,
        );

        const deadEndpointIds: string[] = [];
        const successIds: string[] = [];

        await Promise.allSettled(
          eligibleDestinations.map(async (dest) => {
            try {
              await webpush.sendNotification(
                {
                  endpoint: dest.endpoint,
                  keys: {
                    p256dh: dest.p256dh,
                    auth: dest.auth,
                  },
                },
                pushPayload,
                {
                  TTL: ttl,
                  topic: notificationTopic(payload.roomId),
                  urgency: "normal",
                },
              );
              successIds.push(dest.id);
            } catch (err: any) {
              const statusCode = err?.statusCode;
              if (isPermanentPushFailure(statusCode)) {
                deadEndpointIds.push(dest.id);
              }
              // Transient failures are not retried (ADR 0017)
            }
          }),
        );

        if (deadEndpointIds.length > 0) {
          await db
            .delete(pushDestinationTable)
            .where(inArray(pushDestinationTable.id, deadEndpointIds));
        }

        if (successIds.length > 0) {
          await db
            .update(pushDestinationTable)
            .set({ lastUsedAt: new Date() })
            .where(inArray(pushDestinationTable.id, successIds));
        }
      }

      message.ack();
    } catch (err) {
      console.error("Error processing notification queue message", err);
      // We acknowledge the message to avoid poison pill loops in queues without business retry
      message.ack();
    }
  }
}
