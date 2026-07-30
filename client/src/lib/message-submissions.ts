import type {
  ChatMessage,
  MessageAcceptance,
  UIChatMessage,
} from "web-chat-share";

export const reconcileMessageAcceptance = (
  chats: UIChatMessage[],
  { submissionId, message }: MessageAcceptance,
): UIChatMessage[] => {
  const optimisticIndex = chats.findIndex(
    (chat) => chat.submissionId === submissionId,
  );

  if (optimisticIndex === -1) {
    const canonicalIndex = chats.findIndex((chat) => chat.id === message.id);
    if (canonicalIndex === -1) return [...chats, message];
    return chats.map((chat, index) =>
      index === canonicalIndex ? message : chat,
    );
  }

  const reconciled: UIChatMessage[] = [];
  chats.forEach((chat, index) => {
    if (index === optimisticIndex) {
      reconciled.push(message);
    } else if (chat.id !== message.id) {
      reconciled.push(chat);
    }
  });
  return reconciled;
};

export const mergeInitialHistory = (
  chats: UIChatMessage[],
  history: ChatMessage[],
): UIChatMessage[] => {
  const localSubmissions = chats.filter((chat) => chat.submissionId);
  return localSubmissions.length > 0
    ? [...history, ...localSubmissions]
    : history;
};
