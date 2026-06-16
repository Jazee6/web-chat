import type { RoomInfo } from "@/components/room-state-dialog.tsx";
import useIdleDetector from "@/hooks/use-idle-detector.ts";
import { useRoomChat } from "@/hooks/use-room-chat.ts";
import { useRoomFavicon } from "@/hooks/use-room-favicon.ts";
import { useRoomImages } from "@/hooks/use-room-images.ts";
import { useRoomNotifications } from "@/hooks/use-room-notifications.ts";
import useSettings from "@/hooks/use-settings.ts";
import { useUserInfo } from "@/hooks/use-user-info.ts";
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
  loaderRef,
  onOpen,
}: {
  id: string;
  user: User;
  chatListRef: RefObject<HTMLDivElement | null>;
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
  } = useWebSocket(`${import.meta.env.VITE_API_URL}/room/${id}/ws`, {
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
  });

  const chat = useRoomChat({
    chatListRef,
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
  });

  const notifications = useRoomNotifications({ users });

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
    isLoading: chat.isLoading,
    hasMore: chat.hasMore,
    chats: chat.chats,
    users,
    roomStats: chat.roomStats,
    roomInfo,
    roomRealtime,
    realtimeStatus,
    onSend,
  };
}
