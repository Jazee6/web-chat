const DAY_SECONDS = 24 * 60 * 60;
const RECLAIM_CLAIM_SECONDS = 60 * 60;
const RESERVATION_RECONCILE_SECONDS = DAY_SECONDS;
const MAINTENANCE_ID = 1;

type LifecycleEnv = Pick<Cloudflare.Env, "web_chat" | "FILE" | "ROOM">;

export interface BackfillMessage {
  id: string;
  userId: string;
  submissionId: string | null;
  content: string;
  createdAt: Date;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const retentionId = (
  roomId: string,
  userId: string,
  submissionId: string,
  position: number,
) => `submission:${roomId}:${userId}:${submissionId}:${position}`;

const legacyRetentionId = (
  roomId: string,
  messageId: string,
  position: number,
) => `message:${roomId}:${messageId}:${position}`;

const placeholders = (length: number) => Array(length).fill("?").join(", ");

export const parseImageKeys = (content: string): string[] => {
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string")) {
    throw new Error("Invalid image content");
  }
  return parsed;
};

export async function registerImageCandidates(
  env: LifecycleEnv,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const now = nowSeconds();
  await env.web_chat.batch(
    keys.map((key) =>
      env.web_chat
        .prepare(
          "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO NOTHING",
        )
        .bind(key, now, now),
    ),
  );
  const rows = await env.web_chat
    .prepare(
      `SELECT key FROM image_asset WHERE key IN (${placeholders(keys.length)}) AND reclaimingAt IS NOT NULL`,
    )
    .bind(...keys)
    .all<{ key: string }>();
  if (rows.results.length > 0) {
    throw new Error("Image reclamation is in progress");
  }
}

export type ReservationResult = "reserved" | "missing" | "conflict";

export async function reserveImageAssets(
  env: LifecycleEnv,
  input: {
    roomId: string;
    userId: string;
    submissionId: string;
    keys: string[];
  },
): Promise<ReservationResult> {
  const objects = await Promise.all(
    input.keys.map((key) => env.FILE.head(`images/${key}`)),
  );
  if (objects.some((object) => object === null)) return "missing";

  const now = nowSeconds();
  const ids = input.keys.map((_, position) =>
    retentionId(input.roomId, input.userId, input.submissionId, position),
  );
  const statements: D1PreparedStatement[] = [];
  input.keys.forEach((key, position) => {
    statements.push(
      env.web_chat
        .prepare(
          "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, NULL, NULL) ON CONFLICT(key) DO UPDATE SET unreferencedAt = NULL WHERE image_asset.reclaimingAt IS NULL",
        )
        .bind(key, now),
      env.web_chat
        .prepare(
          "INSERT INTO image_retention (id, key, roomId, userId, submissionId, messageId, position, createdAt) SELECT ?, ?, room.id, ?, ?, NULL, ?, ? FROM room JOIN image_asset ON image_asset.key = ? WHERE room.id = ? AND room.deletionRequestedAt IS NULL AND image_asset.reclaimingAt IS NULL ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          ids[position],
          key,
          input.userId,
          input.submissionId,
          position,
          now,
          key,
          input.roomId,
        ),
    );
  });
  await env.web_chat.batch(statements);

  const rows = await env.web_chat
    .prepare(
      `SELECT id, key FROM image_retention WHERE id IN (${placeholders(ids.length)})`,
    )
    .bind(...ids)
    .all<{ id: string; key: string }>();
  if (rows.results.length !== ids.length) return "missing";
  const byId = new Map(rows.results.map((row) => [row.id, row.key]));
  return ids.every((id, position) => byId.get(id) === input.keys[position])
    ? "reserved"
    : "conflict";
}

