import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { Room } from "../src/do/room";

const percentile95 = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
  );
};

test("100,000-message room history search release benchmark", async () => {
  const id = env.ROOM.newUniqueId();
  await runInDurableObject(env.ROOM.get(id), async (room: Room, state) => {
    state.storage.sql.exec(`
      WITH RECURSIVE sequence(value) AS (
        VALUES(0)
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 99999
      )
      INSERT INTO message (id, content, authorType, userId, type, createdAt)
      SELECT
        printf('benchmark-%06d', value),
        CASE value % 5
          WHEN 0 THEN 'Room history needle with an English phrase and punctuation, space.'
          WHEN 1 THEN '用于验证中文搜索性能的房间聊天记录文本。'
          WHEN 2 THEN 'Mixed 中英文 Durable Object history for realistic search lengths.'
          WHEN 3 THEN printf('Short message %d', value)
          ELSE 'A longer message repeated to approximate ordinary conversation content across a retained room history.'
        END,
        CASE value % 10 WHEN 0 THEN 'ai' ELSE 'user' END,
        CASE value % 10 WHEN 0 THEN NULL ELSE 'benchmark-user' END,
        'text',
        1800000000000 + value
      FROM sequence;
    `);
    const contentBytes = state.storage.sql.databaseSize;

    const buildStartedAt = performance.now();
    await room.beginSearchRebuild();
    for (let batch = 0; batch < 1_000; batch += 1) {
      if (room.getSearchStatus().readiness === "ready") break;
      await room.alarm();
    }
    const buildMs = performance.now() - buildStartedAt;
    expect(room.getSearchStatus()).toEqual({ readiness: "ready" });

    const firstPageMs: number[] = [];
    const nextPageMs: number[] = [];
    for (let run = 0; run < 30; run += 1) {
      const startedAt = performance.now();
      const first = await room.search(`benchmark-first-${run}`, {
        action: "search",
        query: "needle",
      });
      firstPageMs.push(performance.now() - startedAt);
      if (
        "rateLimited" in first ||
        first.readiness !== "ready" ||
        !("messages" in first) ||
        !first.nextCursor
      ) {
        throw new Error("Benchmark search did not return a full first page");
      }

      const nextStartedAt = performance.now();
      await room.search(`benchmark-next-${run}`, {
        action: "search",
        query: "needle",
        snapshot: first.snapshot,
        cursor: first.nextCursor,
      });
      nextPageMs.push(performance.now() - nextStartedAt);
    }

    const firstPageP95 = percentile95(firstPageMs);
    const nextPageP95 = percentile95(nextPageMs);
    const indexBytes = state.storage.sql.databaseSize - contentBytes;
    console.log(
      JSON.stringify({ buildMs, indexBytes, firstPageP95, nextPageP95 }),
    );
    expect(firstPageP95).toBeLessThanOrEqual(500);
    expect(nextPageP95).toBeLessThanOrEqual(300);
  });
});
