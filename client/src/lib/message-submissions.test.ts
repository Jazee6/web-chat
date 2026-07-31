import { describe, expect, test } from "bun:test";
import type { ChatMessage, UIChatMessage } from "web-chat-share";
import {
  mergeInitialHistory,
  reconcileMessageAcceptance,
} from "./message-submissions.ts";

const message = (
  id: string,
  overrides: Partial<UIChatMessage> = {},
): UIChatMessage => ({
  id,
  authorType: "user",
  userId: "user-1",
  type: "text",
  content: id,
  createdAt: "2026-07-30T00:00:00.000Z",
  ...overrides,
});

describe("Message Acceptance reconciliation", () => {
  test("replaces the optimistic message in place with the canonical message", () => {
    const canonical = message("server-id", { content: "accepted" });
    const chats = [
      message("before"),
      message("submission-id", {
        submissionId: "submission-id",
        sendState: "failed",
      }),
      message("after"),
    ];

    expect(
      reconcileMessageAcceptance(chats, {
        submissionId: "submission-id",
        message: canonical,
      }),
    ).toEqual([
      message("before"),
      { ...canonical, renderKey: "submission-id" },
      message("after"),
    ]);
  });

  test("removes a canonical duplicate already loaded through history", () => {
    const canonical = message("server-id", { content: "accepted" });
    const chats = [
      canonical,
      message("submission-id", {
        submissionId: "submission-id",
        sendState: "sending",
      }),
    ];

    expect(
      reconcileMessageAcceptance(chats, {
        submissionId: "submission-id",
        message: canonical,
      }),
    ).toEqual([canonical]);
  });

  test("keeps an existing canonical message mounted when removing its optimistic duplicate", () => {
    const canonical = message("server-id", {
      content: "accepted",
      renderKey: "existing-render-key",
    });
    const optimistic = message("submission-id", {
      submissionId: "submission-id",
      sendState: "sending",
    });

    const result = reconcileMessageAcceptance([canonical, optimistic], {
      submissionId: "submission-id",
      message: message("server-id", { content: "accepted" }),
    });

    expect(result[0]).toBe(canonical);
    expect(result).toEqual([canonical]);
  });

  test("treats duplicate and late acceptances idempotently", () => {
    const canonical = message("server-id", { content: "accepted" });
    expect(
      reconcileMessageAcceptance([canonical], {
        submissionId: "submission-id",
        message: canonical,
      }),
    ).toEqual([canonical]);
  });

  test("preserves the optimistic render key across duplicate acceptances", () => {
    const canonical = message("server-id", { content: "accepted" });
    const accepted = reconcileMessageAcceptance(
      [
        message("submission-id", {
          submissionId: "submission-id",
          sendState: "sending",
        }),
      ],
      { submissionId: "submission-id", message: canonical },
    );

    expect(
      reconcileMessageAcceptance(accepted, {
        submissionId: "submission-id",
        message: canonical,
      }),
    ).toEqual([{ ...canonical, renderKey: "submission-id" }]);
  });
});

describe("initial history merge", () => {
  test("preserves page-local pending and failed submissions", () => {
    const history: ChatMessage[] = [message("history")];
    const pending = message("pending", {
      submissionId: "pending",
      sendState: "sending",
    });
    const failed = message("failed", {
      submissionId: "failed",
      sendState: "failed",
    });

    expect(
      mergeInitialHistory([message("old"), pending, failed], history),
    ).toEqual([...history, pending, failed]);
  });
});
