import { describe, expect, test } from "bun:test";
import {
  AI_CONTEXT_LIMIT,
  clearPendingAiInvocations,
  getAiInvocationRejection,
  hasRoomAiMention,
  selectRoomAiContext,
} from "./room-ai";

describe("Room AI mentions", () => {
  test("matches a standalone mention anywhere and ignores case", () => {
    expect(hasRoomAiMention("@AI help")).toBe(true);
    expect(hasRoomAiMention("what do you think, @ai?")).toBe(true);
    expect(hasRoomAiMention("@Ai")).toBe(true);
  });

  test("does not match email addresses or longer handles", () => {
    expect(hasRoomAiMention("write to foo@ai.com")).toBe(false);
    expect(hasRoomAiMention("ask @AIBot")).toBe(false);
    expect(hasRoomAiMention("plain ai")).toBe(false);
  });
});

describe("Room AI context", () => {
  test("keeps the latest 50 user and AI text messages", () => {
    const messages: {
      id: number;
      authorType: "user" | "ai" | "system";
      type: "text" | "image";
    }[] = Array.from({ length: 60 }, (_, index) => ({
      id: index,
      authorType: "user",
      type: "text",
    }));
    messages.splice(27, 0, {
      id: 100,
      authorType: "system",
      type: "text",
    });
    messages.splice(28, 0, {
      id: 101,
      authorType: "user",
      type: "image",
    });

    const context = selectRoomAiContext(messages);
    expect(context).toHaveLength(AI_CONTEXT_LIMIT);
    expect(context[0].id).toBe(10);
    expect(context.some((message) => message.id === 100)).toBe(false);
    expect(context.some((message) => message.id === 101)).toBe(false);
  });
});

describe("Room AI queue policy", () => {
  test("applies a ten-second per-user cooldown", () => {
    expect(
      getAiInvocationRejection({
        now: 19_999,
        lastAcceptedAt: 10_000,
        pendingCount: 0,
      }),
    ).toBe("rate_limited");
    expect(
      getAiInvocationRejection({
        now: 20_000,
        lastAcceptedAt: 10_000,
        pendingCount: 0,
      }),
    ).toBeNull();
  });

  test("allows five pending invocations and rejects the sixth", () => {
    expect(
      getAiInvocationRejection({ now: 20_000, pendingCount: 4 }),
    ).toBeNull();
    expect(getAiInvocationRejection({ now: 20_000, pendingCount: 5 })).toBe(
      "queue_full",
    );
  });

  test("returns and clears queued invocations when AI is disabled", () => {
    const queue = [1, 2, 3];
    expect(clearPendingAiInvocations(queue)).toEqual([1, 2, 3]);
    expect(queue).toEqual([]);
  });
});