export async function promoteImageReservations(
  env: LifecycleEnv,
  input: {
    roomId: string;
    userId: string;
    submissionId: string;
    messageId: string;
    imageCount: number;
  },
): Promise<boolean> {
  const ids = Array.from({ length: input.imageCount }, (_, position) =>
    retentionId(input.roomId, input.userId, input.submissionId, position),
  );
  await env.web_chat.batch(
    ids.map((id) =>
      env.web_chat
        .prepare(
          "UPDATE image_retention SET messageId = ? WHERE id = ? AND (messageId IS NULL OR messageId = ?)",
        )
        .bind(input.messageId, id, input.messageId),
    ),
  );
  const row = await env.web_chat
    .prepare(
      `SELECT COUNT(*) AS count FROM image_retention WHERE id IN (${placeholders(ids.length)}) AND messageId = ?`,
    )
    .bind(...ids, input.messageId)
    .first<{ count: number }>();
  return row?.count === ids.length;
}

export async function backfillMessageImages(
  env: LifecycleEnv,
  roomId: string,
  messages: BackfillMessage[],
): Promise<void> {
  const now = nowSeconds();
  for (const message of messages) {
    const keys = parseImageKeys(message.content);
    const statements: D1PreparedStatement[] = [];
    keys.forEach((key, position) => {
      const id = message.submissionId
        ? retentionId(roomId, message.userId, message.submissionId, position)
        : legacyRetentionId(roomId, message.id, position);
      statements.push(
        env.web_chat
          .prepare(
            "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, NULL, NULL) ON CONFLICT(key) DO UPDATE SET unreferencedAt = NULL WHERE image_asset.reclaimingAt IS NULL",
          )
          .bind(key, Math.floor(message.createdAt.getTime() / 1000)),
        env.web_chat
          .prepare(
            "INSERT INTO image_retention (id, key, roomId, userId, submissionId, messageId, position, createdAt) SELECT ?, ?, room.id, ?, ?, ?, ?, ? FROM room JOIN image_asset ON image_asset.key = ? WHERE room.id = ? AND image_asset.reclaimingAt IS NULL ON CONFLICT(id) DO UPDATE SET messageId = excluded.messageId",
          )
          .bind(
            id,
            key,
            message.userId,
            message.submissionId,
            message.id,
            position,
            Math.floor(message.createdAt.getTime() / 1000) || now,
            key,
            roomId,
          ),
      );
    });
    if (statements.length > 0) await env.web_chat.batch(statements);
  }
}

async function markAssetsUnreferenced(
  env: LifecycleEnv,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const now = nowSeconds();
  await env.web_chat.batch(
    [...new Set(keys)].map((key) =>
      env.web_chat
        .prepare(
          "UPDATE image_asset SET unreferencedAt = ?, reclaimingAt = NULL WHERE key = ? AND NOT EXISTS (SELECT 1 FROM image_retention WHERE image_retention.key = image_asset.key) AND NOT EXISTS (SELECT 1 FROM sticker WHERE sticker.key = image_asset.key)",
        )
        .bind(now, key),
    ),
  );
}

async function repairUnreferencedAssets(env: LifecycleEnv): Promise<void> {
  const rows = await env.web_chat
    .prepare(
      "SELECT key FROM image_asset WHERE unreferencedAt IS NULL AND reclaimingAt IS NULL AND NOT EXISTS (SELECT 1 FROM image_retention WHERE image_retention.key = image_asset.key) AND NOT EXISTS (SELECT 1 FROM sticker WHERE sticker.key = image_asset.key) LIMIT 100",
    )
    .all<{ key: string }>();
  await markAssetsUnreferenced(
    env,
    rows.results.map((row) => row.key),
  );
}

export async function completeRoomDeletion(
  env: LifecycleEnv,
  roomId: string,
): Promise<void> {
  const keys = await env.web_chat
    .prepare("SELECT DISTINCT key FROM image_retention WHERE roomId = ?")
    .bind(roomId)
    .all<{ key: string }>();
  const stub = env.ROOM.get(env.ROOM.idFromString(roomId));
  await stub.clearStorage();
  await env.web_chat
    .prepare(
      "DELETE FROM room WHERE id = ? AND deletionRequestedAt IS NOT NULL",
    )
    .bind(roomId)
    .run();
  await markAssetsUnreferenced(
    env,
    keys.results.map((row) => row.key),
  );
}

