import { describe, expect, it } from "bun:test";
import {
  registerPushDestinationSchema,
  unsubscribeRoomSchema,
} from "./notification";

describe("notification schemas", () => {
  it("accepts Durable Object room ids", () => {
    expect(
      unsubscribeRoomSchema.safeParse({
        roomId: "0123456789abcdef0123456789abcdef",
      }).success,
    ).toBe(true);
  });

  it("requires HTTPS push endpoints", () => {
    const destination = {
      p256dh: "key",
      auth: "secret",
    };
    expect(
      registerPushDestinationSchema.safeParse({
        ...destination,
        endpoint: "https://push.example/subscription",
      }).success,
    ).toBe(true);
    expect(
      registerPushDestinationSchema.safeParse({
        ...destination,
        endpoint: "http://127.0.0.1/internal",
      }).success,
    ).toBe(false);
  });
});
