import type { ReplyRef, UIChatMessage } from "web-chat-share";

const MAX_SNIPPET = 100;

// Builds the denormalized reply snapshot from a message — the wire-ready
// object stored on the reply and rendered as its Quote. Text → content
// truncated; image → the "[图片]" label, or "[图片] x N" when N>1. Image
// `content` is a JSON id-array, so for an optimistic (still-uploading) image
// message we read the count from `localFiles` instead. See ADR 0003.
const imageSnippet = (message: UIChatMessage): string => {
  const localCount = message.localFiles?.length;
  const count =
    localCount ??
    (message.content ? (JSON.parse(message.content) as string[]).length : 0);
  return count > 1 ? `[图片] x ${count}` : "[图片]";
};

export const toReplyRef = (message: UIChatMessage): ReplyRef => ({
  id: message.id,
  authorType: message.authorType === "ai" ? "ai" : "user",
  userId: message.userId,
  type: message.type,
  snippet:
    message.type === "image"
      ? imageSnippet(message)
      : message.content.slice(0, MAX_SNIPPET),
});
