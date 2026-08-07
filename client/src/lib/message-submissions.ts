import type {
  HistoryChatMessage,
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
    if (optimistic.localFiles?.length) {
      const reconciledCanonicalIndex =
        canonicalIndex > optimisticIndex ? canonicalIndex - 1 : canonicalIndex;
      return chats
        .filter((_, index) => index !== optimisticIndex)
        .map((chat, index) =>
          index === reconciledCanonicalIndex
            ? {
                ...message,
                renderKey: chat.renderKey,
                localFiles: optimistic.localFiles,
              }
            : chat,
        );
    }
    return chats.filter((_, index) => index !== optimisticIndex);
  }

  const canonical = {
    ...message,
    renderKey: optimistic.renderKey ?? optimistic.submissionId ?? optimistic.id,
    ...(optimistic.localFiles?.length
      ? { localFiles: optimistic.localFiles }
      : {}),
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
  history: HistoryChatMessage[],
): UIChatMessage[] => {
  const localBySubmissionId = new Map(
    chats
      .filter((chat) => chat.submissionId)
      .map((chat) => [chat.submissionId!, chat]),
  );
  const acceptedSubmissionIds = new Set(
    history.flatMap((message) =>
      message.submissionId ? [message.submissionId] : [],
    ),
  );
  const canonicalHistory = history.map(({ submissionId, ...message }) => {
    const local = submissionId
      ? localBySubmissionId.get(submissionId)
      : undefined;
    return local
      ? {
          ...message,
          renderKey: local.renderKey ?? local.submissionId ?? local.id,
          ...(local.localFiles?.length ? { localFiles: local.localFiles } : {}),
        }
      : message;
  });
  const localSubmissions = chats.filter(
    (chat) =>
      chat.submissionId && !acceptedSubmissionIds.has(chat.submissionId),
  );
  return localSubmissions.length > 0
    ? [...canonicalHistory, ...localSubmissions]
    : canonicalHistory;
};
