import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Room } from "../src/do/room";
import { app } from "../src/index";
import { messageTable } from "../src/lib/schema/room";

const insertRoom = async (id: string) => {
  const now = Math.floor(Date.now() / 1_000);
  await env.web_chat
    .prepare(
      "INSERT INTO room (id, name, type, userId, createdAt, lastActiveAt, deletionRequestedAt) VALUES (?, 'test', 'unlisted', 'owner', ?, ?, NULL)",
    )
    .bind(id, now, now)
    .run();
};

const seedSession = async (userId: string) => {
  const now = Date.now();
  const token = `test-token-${userId}`;
  await env.web_chat.batch([
    env.web_chat
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, 'Test User', ?, 1, NULL, ?, ?)",
      )
      .bind(userId, `${userId}@test.local`, now, now),
    env.web_chat
      .prepare(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)",
      )
      .bind(
        `session-${userId}`,
        now + 60 * 60 * 1_000,
        token,
        now,
        now,
        userId,
      ),
  ]);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const encoded = `${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  return `wc.session_token=${encodeURIComponent(encoded)}`;
};

const insertMessage = (
  state: DurableObjectState,
  message: {
    id: string;
    content: string;
    authorType?: "user" | "ai" | "system";
    userId?: string | null;
    submissionId?: string | null;
    type?: "text" | "image";
    replyTo?: unknown;
    createdAt: number;
  },
) => {
  state.storage.sql.exec(
    "INSERT INTO message (id, content, authorType, userId, submissionId, type, replyTo, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    message.id,
    message.content,
    message.authorType ?? "user",
    message.userId ?? null,
    message.submissionId ?? null,
    message.type ?? "text",
    message.replyTo ? JSON.stringify(message.replyTo) : null,
    message.createdAt,
  );
};

const withRoom = async <T>(
  callback: (room: Room, state: DurableObjectState) => Promise<T>,
) => {
  const roomId = env.ROOM.newUniqueId();
  await insertRoom(roomId.toString());
  return runInDurableObject(env.ROOM.get(roomId), callback);
};

const rebuildUntilReady = async (room: Room) => {
  await room.beginSearchRebuild();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = room.getSearchStatus();
    if (status.readiness === "ready") return;
    await room.alarm();
  }
  throw new Error("Search rebuild did not become ready");
};

const searchMessages = async (room: Room, userId: string, query: string) => {
  const response = await room.search(userId, { action: "search", query });
  expect("rateLimited" in response).toBe(false);
  if (
    "rateLimited" in response ||
    response.readiness !== "ready" ||
    !("messages" in response)
  ) {
    throw new Error("Search is not ready");
  }
  return response.messages;
};

describe("room history search", () => {
  it("makes a new empty room ready immediately", async () => {
    await withRoom(async (room) => {
      expect(room.getSearchStatus()).toEqual({ readiness: "ready" });
      expect(await room.search("owner", { action: "retry" })).toEqual({
        readiness: "ready",
      });
    });
  });

  it("uses trigram substring semantics without broad Unicode folding", async () => {
    await withRoom(async (room, state) => {
      const createdAt = 1_800_000_000_000;
      insertMessage(state, {
        id: "m-01",
        content: "Hello 中文世界",
        userId: "owner",
        createdAt,
      });
      insertMessage(state, {
        id: "m-02",
        content: "你好世界，hello",
        authorType: "ai",
        createdAt,
      });
      insertMessage(state, {
        id: "m-03",
        content: "a,b and a b",
        userId: "owner",
        submissionId: "owner-search-submission",
        createdAt,
      });
      insertMessage(state, {
        id: "m-04",
        content: 'say "hi" exactly',
        userId: "owner",
        createdAt,
      });
      insertMessage(state, {
        id: "m-05",
        content: "Éclair",
        userId: "owner",
        createdAt,
      });
      insertMessage(state, {
        id: "m-06",
        content: "reply body",
        userId: "owner",
        replyTo: {
          id: "m-01",
          authorType: "user",
          userId: "owner",
          type: "text",
          snippet: "snapshot-only",
        },
        createdAt,
      });
      insertMessage(state, {
        id: "m-07",
        content: "snapshot-only system text",
        authorType: "system",
        createdAt,
      });
      insertMessage(state, {
        id: "m-08",
        content: JSON.stringify(["snapshot-only"]),
        userId: "owner",
        type: "image",
        createdAt,
      });
      await rebuildUntilReady(room);

      expect(
        (await searchMessages(room, "ascii", "HELLO")).map((m) => m.id),
      ).toEqual(["m-02", "m-01"]);
      expect(
        (await searchMessages(room, "cjk", "你好世")).map((m) => m.id),
      ).toEqual(["m-02"]);
      expect(
        (await searchMessages(room, "punctuation", "a,b")).map((m) => m.id),
      ).toEqual(["m-03"]);
      expect(
        (await searchMessages(room, "owner", "a,b"))[0]?.submissionId,
      ).toBe("owner-search-submission");
      expect(
        (await searchMessages(room, "other", "a,b"))[0]?.submissionId,
      ).toBeUndefined();
      expect(
        (await searchMessages(room, "space", "a b")).map((m) => m.id),
      ).toEqual(["m-03"]);
      expect(
        (await searchMessages(room, "quote", 'say "hi"')).map((m) => m.id),
      ).toEqual(["m-04"]);
      expect(
        (await searchMessages(room, "accent-sensitive", "Écl")).map(
          (m) => m.id,
        ),
      ).toEqual(["m-05"]);
      expect(
        await searchMessages(room, "accent-sensitive-lower", "écl"),
      ).toEqual([]);
      expect(
        (await searchMessages(room, "reply-body", "reply")).map((m) => m.id),
      ).toEqual(["m-06"]);
      expect(
        await searchMessages(room, "excluded-snapshot", "snapshot-only"),
      ).toEqual([]);
    });
  });

  it("keeps a composite snapshot and cursor gap-free", async () => {
    await withRoom(async (room, state) => {
      const createdAt = 1_800_000_000_000;
      for (let i = 0; i < 30; i += 1) {
        insertMessage(state, {
          id: `p-${String(i).padStart(2, "0")}`,
          content: "pager needle",
          userId: "owner",
          createdAt,
        });
      }
      await rebuildUntilReady(room);

      const first = await room.search("pager", {
        action: "search",
        query: "needle",
      });
      expect("rateLimited" in first).toBe(false);
      if (
        "rateLimited" in first ||
        first.readiness !== "ready" ||
        !("messages" in first)
      ) {
        throw new Error("Search is not ready");
      }
      expect(first.messages.map((message) => message.id)).toEqual(
        Array.from(
          { length: 25 },
          (_, i) => `p-${String(29 - i).padStart(2, "0")}`,
        ),
      );
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toEqual({
        createdAt: new Date(createdAt).toISOString(),
        id: "p-05",
      });

      insertMessage(state, {
        id: "p-30",
        content: "pager needle",
        userId: "owner",
        createdAt,
      });
      const inserted = await room.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.id, "p-30"))
        .limit(1);
      room.maintainSearchIndex(inserted[0]!);

      const second = await room.search("pager-next", {
        action: "search",
        query: "needle",
        snapshot: first.snapshot,
        cursor: first.nextCursor!,
      });
      expect("rateLimited" in second).toBe(false);
      if (
        "rateLimited" in second ||
        second.readiness !== "ready" ||
        !("messages" in second)
      ) {
        throw new Error("Search is not ready");
      }
      expect(second.messages.map((message) => message.id)).toEqual(
        Array.from(
          { length: 5 },
          (_, i) => `p-${String(4 - i).padStart(2, "0")}`,
        ),
      );
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();
    });
  });

  it("does not expose partial results while rebuilding and resumes by alarm", async () => {
    await withRoom(async (room, state) => {
      const createdAt = 1_800_000_000_000;
      for (let i = 0; i < 501; i += 1) {
        insertMessage(state, {
          id: `b-${String(i).padStart(3, "0")}`,
          content: "backfill needle",
          userId: "owner",
          createdAt: createdAt + i,
        });
      }

      await room.beginSearchRebuild();
      expect(room.getSearchStatus()).toEqual({ readiness: "preparing" });
      const preparing = await room.search("preparing", {
        action: "search",
        query: "needle",
      });
      expect(preparing).toEqual({ readiness: "preparing" });

      await room.alarm();
      expect(room.getSearchStatus()).toEqual({ readiness: "preparing" });
      insertMessage(state, {
        id: "b-new",
        content: "fresh searchable message",
        userId: "owner",
        createdAt: createdAt + 1_000,
      });
      const newRow = await room.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.id, "b-new"))
        .limit(1);
      room.maintainSearchIndex(newRow[0]!);
      expect(
        await room.search("still-preparing", {
          action: "search",
          query: "fresh",
        }),
      ).toEqual({ readiness: "preparing" });
      await room.alarm();
      await room.alarm();
      expect(room.getSearchStatus()).toEqual({ readiness: "ready" });
      expect(
        (await searchMessages(room, "after-backfill", "needle")).length,
      ).toBe(25);
      expect(
        (await searchMessages(room, "new-after-backfill", "fresh")).map(
          (message) => message.id,
        ),
      ).toEqual(["b-new"]);
    });
  });

  it("returns a bidirectional, oldest-first context and preserves submission privacy", async () => {
    await withRoom(async (room, state) => {
      const createdAt = 1_800_000_000_000;
      for (let i = 0; i < 40; i += 1) {
        insertMessage(state, {
          id: `c-${String(i).padStart(2, "0")}`,
          content: `context ${i}`,
          userId: "owner",
          submissionId: i === 20 ? "owner-submission" : null,
          createdAt,
        });
      }
      const initial = await room.context("owner", {
        action: "initial",
        targetId: "c-20",
      });
      expect(initial?.messages.map((message) => message.id)).toEqual(
        Array.from(
          { length: 25 },
          (_, i) => `c-${String(i + 8).padStart(2, "0")}`,
        ),
      );
      expect(initial?.messages[12]?.submissionId).toBe("owner-submission");
      expect(initial?.hasMoreBefore).toBe(true);
      expect(initial?.hasMoreAfter).toBe(true);

      const before = await room.context("other", {
        action: "before",
        targetId: "c-20",
        cursor: {
          createdAt: new Date(createdAt).toISOString(),
          id: "c-25",
        },
      });
      expect(before?.messages.map((message) => message.id)).toEqual(
        Array.from({ length: 25 }, (_, i) => `c-${String(i).padStart(2, "0")}`),
      );
      expect(before?.hasMoreBefore).toBe(false);
      expect(before?.hasMoreAfter).toBe(true);
      expect(before?.messages.some((message) => message.submissionId)).toBe(
        false,
      );

      const after = await room.context("other", {
        action: "after",
        targetId: "c-20",
        cursor: {
          createdAt: new Date(createdAt).toISOString(),
          id: "c-25",
        },
      });
      expect(after?.messages.map((message) => message.id)).toEqual(
        Array.from(
          { length: 14 },
          (_, i) => `c-${String(i + 26).padStart(2, "0")}`,
        ),
      );
      expect(after?.hasMoreBefore).toBe(true);
      expect(after?.hasMoreAfter).toBe(false);
    });
  });

  it("uses the composite cursor for same-millisecond WebSocket history pages", async () => {
    await withRoom(async (room, state) => {
      const createdAt = 1_800_000_000_000;
      for (let i = 0; i < 30; i += 1) {
        insertMessage(state, {
          id: `h-${String(i).padStart(2, "0")}`,
          content: `history ${i}`,
          userId: "owner",
          createdAt,
        });
      }
      const sent: string[] = [];
      const ws = {
        readyState: WebSocket.OPEN,
        send: (message: string) => sent.push(message),
      } as unknown as WebSocket;
      room.sessions.set(ws, { id: "owner" });
      await room.webSocketMessage(
        ws,
        JSON.stringify({
          type: "loadHistory",
          data: {
            before: {
              createdAt: new Date(createdAt).toISOString(),
              id: "h-15",
            },
          },
        }),
      );
      expect(
        JSON.parse(sent[0]!).data.map((message: { id: string }) => message.id),
      ).toEqual(
        Array.from({ length: 15 }, (_, i) => `h-${String(i).padStart(2, "0")}`),
      );
    });
  });

  it("rate-limits only search actions and accepts messages when indexing fails", async () => {
    await withRoom(async (room, state) => {
      insertMessage(state, {
        id: "rate-target",
        content: "rate target",
        userId: "owner",
        createdAt: Date.now(),
      });
      const target = await room.db
        .select()
        .from(messageTable)
        .limit(1)
        .then((rows) => rows[0]!);

      for (let i = 0; i < 5; i += 1) {
        expect(
          await room.search("rate-user", { action: "search", query: "rate" }),
        ).toMatchObject({ readiness: "ready" });
      }
      expect(
        await room.context("rate-user", {
          action: "initial",
          targetId: target.id,
        }),
      ).not.toBeNull();
      expect(await room.search("rate-user", { action: "status" })).toEqual({
        readiness: "ready",
      });
      expect(
        await room.search("rate-user", { action: "search", query: "rate" }),
      ).toEqual({ rateLimited: true, retryAfter: expect.any(Number) });

      state.storage.sql.exec("DROP TABLE message_search_fts");
      const sent: string[] = [];
      const ws = {
        readyState: WebSocket.OPEN,
        send: (message: string) => sent.push(message),
      } as unknown as WebSocket;
      room.sessions.set(ws, { id: "owner" });
      const submissionId = crypto.randomUUID();
      await room.webSocketMessage(
        ws,
        JSON.stringify({
          type: "send",
          data: {
            submissionId,
            type: "text",
            content: "accepted despite search failure",
          },
        }),
      );
      expect(JSON.parse(sent[0]!).type).toBe("messageAcceptance");
      await room.setAiEnabled(true);
      expect(
        await room.db
          .select({ id: messageTable.id })
          .from(messageTable)
          .then((rows) => rows.length),
      ).toBeGreaterThan(0);
      expect(
        await room.db
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(eq(messageTable.authorType, "system")),
      ).toHaveLength(1);
      expect(room.getSearchStatus()).toEqual({ readiness: "unavailable" });

      const retry = await room.search("rebuild-user", { action: "retry" });
      expect(retry).toEqual({ readiness: "preparing" });
      await room.alarm();
      await room.alarm();
      expect(room.getSearchStatus()).toEqual({ readiness: "ready" });
      expect(
        (await searchMessages(room, "rebuild-search", "accepted")).map(
          (message) => message.id,
        ),
      ).toHaveLength(1);
    });
  });

  it("returns HTTP 429 and Retry-After for the authenticated endpoint", async () => {
    const roomId = env.ROOM.newUniqueId().toString();
    await insertRoom(roomId);
    const cookie = await seedSession(`http-${crypto.randomUUID()}`);
    const request = (body: unknown) =>
      app.fetch(
        new Request(`https://server.test/room/${roomId}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie,
          },
          body: JSON.stringify(body),
        }),
        env,
      );

    for (let i = 0; i < 5; i += 1) {
      expect((await request({ action: "search", query: "hello" })).status).toBe(
        200,
      );
    }
    expect((await request({ action: "status" })).status).toBe(200);
    const limited = await request({ action: "search", query: "hello" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
  });
});