async function ensureMaintenanceState(env: LifecycleEnv): Promise<void> {
  await env.web_chat
    .prepare(
      "INSERT INTO maintenance_state (id, imageBackfillRoomsComplete, imageBackfillR2Complete) VALUES (?, 0, 0) ON CONFLICT(id) DO NOTHING",
    )
    .bind(MAINTENANCE_ID)
    .run();
}

async function backfillRooms(env: LifecycleEnv): Promise<void> {
  const state = await env.web_chat
    .prepare(
      "SELECT imageBackfillRoomCursor AS cursor, imageBackfillRoomsComplete AS complete FROM maintenance_state WHERE id = ?",
    )
    .bind(MAINTENANCE_ID)
    .first<{ cursor: string | null; complete: number }>();
  if (state?.complete) return;
  const rows = await env.web_chat
    .prepare(
      "SELECT id FROM room WHERE id > COALESCE(?, '') ORDER BY id LIMIT 10",
    )
    .bind(state?.cursor ?? null)
    .all<{ id: string }>();
  for (const row of rows.results) {
    const stub = env.ROOM.get(env.ROOM.idFromString(row.id));
    try {
      await stub.backfillImageRetentions();
    } catch (error) {
      console.error("Failed to backfill room image references", row.id, error);
      throw error;
    }
  }
  const last = rows.results.at(-1)?.id;
  await env.web_chat
    .prepare(
      "UPDATE maintenance_state SET imageBackfillRoomCursor = COALESCE(?, imageBackfillRoomCursor), imageBackfillRoomsComplete = ? WHERE id = ?",
    )
    .bind(last ?? null, rows.results.length < 10 ? 1 : 0, MAINTENANCE_ID)
    .run();
}

async function backfillR2(env: LifecycleEnv): Promise<void> {
  const state = await env.web_chat
    .prepare(
      "SELECT imageBackfillR2Cursor AS cursor, imageBackfillR2Complete AS complete FROM maintenance_state WHERE id = ?",
    )
    .bind(MAINTENANCE_ID)
    .first<{ cursor: string | null; complete: number }>();
  if (state?.complete) return;
  const listed = await env.FILE.list({
    prefix: "images/",
    limit: 100,
    ...(state?.cursor ? { cursor: state.cursor } : {}),
  });
  if (listed.objects.length > 0) {
    await env.web_chat.batch(
      listed.objects.map((object) => {
        const key = object.key.slice("images/".length);
        const uploaded = Math.floor(object.uploaded.getTime() / 1000);
        return env.web_chat
          .prepare(
            "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO NOTHING",
          )
          .bind(key, uploaded, uploaded);
      }),
    );
  }
  await env.web_chat
    .prepare(
      "UPDATE maintenance_state SET imageBackfillR2Cursor = ?, imageBackfillR2Complete = ? WHERE id = ?",
    )
    .bind(
      listed.truncated ? listed.cursor : null,
      listed.truncated ? 0 : 1,
      MAINTENANCE_ID,
    )
    .run();
}

async function finishBackfill(env: LifecycleEnv): Promise<void> {
  const state = await env.web_chat
    .prepare(
      "SELECT imageBackfillRoomsComplete AS roomsComplete, imageBackfillR2Complete AS r2Complete, imageBackfillCompletedAt AS completedAt FROM maintenance_state WHERE id = ?",
    )
    .bind(MAINTENANCE_ID)
    .first<{
      roomsComplete: number;
      r2Complete: number;
      completedAt: number | null;
    }>();
  if (!state?.roomsComplete || !state.r2Complete || state.completedAt) return;
  const now = nowSeconds();
  await env.web_chat
    .prepare(
      "UPDATE maintenance_state SET imageBackfillCompletedAt = ?, imageReclamationReadyAt = ? WHERE id = ? AND imageBackfillCompletedAt IS NULL",
    )
    .bind(now, now + DAY_SECONDS, MAINTENANCE_ID)
    .run();
}

