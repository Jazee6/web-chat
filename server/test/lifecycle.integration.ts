import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Room } from "../src/do/room";
import {
  completeRoomDeletion,
  promoteImageReservations,
  reserveImageAssets,
  runMaintenance,
} from "../src/lib/image-lifecycle";

const insertRoom = async (id: string, createdAt = new Date()) => {
  const seconds = Math.floor(createdAt.getTime() / 1000);
  await env.web_chat
    .prepare(
      "INSERT INTO room (id, name, type, userId, createdAt, lastActiveAt, deletionRequestedAt) VALUES (?, 'test', 'unlisted', 'owner', ?, ?, NULL)",
    )
    .bind(id, seconds, seconds)
    .run();
};

describe("image lifecycle", () => {
  it("protects every image position before promotion", async () => {
    const id = env.ROOM.newUniqueId();
    const roomId = id.toString();
    const key = "a".repeat(43);
    await insertRoom(roomId);
    await env.FILE.put(`images/${key}`, "image");

    await expect(
      reserveImageAssets(env, {
        roomId,
        userId: "user",
        submissionId: "submission",
        keys: [key, key],
      }),
    ).resolves.toBe("reserved");

    const reserved = await env.web_chat
      .prepare(
        "SELECT position, messageId FROM image_retention WHERE roomId = ? ORDER BY position",
      )
      .bind(roomId)
      .all<{ position: number; messageId: string | null }>();
    expect(reserved.results).toEqual([
      { position: 0, messageId: null },
      { position: 1, messageId: null },
    ]);

    await expect(
      promoteImageReservations(env, {
        roomId,
        userId: "user",
        submissionId: "submission",
        messageId: "message",
        imageCount: 2,
      }),
    ).resolves.toBe(true);
    const promoted = await env.web_chat
      .prepare(
        "SELECT COUNT(*) AS count FROM image_retention WHERE roomId = ? AND messageId = 'message'",
      )
      .bind(roomId)
      .first<{ count: number }>();
    expect(promoted?.count).toBe(2);
  });

  it("does not reserve a missing image", async () => {
    const roomId = env.ROOM.newUniqueId().toString();
    await insertRoom(roomId);
    await expect(
      reserveImageAssets(env, {
        roomId,
        userId: "user",
        submissionId: "missing",
        keys: ["b".repeat(43)],
      }),
    ).resolves.toBe("missing");
  });

  it("reclaims only assets already claimed by an earlier maintenance pass", async () => {
    const key = "c".repeat(43);
    const old = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
    await env.FILE.put(`images/${key}`, "orphan");
    await env.web_chat
      .prepare(
        "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, ?, ?)",
      )
      .bind(key, old, old, old)
      .run();
    await env.web_chat
      .prepare(
        "INSERT INTO maintenance_state (id, imageBackfillRoomsComplete, imageBackfillR2Complete, imageBackfillCompletedAt, imageReclamationReadyAt) VALUES (1, 1, 1, ?, ?)",
      )
      .bind(old, old)
      .run();

    await runMaintenance(env);

    expect(await env.FILE.head(`images/${key}`)).toBeNull();
    expect(
      await env.web_chat
        .prepare("SELECT key FROM image_asset WHERE key = ?")
        .bind(key)
        .first(),
    ).toBeNull();
  });

  it("repairs an asset left protected after its last reference disappeared", async () => {
    const key = "e".repeat(43);
    const now = Math.floor(Date.now() / 1000);
    await env.web_chat
      .prepare(
        "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, NULL, NULL)",
      )
      .bind(key, now)
      .run();

    await runMaintenance(env);

    const asset = await env.web_chat
      .prepare("SELECT unreferencedAt FROM image_asset WHERE key = ?")
      .bind(key)
      .first<{ unreferencedAt: number | null }>();
    expect(asset?.unreferencedAt).not.toBeNull();
  });
});

describe("room lifecycle", () => {
  it("expires an empty room after 30 days", async () => {
    const id = env.ROOM.newUniqueId();
    const roomId = id.toString();
    const createdAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await insertRoom(roomId, createdAt);

    await runMaintenance(env);

    expect(
      await env.web_chat
        .prepare("SELECT id FROM room WHERE id = ?")
        .bind(roomId)
        .first(),
    ).toBeNull();
  });

  it("keeps a room whose authoritative history is recent", async () => {
    const id = env.ROOM.newUniqueId();
    const roomId = id.toString();
    const createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await insertRoom(roomId, createdAt);
    const stub = env.ROOM.get(id);
    await runInDurableObject(stub, async (_instance: Room, state) => {
      state.storage.sql.exec(
        "INSERT INTO message (id, content, authorType, userId, submissionId, type, replyTo, createdAt) VALUES (?, 'recent', 'user', 'user', 'recent', 'text', NULL, ?)",
        crypto.randomUUID(),
        Date.now(),
      );
    });

    await runMaintenance(env);

    const room = await env.web_chat
      .prepare("SELECT lastActiveAt, deletionReason FROM room WHERE id = ?")
      .bind(roomId)
      .first<{ lastActiveAt: number; deletionReason: string | null }>();
    expect(room?.lastActiveAt).toBeGreaterThan(
      Math.floor(createdAt.getTime() / 1000),
    );
    expect(room?.deletionReason).toBeNull();
  });

  it("deletes core room data while leaving R2 reclamation asynchronous", async () => {
    const id = env.ROOM.newUniqueId();
    const roomId = id.toString();
    const key = "d".repeat(43);
    const now = Math.floor(Date.now() / 1000);
    await insertRoom(roomId);
    await env.FILE.put(`images/${key}`, "image");
    await env.web_chat.batch([
      env.web_chat
        .prepare(
          "INSERT INTO image_asset (key, createdAt, unreferencedAt, reclaimingAt) VALUES (?, ?, NULL, NULL)",
        )
        .bind(key, now),
      env.web_chat
        .prepare(
          "INSERT INTO image_retention (id, key, roomId, userId, submissionId, messageId, position, createdAt) VALUES ('retention', ?, ?, 'user', 'submission', 'message', 0, ?)",
        )
        .bind(key, roomId, now),
      env.web_chat
        .prepare("UPDATE room SET deletionRequestedAt = ? WHERE id = ?")
        .bind(now, roomId),
    ]);

    await completeRoomDeletion(env, roomId);

    expect(
      await env.web_chat
        .prepare("SELECT id FROM room WHERE id = ?")
        .bind(roomId)
        .first(),
    ).toBeNull();
    expect(await env.FILE.head(`images/${key}`)).not.toBeNull();
    const asset = await env.web_chat
      .prepare("SELECT unreferencedAt FROM image_asset WHERE key = ?")
      .bind(key)
      .first<{ unreferencedAt: number | null }>();
    expect(asset?.unreferencedAt).not.toBeNull();
  });
});
