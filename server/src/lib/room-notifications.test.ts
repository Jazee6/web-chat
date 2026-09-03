import { describe, expect, it } from "bun:test";
import {
  formatNotificationPayload,
  formatNotificationPreview,
  isEligibleForNotification,
  isExpiredJob,
  isPermanentPushFailure,
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_EXPIRY_MS,
  notificationPage,
  notificationTopic,
  remainingNotificationTtl,
  RoomVisibilityTracker,
} from "./room-notifications";

describe("Room Notifications: Eligibility & Filtering", () => {
  it("allows user-authored text and image messages", () => {
    expect(
      isEligibleForNotification({ authorType: "user", type: "text" }),
    ).toBe(true);
    expect(
      isEligibleForNotification({ authorType: "user", type: "image" }),
    ).toBe(true);
  });

  it("rejects Room AI messages", () => {
    expect(isEligibleForNotification({ authorType: "ai", type: "text" })).toBe(
      false,
    );
  });

  it("rejects System messages", () => {
    expect(
      isEligibleForNotification({ authorType: "system", type: "text" }),
    ).toBe(false);
  });

  it("rejects unsupported message types", () => {
    expect(
      isEligibleForNotification({ authorType: "user", type: "audio" }),
    ).toBe(false);
  });
});

describe("Room Notifications: Content Formatting & Collapse Tag", () => {
  it("formats text previews accurately and truncates at 200 characters", () => {
    expect(formatNotificationPreview("text", "Hello there!")).toBe(
      "Hello there!",
    );

    const longText = "a".repeat(250);
    const preview = formatNotificationPreview("text", longText);
    expect(preview.length).toBe(200);
    expect(preview.endsWith("...")).toBe(true);
  });

  it("formats single image as [图片]", () => {
    const singleImage = JSON.stringify(["key-abc"]);
    expect(formatNotificationPreview("image", singleImage)).toBe("[图片]");
  });

  it("formats multiple images as [图片] x N", () => {
    const multiImage = JSON.stringify(["key-1", "key-2", "key-3"]);
    expect(formatNotificationPreview("image", multiImage)).toBe("[图片] x 3");
  });

  it("constructs payload with stable collapse tag, room title, and sender body", () => {
    const payloadStr = formatNotificationPayload({
      roomName: "Engineering",
      senderName: "Alice",
      messageType: "text",
      content: "Deployment ready",
      roomId: "room-123",
      messageId: "msg-456",
      createdAt: 1_700_000_000_000,
    });

    const parsed = JSON.parse(payloadStr);
    expect(parsed.title).toBe("Engineering");
    expect(parsed.body).toBe("Alice: Deployment ready");
    // Crucial: tag per room collapses multiple notifications into latest for that room
    expect(parsed.tag).toBe("room:room-123");
    expect(parsed.data.roomId).toBe("room-123");
    expect(parsed.data.messageId).toBe("msg-456");
    expect(parsed.data.url).toBe("/room/room-123");
    expect(parsed.timestamp).toBe(1_700_000_000_000);
    expect(notificationTopic("0199-aaaa-bbbb-cccc-123456789012")).toMatch(
      /^[A-Za-z0-9_-]{1,32}$/,
    );
  });
});

describe("Room Notifications: 5-Minute Expiry Policy", () => {
  it("expires tasks older than 5 minutes", () => {
    const now = 1_700_000_000_000;
    const sixMinutesAgo = now - 6 * 60 * 1000;
    expect(isExpiredJob(sixMinutesAgo, now)).toBe(true);

    const justOverFiveMinutes = now - (NOTIFICATION_EXPIRY_MS + 1);
    expect(isExpiredJob(justOverFiveMinutes, now)).toBe(true);
  });

  it("keeps tasks within 5 minutes fresh", () => {
    const now = 1_700_000_000_000;
    const fourMinutesAgo = now - 4 * 60 * 1000;
    expect(isExpiredJob(fourMinutesAgo, now)).toBe(false);

    const justUnderFiveMinutes = now - (NOTIFICATION_EXPIRY_MS - 100);
    expect(isExpiredJob(justUnderFiveMinutes, now)).toBe(false);

    expect(isExpiredJob(now, now)).toBe(false);
    expect(remainingNotificationTtl(fourMinutesAgo, now)).toBe(60);
    expect(remainingNotificationTtl(now - NOTIFICATION_EXPIRY_MS, now)).toBe(0);
  });
});

describe("Room Notifications: Any-Visible Suppression Model", () => {
  it("suppresses notification if user has even one visible tab in the room", () => {
    const tracker = new RoomVisibilityTracker<string>();
    const userId = "user-1";

    expect(tracker.getVisibleUsers([userId])).toEqual([]);

    tracker.set(userId, "tab-1", true);
    expect(tracker.getVisibleUsers([userId])).toEqual([userId]);

    tracker.set(userId, "tab-2", false);
    expect(tracker.getVisibleUsers([userId])).toEqual([userId]);

    tracker.set(userId, "tab-1", false);
    expect(tracker.getVisibleUsers([userId])).toEqual([]);

    tracker.set(userId, "tab-3", true);
    expect(tracker.getVisibleUsers([userId])).toEqual([userId]);

    tracker.remove(userId, "tab-3");
    expect(tracker.getVisibleUsers([userId])).toEqual([]);
  });
});

describe("Room Notifications: Deterministic Pagination Continuation", () => {
  interface DestinationRow {
    id: string;
    userId: string;
    endpoint: string;
  }

  const rows = Array.from(
    { length: 95 },
    (_, index): DestinationRow => ({
      id: `dest-${String(index).padStart(3, "0")}`,
      userId: `user-${index}`,
      endpoint: `https://push/${index}`,
    }),
  );

  it("delivers in a single batch when destinations <= 40", () => {
    const page = notificationPage(rows.slice(0, 30));
    expect(page.destinations).toHaveLength(30);
    expect(page.nextCursor).toBeUndefined();
  });

  it("produces continuation cursors and covers every destination once", () => {
    const page1 = notificationPage(rows);
    const page2 = notificationPage(
      rows.filter((row) => row.id > page1.nextCursor!),
    );
    const page3 = notificationPage(
      rows.filter((row) => row.id > page2.nextCursor!),
    );

    expect(page1.destinations).toHaveLength(NOTIFICATION_BATCH_SIZE);
    expect(page1.nextCursor).toBe("dest-039");
    expect(page2.destinations[0].id).toBe("dest-040");
    expect(page2.nextCursor).toBe("dest-079");
    expect(page3.destinations).toHaveLength(15);
    expect(page3.nextCursor).toBeUndefined();

    const visited = [
      ...page1.destinations,
      ...page2.destinations,
      ...page3.destinations,
    ];
    expect(visited).toHaveLength(95);
    expect(new Set(visited.map((row) => row.id)).size).toBe(95);
  });
});

describe("Room Notifications: Permanent Endpoint Cleanup Policy", () => {
  it("identifies 404 and 410 as permanent dead endpoints to be cleaned up", () => {
    const errors = [
      { statusCode: 404, shouldCleanup: true },
      { statusCode: 410, shouldCleanup: true },
      { statusCode: 500, shouldCleanup: false },
      { statusCode: 502, shouldCleanup: false },
      { statusCode: 429, shouldCleanup: false },
      { statusCode: undefined, shouldCleanup: false },
    ];

    for (const { statusCode, shouldCleanup } of errors) {
      expect(isPermanentPushFailure(statusCode)).toBe(shouldCleanup);
    }
  });
});
