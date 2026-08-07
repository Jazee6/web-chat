import { describe, expect, test } from "bun:test";
import type {
  ChatMessage,
  HistoryChatMessage,
  UIChatMessage,
} from "web-chat-share";
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

  test("preserves local image previews after acceptance", () => {
    const localFiles = [
      {
        file: new File(["image"], "image.png", { type: "image/png" }),
        isUploading: false,
        key: "a".repeat(64),
      },
    ];
    const canonical = message("server-id", {
      type: "image",
      content: JSON.stringify(["a".repeat(64)]),
    });

    expect(
      reconcileMessageAcceptance(
        [
          message("submission-id", {
            type: "image",
            submissionId: "submission-id",
            localFiles,
          }),
        ],
        { submissionId: "submission-id", message: canonical },
      ),
    ).toEqual([{ ...canonical, renderKey: "submission-id", localFiles }]);
  });

  test("moves local image previews onto a canonical message loaded before a late acceptance", () => {
    const localFiles = [
      {
        file: new File(["image"], "image.png", { type: "image/png" }),
        isUploading: false,
        key: "a".repeat(64),
      },
    ];
    const canonical = message("server-id", {
      type: "image",
      content: JSON.stringify(["a".repeat(64)]),
      renderKey: "canonical-render-key",
    });

    expect(
      reconcileMessageAcceptance(
        [
          canonical,
          message("submission-id", {
            type: "image",
            submissionId: "submission-id",
            localFiles,
          }),
        ],
        { submissionId: "submission-id", message: canonical },
      ),
    ).toEqual([{ ...canonical, localFiles }]);
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

  test("reconciles sender-only submission ids and strips them from canonical history", () => {
    const optimistic = message("submission-id", {
      submissionId: "submission-id",
      sendState: "waiting",
    });
    const history: HistoryChatMessage[] = [
      {
        ...message("server-id", { content: "accepted" }),
        submissionId: "submission-id",
      },
    ];

    expect(mergeInitialHistory([optimistic], history)).toEqual([
      {
        ...message("server-id", { content: "accepted" }),
        renderKey: "submission-id",
      },
    ]);
  });

  test("keeps only submissions not already represented in history", () => {
    const accepted = message("accepted-local", {
      submissionId: "accepted-submission",
      sendState: "waiting",
    });
    const queued = message("queued", {
      submissionId: "queued-submission",
      sendState: "waiting",
    });
    const canonical = {
      ...message("server-id"),
      submissionId: "accepted-submission",
    };

    expect(mergeInitialHistory([accepted, queued], [canonical])).toEqual([
      { ...message("server-id"), renderKey: "accepted-submission" },
      queued,
    ]);
  });

  test("preserves local image previews when history compensates for a lost acceptance", () => {
    const localFiles = [
      {
        file: new File(["image"], "image.png", { type: "image/png" }),
        isUploading: false,
        key: "a".repeat(64),
      },
    ];
    const optimistic = message("submission-id", {
      type: "image",
      submissionId: "submission-id",
      localFiles,
    });
    const canonical: HistoryChatMessage = {
      ...message("server-id", {
        type: "image",
        content: JSON.stringify(["a".repeat(64)]),
      }),
      submissionId: "submission-id",
    };
    const { submissionId: _, ...canonicalMessage } = canonical;

    expect(mergeInitialHistory([optimistic], [canonical])).toEqual([
      {
        ...canonicalMessage,
        renderKey: "submission-id",
        localFiles,
      },
    ]);
  });
});
