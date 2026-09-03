import { useRoomFavicon } from "@/hooks/use-room-favicon.ts";
import { clearRoomNotifications } from "@/lib/push.ts";
import { useCallback } from "react";
import type { ChatMessage } from "web-chat-share";

type UseRoomNotificationsParams = {
  roomId: string;
  userId: string;
};

type UseRoomNotificationsReturn = {
  handleIncomingMessage: (message: ChatMessage) => void;
  clearNotifications: () => void;
};

export function useRoomNotifications({
  roomId,
  userId,
}: UseRoomNotificationsParams): UseRoomNotificationsReturn {
  const { setFaviconState, clearUnread } = useRoomFavicon();

  const handleIncomingMessage = useCallback(
    (message: ChatMessage) => {
      if (
        document.visibilityState === "visible" ||
        message.authorType === "system" ||
        message.userId === userId
      ) {
        return;
      }

      setFaviconState({ hasUnread: true });
    },
    [setFaviconState, userId],
  );

  const clearNotifications = useCallback(() => {
    void clearRoomNotifications(roomId);
    clearUnread();
  }, [roomId, clearUnread]);

  return { handleIncomingMessage, clearNotifications };
}