async function reconcileReservations(env: LifecycleEnv): Promise<void> {
  const cutoff = nowSeconds() - RESERVATION_RECONCILE_SECONDS;
  const rows = await env.web_chat
    .prepare(
      "SELECT id, key, roomId, userId, submissionId FROM image_retention WHERE messageId IS NULL AND submissionId IS NOT NULL AND createdAt <= ? LIMIT 20",
    )
    .bind(cutoff)
    .all<{
      id: string;
      key: string;
      roomId: string;
      userId: string;
      submissionId: string;
    }>();
  for (const row of rows.results) {
    const stub = env.ROOM.get(env.ROOM.idFromString(row.roomId));
    const messageId = await stub.findImageMessageBySubmission(
      row.userId,
      row.submissionId,
    );
    if (messageId) {
      await env.web_chat
        .prepare("UPDATE image_retention SET messageId = ? WHERE id = ?")
        .bind(messageId, row.id)
        .run();
      continue;
    }
    await env.web_chat
      .prepare("DELETE FROM image_retention WHERE id = ? AND messageId IS NULL")
      .bind(row.id)
      .run();
    await markAssetsUnreferenced(env, [row.key]);
  }
}

async function reclaimImages(env: LifecycleEnv): Promise<void> {
  const now = nowSeconds();
  const ready = await env.web_chat
    .prepare(
      "SELECT 1 AS ready FROM maintenance_state WHERE id = ? AND imageReclamationReadyAt <= ?",
    )
    .bind(MAINTENANCE_ID, now)
    .first<{ ready: number }>();
  if (!ready) return;

  const claimed = await env.web_chat
    .prepare(
      "SELECT key, reclaimingAt FROM image_asset WHERE reclaimingAt IS NOT NULL AND reclaimingAt <= ? LIMIT 50",
    )
    .bind(now - RECLAIM_CLAIM_SECONDS)
    .all<{ key: string; reclaimingAt: number }>();
  for (const row of claimed.results) {
    const retained = await env.web_chat
      .prepare(
        "SELECT 1 AS retained FROM image_retention WHERE key = ? UNION ALL SELECT 1 AS retained FROM sticker WHERE key = ? LIMIT 1",
      )
      .bind(row.key, row.key)
      .first<{ retained: number }>();
    if (retained) {
      await env.web_chat
        .prepare(
          "UPDATE image_asset SET unreferencedAt = NULL, reclaimingAt = NULL WHERE key = ?",
        )
        .bind(row.key)
        .run();
      continue;
    }
    await env.FILE.delete(`images/${row.key}`);
    await env.web_chat
      .prepare(
        "DELETE FROM image_asset WHERE key = ? AND reclaimingAt = ? AND NOT EXISTS (SELECT 1 FROM image_retention WHERE image_retention.key = image_asset.key) AND NOT EXISTS (SELECT 1 FROM sticker WHERE sticker.key = image_asset.key)",
      )
      .bind(row.key, row.reclaimingAt)
      .run();
  }

  const cutoff = now - DAY_SECONDS;
  const candidates = await env.web_chat
    .prepare(
      "SELECT key FROM image_asset WHERE unreferencedAt <= ? AND reclaimingAt IS NULL AND NOT EXISTS (SELECT 1 FROM image_retention WHERE image_retention.key = image_asset.key) AND NOT EXISTS (SELECT 1 FROM sticker WHERE sticker.key = image_asset.key) LIMIT 50",
    )
    .bind(cutoff)
    .all<{ key: string }>();
  if (candidates.results.length > 0) {
    await env.web_chat.batch(
      candidates.results.map((row) =>
        env.web_chat
          .prepare(
            "UPDATE image_asset SET reclaimingAt = ? WHERE key = ? AND reclaimingAt IS NULL AND NOT EXISTS (SELECT 1 FROM image_retention WHERE image_retention.key = image_asset.key) AND NOT EXISTS (SELECT 1 FROM sticker WHERE sticker.key = image_asset.key)",
          )
          .bind(now, row.key),
      ),
    );
  }
}

