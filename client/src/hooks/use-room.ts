import type { RoomInfo } from "@/components/room-state-dialog.tsx";
import useIdleDetector from "@/hooks/use-idle-detector.ts";
import { useRoomChat } from "@/hooks/use-room-chat.ts";
import { useRoomFavicon } from "@/hooks/use-room-favicon.ts";
import { useRoomImages } from "@/hooks/use-room-images.ts";
import { useRoomNotifications } from "@/hooks/use-room-notifications.ts";
import useSettings from "@/hooks/use-settings.ts";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import { getTabId } from "@/lib/tab-id.ts";
import { api, appName } from "@/lib/utils.ts";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  gm,
  type RoomRealtime,
  sendMessageSchema,
  type ServerMessage,
  type ServerRealtimeStatus,
} from "web-chat-share";
import { z } from "zod";

export function useRoom({
  id,
  user,
  chatListRef,
  contentRef,
  loaderRef,
  onOpen,
}: {
  id: string;
  user: User;
  chatListRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  loaderRef: RefObject<HTMLDivElement | null>;
  onOpen?: () => void;
}) {
  const { users, fetchMissingUsers } = useUserInfo();
  const [settings] = useSettings();
  const { start, userState, screenState } = useIdleDetector();
  const { setFaviconState } = useRoomFavicon();
  const [roomRealtime, setRoomRealtime] = useState<RoomRealtime>();
  const [realtimeStatus, setRealtimeStatus] =
    useState<ServerRealtimeStatus[]>();
  // Intended typing state, edge-triggered by ChatInput (start on first keystroke
  // after idle, stop after 2s of inactivity / on submit / blur). State-driven so
  // the effect below re-sends it on WS reconnect — mirroring the presence effect.
  // See ADR 0002: no heartbeat; cleared by disconnect, not by a timeout.
  const [typing, setTyping] = useState(false);

  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomRealtimeTotalRef = useRef(0);

  const { data: roomInfo } = useQuery({
    queryKey: ["roomInfo", id],
    queryFn: () => api.get<RoomInfo>(`room/${id}/info`).json(),
  });

  useEffect(() => {
    if (roomInfo) {
      document.title = `${roomInfo.name} - ${appName}`;
    }
  }, [roomInfo]);

  const {
    sendMessage,
    readyState,
    connect,
    webSocketIns: ws,
  } = useWebSocket(
    `${import.meta.env.VITE_API_URL}/room/${id}/ws?tab_id=${getTabId()}`,
    {
      onOpen: (_, instance) => {
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        instance.send(
          gm({
            type: "join",
          }),
        );
        pingIntervalRef.current = setInterval(() => {
          instance.send(
            gm({
              type: "ping",
            }),
          );
        }, 1000 * 5);
        onOpen?.();
      },
      onClose: () => {
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
      },
      onMessage: (message) => {
        const m = JSON.parse(message.data) as ServerMessage;
        switch (m.type) {
          case "roomStats": {
            chat.handleRoomStats(m.data);
            break;
          }
          case "initHistory": {
            chat.handleInitHistory(m.data);
            break;
          }
          case "history": {
            chat.handleHistory(m.data);
            break;
          }
          case "message": {
            chat.handleMessage(m.data);
            notifications.notifyOnMessage(m.data);
            break;
          }
          case "roomRealtime": {
            roomRealtimeTotalRef.current = m.data.total;
            setRoomRealtime(m.data);
            setFaviconState({ hasRealtime: m.data.total > 0 });
            break;
          }
          case "realtimeStatus": {
            setRealtimeStatus(m.data);
            break;
          }
        }
      },
    },
  );

  const chat = useRoomChat({
    chatListRef,
    contentRef,
    loaderRef,
    userId: user.id,
    sendMessage,
    fetchMissingUsers,
  });

  const { sendImages } = useRoomImages({
    userId: user.id,
    setChats: chat.setChats,
    sendMessage,
    readyState,
    requestStickToBottom: chat.requestStickToBottom,
  });

  const notifications = useRoomNotifications({ users });

  const roomStats = chat.roomStats;

  // Typing users arrive in roomStats as {id, status} only — no avatar/name.
  // Those come from the users map, fetched on demand. Message senders are
  // fetched in handleMessage, but a user can type without ever having sent a
  // visible message, so fetch them here or the indicator falls back to a raw
  // ID. fetchMissingUsers dedups, so this is a no-op once a user is known —
  // mirrors RoomStateDialog's on-demand fetch when it opens.
  useEffect(() => {
    const typingIds = (roomStats?.users ?? [])
      .filter((u) => u.id !== user.id && u.status?.typing)
      .map((u) => u.id);
    if (typingIds.length > 0) {
      fetchMissingUsers(typingIds);
    }
  }, [roomStats, user.id, fetchMissingUsers]);

  useEffect(() => {
    if (settings?.showStatus) {
      void start();
    }
  }, [settings.showStatus, start]);

  useEffect(() => {
    if (!settings.showStatus || readyState !== WebSocket.OPEN) {
      return;
    }

    sendMessage(
      gm({
        type: "userStatus",
        data: {
          user: userState,
          screen: screenState,
        },
      }),
    );
  }, [screenState, settings.showStatus, userState, readyState, sendMessage]);

  // Broadcast typing. Defaults on: new users via the settings defaultValue,
  // existing users (whose stored settings predate the field and see `undefined`,
  // since useLocalStorageState doesn't backfill defaults) via the `=== false`
  // check below — only an explicit opt-out suppresses. When opted out, send
  // nothing at all (not even a clearing false): toggling the setting requires
  // leaving the chat for the Settings route, which blurs the textarea and fires
  // stopTyping first, so there's no in-flight typing:true to clear. On a WS
  // reconnect while opted in, readyState flips OPEN and this re-sends the
  // current value. Sends a partial {typing}; the server merges it onto presence
  // (ADR 0002).
  useEffect(() => {
    if (readyState !== WebSocket.OPEN) return;
    if (!settings?.showTyping) return;
    sendMessage(
      gm({
        type: "userStatus",
        data: {
          typing,
        },
      }),
    );
  }, [typing, settings?.showTyping, readyState, sendMessage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        notifications.clearNotifications();
        setFaviconState({ hasRealtime: roomRealtimeTotalRef.current > 0 });

        if (readyState !== WebSocket.OPEN) {
          connect();
        }
      }
    };

    const handleOnline = () => {
      if (readyState !== WebSocket.OPEN) {
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      removeEventListener("online", handleOnline);
    };
  }, [connect, readyState, notifications, setFaviconState]);

  const onSend = async (
    data: z.infer<typeof sendMessageSchema> & {
      images: File[];
    },
  ) => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    const { message, images: rawImages } = data;

    if (rawImages.length > 0) {
      await sendImages(rawImages, message || undefined);
    } else if (message) {
      chat.sendText(message);
    }
  };

  return {
    ws,
    readyState,
    isLoading: chat.isLoading,
    hasMore: chat.hasMore,
    chats: chat.chats,
    users,
    roomStats,
    roomInfo,
    roomRealtime,
    realtimeStatus,
    onSend,
    setTyping,
    stickToBottom: chat.stickToBottom,
    unreadCount: chat.unreadCount,
    scrollToBottom: chat.scrollToBottom,
  };
}
