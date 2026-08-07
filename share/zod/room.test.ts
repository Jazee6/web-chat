import { describe, expect, test } from "bun:test";
import { clientMessageSchema } from "./room.ts";

describe("Message Submission schema", () => {
  const submissionId = "8a15e23b-d489-4f41-b61e-609c1a8b5fe8";
  const storageKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  test("accepts a UUID submission id", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: {
          submissionId: "8a15e23b-d489-4f41-b61e-609c1a8b5fe8",
          type: "text",
          content: "hello",
        },
      }).success,
    ).toBe(true);
  });

  test("rejects missing or invalid submission ids", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: { type: "text", content: "hello" },
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: {
          submissionId: "not-a-uuid",
          type: "text",
          content: "hello",
        },
      }).success,
    ).toBe(false);
  });

  test("trims text and requires 1 to 2048 characters", () => {
    const parsed = clientMessageSchema.safeParse({
      type: "send",
      data: { submissionId, type: "text", content: "  hello  " },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "send") {
      expect(parsed.data.data.content).toBe("hello");
    }

    for (const content of ["", "   ", "a".repeat(2049)]) {
      expect(
        clientMessageSchema.safeParse({
          type: "send",
          data: { submissionId, type: "text", content },
        }).success,
      ).toBe(false);
    }
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: { submissionId, type: "text", content: "a".repeat(2048) },
      }).success,
    ).toBe(true);
  });

  test("requires image content to encode 1 to 5 valid storage keys", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: {
          submissionId,
          type: "image",
          content: JSON.stringify([storageKey, storageKey]),
        },
      }).success,
    ).toBe(true);

    for (const content of [
      "not-json",
      "{}",
      "[]",
      JSON.stringify(Array(6).fill(storageKey)),
      JSON.stringify(["not-a-storage-key"]),
    ]) {
      expect(
        clientMessageSchema.safeParse({
          type: "send",
          data: { submissionId, type: "image", content },
        }).success,
      ).toBe(false);
    }
  });

  test("requires a complete valid ReplyRef", () => {
    const validReply = {
      id: "message-1",
      authorType: "user",
      userId: "user-1",
      type: "text",
      snippet: "hello",
    };
    expect(
      clientMessageSchema.safeParse({
        type: "send",
        data: {
          submissionId,
          type: "text",
          content: "reply",
          replyTo: validReply,
        },
      }).success,
    ).toBe(true);

    for (const replyTo of [
      { ...validReply, id: "" },
      { ...validReply, userId: undefined },
      { ...validReply, snippet: "a".repeat(101) },
      { ...validReply, authorType: "system" },
    ]) {
      expect(
        clientMessageSchema.safeParse({
          type: "send",
          data: { submissionId, type: "text", content: "reply", replyTo },
        }).success,
      ).toBe(false);
    }
  });
});
