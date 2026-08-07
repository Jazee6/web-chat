import { describe, expect, test } from "bun:test";
import type { MessageSubmission } from "web-chat-share";
import {
  getRejectedSubmissionId,
  getVisibleSubmissionId,
  isSameSubmissionPayload,
} from "./message-submission";

const submission: MessageSubmission = {
  submissionId: "8a15e23b-d489-4f41-b61e-609c1a8b5fe8",
  type: "text",
  content: "hello",
  replyTo: {
    id: "message-1",
    authorType: "user",
    userId: "user-1",
    type: "text",
    snippet: "original",
  },
};

describe("getRejectedSubmissionId", () => {
  test("extracts a string id from an otherwise invalid send envelope", () => {
    expect(
      getRejectedSubmissionId({
        type: "send",
        data: { submissionId: "bad-id", content: 42 },
      }),
    ).toBe("bad-id");
  });

  test("does not extract ids from unrelated or structurally incomplete messages", () => {
    expect(
      getRejectedSubmissionId({ type: "join", submissionId: "id" }),
    ).toBeUndefined();
    expect(
      getRejectedSubmissionId({ type: "send", data: null }),
    ).toBeUndefined();
    expect(
      getRejectedSubmissionId({ type: "send", data: { submissionId: 42 } }),
    ).toBeUndefined();
  });
});

describe("isSameSubmissionPayload", () => {
  test("accepts an exact persisted payload, including null/undefined reply equivalence", () => {
    expect(isSameSubmissionPayload(submission, { ...submission })).toBe(true);
    expect(
      isSameSubmissionPayload(
        { type: "text", content: "hello", replyTo: null },
        { ...submission, replyTo: undefined },
      ),
    ).toBe(true);
  });

  test("detects changes to content, type, or any ReplyRef field", () => {
    expect(
      isSameSubmissionPayload(submission, {
        ...submission,
        content: "changed",
      }),
    ).toBe(false);
    expect(
      isSameSubmissionPayload(submission, {
        ...submission,
        type: "image",
        content: '["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]',
      }),
    ).toBe(false);
    expect(
      isSameSubmissionPayload(submission, {
        ...submission,
        replyTo: { ...submission.replyTo!, snippet: "changed" },
      }),
    ).toBe(false);
  });
});

describe("getVisibleSubmissionId", () => {
  test("exposes an id only to the user who submitted the message", () => {
    const stored = { userId: "user-1", submissionId: "submission-1" };
    expect(getVisibleSubmissionId(stored, "user-1")).toBe("submission-1");
    expect(getVisibleSubmissionId(stored, "user-2")).toBeUndefined();
    expect(
      getVisibleSubmissionId(
        { userId: "user-1", submissionId: null },
        "user-1",
      ),
    ).toBeUndefined();
  });
});
