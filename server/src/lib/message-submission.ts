import type { MessageSubmission, ReplyRef } from "web-chat-share";

type StoredSubmission = Pick<MessageSubmission, "type" | "content"> & {
  replyTo?: ReplyRef | null;
};

type StoredSubmissionOwner = {
  userId: string | null;
  submissionId: string | null;
};

export const getRejectedSubmissionId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.type !== "send" ||
    !envelope.data ||
    typeof envelope.data !== "object"
  ) {
    return;
  }
  const submissionId = (envelope.data as Record<string, unknown>).submissionId;
  return typeof submissionId === "string" ? submissionId : undefined;
};

const sameReplyRef = (
  left: ReplyRef | null | undefined,
  right: ReplyRef | null | undefined,
): boolean => {
  if (!left || !right) return !left && !right;
  return (
    left.id === right.id &&
    left.authorType === right.authorType &&
    left.userId === right.userId &&
    left.type === right.type &&
    left.snippet === right.snippet
  );
};

export const isSameSubmissionPayload = (
  stored: StoredSubmission,
  submitted: MessageSubmission,
): boolean =>
  stored.type === submitted.type &&
  stored.content === submitted.content &&
  sameReplyRef(stored.replyTo, submitted.replyTo);

export const getVisibleSubmissionId = (
  stored: StoredSubmissionOwner,
  viewerUserId: string,
): string | undefined =>
  stored.userId === viewerUserId
    ? (stored.submissionId ?? undefined)
    : undefined;
