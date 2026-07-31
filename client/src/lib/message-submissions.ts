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
    const existing = chats[canonicalIndex];
    return chats.map((chat, index) =>
      index === canonicalIndex && existing.renderKey
        ? { ...message, renderKey: existing.renderKey }
        : index === canonicalIndex
          ? message
          : chat,
    );
  }

  const optimistic = chats[optimisticIndex];
  const canonicalIndex = chats.findIndex((chat) => chat.id === message.id);
  if (canonicalIndex !== -1 && canonicalIndex !== optimisticIndex) {
    return chats.filter((_, index) => index !== optimisticIndex);
  }

  const canonical = {
    ...message,
    renderKey: optimistic.renderKey ?? optimistic.submissionId ?? optimistic.id,
  };
  const reconciled: UIChatMessage[] = [];
  chats.forEach((chat, index) => {
    if (index === optimisticIndex) {
      reconciled.push(canonical);
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
