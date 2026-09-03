import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  findCurrentPushDestination,
  listPushDestinations,
  listSubscribedRooms,
  registerPushDestination,
  revokePushDestinationById,
  subscribeRoom,
  unregisterPushDestinationByEndpoint,
  unsubscribeRoom,
} from "../src/lib/room-notifications";

const register = (userId: string, endpoint: string) =>
  registerPushDestination(env.web_chat, {
    userId,
    endpoint,
    p256dh: "p256dh",
    auth: "auth",
    deviceLabel: "Unknown browser",
  });

const insertUser = async (id: string) => {
  await env.web_chat
    .prepare(
      "INSERT INTO user (id, name, email, email_verified) VALUES (?, 'notifications', ?, 1)",
    )
    .bind(id, `${id}@example.test`)
    .run();
};

const insertRoom = async (id: string) => {
  const now = Math.floor(Date.now() / 1000);
  await env.web_chat
    .prepare(
      "INSERT INTO room (id, name, type, userId, createdAt, lastActiveAt, deletionRequestedAt) VALUES (?, 'notifications', 'unlisted', 'owner', ?, ?, NULL)",
    )
    .bind(id, now, now)
    .run();
};

describe("room notification persistence", () => {
  it("supports Durable Object room ids and isolates account subscriptions", async () => {
    const roomId = env.ROOM.newUniqueId().toString();
    const subscriber = crypto.randomUUID();
    const otherUser = crypto.randomUUID();
    await Promise.all([
      insertRoom(roomId),
      insertUser(subscriber),
      insertUser(otherUser),
    ]);

    await subscribeRoom(env.web_chat, subscriber, roomId);
    await subscribeRoom(env.web_chat, subscriber, roomId);

    expect(await listSubscribedRooms(env.web_chat, subscriber)).toEqual([
      expect.objectContaining({ roomId, roomName: "notifications" }),
    ]);
    expect(await listSubscribedRooms(env.web_chat, otherUser)).toEqual([]);
    expect(await unsubscribeRoom(env.web_chat, otherUser, roomId)).toBe(false);
    expect(await unsubscribeRoom(env.web_chat, subscriber, roomId)).toBe(true);
  });

  it("cascades subscriptions and destinations with their owners", async () => {
    const roomId = env.ROOM.newUniqueId().toString();
    const userId = crypto.randomUUID();
    await Promise.all([insertRoom(roomId), insertUser(userId)]);
    await subscribeRoom(env.web_chat, userId, roomId);
    await register(userId, `https://push.example/${crypto.randomUUID()}`);

    await env.web_chat
      .prepare("DELETE FROM room WHERE id = ?")
      .bind(roomId)
      .run();
    expect(await listSubscribedRooms(env.web_chat, userId)).toEqual([]);

    await env.web_chat
      .prepare("DELETE FROM user WHERE id = ?")
      .bind(userId)
      .run();
    expect(await listPushDestinations(env.web_chat, userId)).toEqual([]);
  });

  it("keeps endpoint capabilities private and enforces five destinations with LRU eviction", async () => {
    const userId = crypto.randomUUID();
    await insertUser(userId);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const id = await register(
        userId,
        `https://push.example/${userId}/${index}`,
      );
      ids.push(id);
      await env.web_chat
        .prepare("UPDATE push_destination SET lastUsedAt = ? WHERE id = ?")
        .bind(index + 1, id)
        .run();
    }

    const newestId = await register(
      userId,
      `https://push.example/${userId}/new`,
    );
    const listed = await listPushDestinations(env.web_chat, userId);

    expect(listed).toHaveLength(5);
    expect(listed.some((destination) => destination.id === ids[0])).toBe(false);
    expect(listed.some((destination) => destination.id === newestId)).toBe(
      true,
    );
    expect(Object.keys(listed[0]).sort()).toEqual([
      "createdAt",
      "deviceLabel",
      "id",
      "lastUsedAt",
    ]);
  });

  it("identifies and revokes only the authenticated account's destination", async () => {
    const owner = crypto.randomUUID();
    const anotherUser = crypto.randomUUID();
    await Promise.all([insertUser(owner), insertUser(anotherUser)]);
    const endpoint = `https://push.example/${crypto.randomUUID()}`;
    const id = await register(owner, endpoint);

    expect(
      await findCurrentPushDestination(env.web_chat, owner, endpoint),
    ).toBe(id);
    expect(
      await findCurrentPushDestination(env.web_chat, anotherUser, endpoint),
    ).toBeNull();
    expect(await register(anotherUser, endpoint)).toBe(id);
    expect(
      await findCurrentPushDestination(env.web_chat, owner, endpoint),
    ).toBeNull();
    expect(await revokePushDestinationById(env.web_chat, owner, id)).toBe(
      false,
    );
    expect(
      await unregisterPushDestinationByEndpoint(env.web_chat, owner, endpoint),
    ).toBe(false);
    expect(
      await unregisterPushDestinationByEndpoint(
        env.web_chat,
        anotherUser,
        endpoint,
      ),
    ).toBe(true);
  });
});