async function resumeRoomDeletions(env: LifecycleEnv): Promise<void> {
  const rows = await env.web_chat
    .prepare(
      "SELECT id, createdAt, deletionReason FROM room WHERE deletionRequestedAt IS NOT NULL ORDER BY deletionRequestedAt LIMIT 10",
    )
    .all<{
      id: string;
      createdAt: number;
      deletionReason: "owner" | "expiration" | null;
    }>();
  for (const row of rows.results) {
    try {
      if (row.deletionReason === "expiration") {
        const cutoff = new Date(Date.now() - 30 * DAY_SECONDS * 1000);
        const stub = env.ROOM.get(env.ROOM.idFromString(row.id));
        const expired = await stub.beginExpiration(
          cutoff,
          new Date(row.createdAt * 1000),
        );
        if (!expired) {
          const latest = await stub.getLatestActivity();
          await env.web_chat
            .prepare(
              "UPDATE room SET deletionRequestedAt = NULL, deletionReason = NULL, lastActiveAt = MAX(lastActiveAt, COALESCE(?, lastActiveAt)) WHERE id = ? AND deletionReason = 'expiration'",
            )
            .bind(latest ? Math.floor(latest.getTime() / 1000) : null, row.id)
            .run();
          continue;
        }
      }
      await completeRoomDeletion(env, row.id);
    } catch (error) {
      console.error("Failed to resume Room Deletion", row.id, error);
    }
  }
}

async function expireRooms(env: LifecycleEnv): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * DAY_SECONDS * 1000);
  const rows = await env.web_chat
    .prepare(
      "SELECT id, createdAt FROM room WHERE deletionRequestedAt IS NULL AND lastActiveAt <= ? ORDER BY lastActiveAt LIMIT 10",
    )
    .bind(Math.floor(cutoff.getTime() / 1000))
    .all<{ id: string; createdAt: number }>();
  for (const row of rows.results) {
    const requested = await env.web_chat
      .prepare(
        "UPDATE room SET deletionRequestedAt = ?, deletionReason = 'expiration' WHERE id = ? AND deletionRequestedAt IS NULL RETURNING id",
      )
      .bind(nowSeconds(), row.id)
      .first<{ id: string }>();
    if (!requested) continue;
    const stub = env.ROOM.get(env.ROOM.idFromString(row.id));
    const expired = await stub.beginExpiration(
      cutoff,
      new Date(row.createdAt * 1000),
    );
    if (!expired) {
      const latest = await stub.getLatestActivity();
      await env.web_chat
        .prepare(
          "UPDATE room SET deletionRequestedAt = NULL, deletionReason = NULL, lastActiveAt = MAX(lastActiveAt, COALESCE(?, lastActiveAt)) WHERE id = ? AND deletionReason = 'expiration'",
        )
        .bind(latest ? Math.floor(latest.getTime() / 1000) : null, row.id)
        .run();
      continue;
    }
    await completeRoomDeletion(env, row.id);
  }
}

export async function runMaintenance(env: LifecycleEnv): Promise<void> {
  await ensureMaintenanceState(env);
  const steps: [string, () => Promise<void>][] = [
    ["resume room deletions", () => resumeRoomDeletions(env)],
    ["expire rooms", () => expireRooms(env)],
    ["backfill room images", () => backfillRooms(env)],
    ["backfill R2 images", () => backfillR2(env)],
    ["finish image backfill", () => finishBackfill(env)],
    ["reconcile image reservations", () => reconcileReservations(env)],
    ["repair unreferenced images", () => repairUnreferencedAssets(env)],
    ["reclaim images", () => reclaimImages(env)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(`Maintenance step failed: ${name}`, error);
    }
  }
}

export async function markStickerRemoved(
  env: LifecycleEnv,
  key: string,
): Promise<void> {
  await markAssetsUnreferenced(env, [key]);
}
