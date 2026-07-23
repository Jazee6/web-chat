export const AI_INVOCATION_COOLDOWN_MS = 10_000;
export const AI_PENDING_LIMIT = 5;
export const AI_CONTEXT_LIMIT = 50;

const roomAiMention = /(^|[^\p{L}\p{N}_@])@ai(?![\p{L}\p{N}_])/iu;

export const hasRoomAiMention = (content: string) =>
  roomAiMention.test(content);

export interface AiContextMessage {
  authorType: "user" | "ai" | "system";
  type: "text" | "image";
}

export const selectRoomAiContext = <T extends AiContextMessage>(
  messages: T[],
) =>
  messages
    .filter(
      (message) => message.type === "text" && message.authorType !== "system",
    )
    .slice(-AI_CONTEXT_LIMIT);

export const getAiInvocationRejection = ({
  now,
  lastAcceptedAt,
  pendingCount,
}: {
  now: number;
  lastAcceptedAt?: number;
  pendingCount: number;
}): "rate_limited" | "queue_full" | null => {
  if (
    lastAcceptedAt !== undefined &&
    now - lastAcceptedAt < AI_INVOCATION_COOLDOWN_MS
  ) {
    return "rate_limited";
  }
  if (pendingCount >= AI_PENDING_LIMIT) return "queue_full";
  return null;
};

export const clearPendingAiInvocations = <T>(queue: T[]) => queue.splice(0);
