import { useRoomFavicon } from "@/hooks/use-room-favicon.ts";
import { getNotificationBody, pushNotification } from "@/lib/utils.ts";
import type { User } from "better-auth";
import { useCallback, useRef } from "react";
import type { ChatMessage } from "web-chat-share";

type UseRoomNotificationsParams = {
  users: Record<string, User>;
};

type UseRoomNotificationsReturn = {
  notifyOnMessage: (message: ChatMessage) => void;
  clearNotifications: () => void;
};

export function useRoomNotifications({
  users,
}: UseRoomNotificationsParams): UseRoomNotificationsReturn {
  const notificationListRef = useRef<Notification[]>([]);
  const { setFaviconState, clearUnread } = useRoomFavicon();

  const notifyOnMessage = useCallback(
    (message: ChatMessage) => {
      if (document.visibilityState === "visible") return;

      setFaviconState({ hasUnread: true });

      const u = users[message.userId];
      const n = pushNotification(u?.name ?? "New Message", {
        body: getNotificationBody(message),
        icon: u?.image ?? "/icon.svg",
      });
      if (n) {
        notificationListRef.current.push(n);
      }
    },
    [users, setFaviconState],
  );

  const clearNotifications = useCallback(() => {
    notificationListRef.current.forEach((n) => n.close());
    notificationListRef.current = [];
    clearUnread();
  }, [clearUnread]);

  return { notifyOnMessage, clearNotifications };
}
