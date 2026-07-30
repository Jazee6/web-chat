import { describe, expect, test } from "bun:test";
import { clientMessageSchema } from "./room.ts";

describe("Message Submission schema", () => {
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
});
