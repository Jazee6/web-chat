import type { RoomInfo } from "@/components/room-state-dialog.tsx";
import useIdleDetector from "@/hooks/use-idle-detector.ts";
import useSettings from "@/hooks/use-settings.ts";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import {
  api,
  appName,
  calculateSHA256,
  convertImageToWebP,
  getNotificationBody,
  pushNotification,
} from "@/lib/utils.ts";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import ky from "ky";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  gm,
  type RoomRealtime,
  type RoomStats,
  sendMessageSchema,
  type ServerMessage,
  type ServerRealtimeStatus,
  type UIChatMessage,
} from "web-chat-share";
import { z } from "zod";

export function useRoom({
  id,
  user,
  chatListRef,
  loaderRef,
}: {
  id: string;
  user: User;
  chatListRef: RefObject<HTMLDivElement | null>;
  loaderRef: RefObject<HTMLDivElement | null>;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<UIChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const { users, fetchMissingUsers } = useUserInfo();
  const [settings] = useSettings();
  const { start, userState, screenState } = useIdleDetector();
  const [roomRealtime, setRoomRealtime] = useState<RoomRealtime>();
  const [realtimeStatus, setRealtimeStatus] = useState<ServerRealtimeStatus[]>(
    [],
  );

  const notificationListRef = useRef<Notification[]>([]);
  const oldestChatTimeRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldScrollToBottomRef = useRef(false);

  const { data: roomInfo } = useQuery({
    queryKey: ["roomInfo", id],
    queryFn: () => api.get<RoomInfo>(`room/${id}/info`).json(),
  });

  useEffect(() => {
    if (roomInfo) {
      document.title = `${roomInfo.name} - ${appName}`;
    }
  }, [roomInfo]);

  const scrollToBottom = useEffectEvent(
    (behavior: ScrollBehavior = "smooth") => {
      if (chatListRef.current) {
        chatListRef.current.scrollTo({
          top: chatListRef.current.scrollHeight,
          behavior,
        });
      }
    },
  );

  const {
    sendMessage,
    readyState,
    connect,
    webSocketIns: ws,
  } = useWebSocket(`${import.meta.env.VITE_API_URL}/room/${id}/ws`, {
    onOpen: (_, instance) => {
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
      }, 1000 * 45);
    },
    onError: (_, instance) => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      instance.close();
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
          setRoomStats({
            ...m.data,
            users: m.data.users.filter(
              (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
            ),
          });
          break;
        }
        case "initHistory": {
          setIsLoading(false);
          if (m.data.length < 25) {
            setHasMore(false);
          }
          if (m.data.length === 0) {
            return;
          }
          setChats(m.data);
          oldestChatTimeRef.current = m.data[0].createdAt;
          fetchMissingUsers(m.data.map((c) => c.userId));
          break;
        }
        case "history": {
          if (m.data.length < 25) {
            setHasMore(false);
          }
          if (m.data.length === 0) {
            return;
          }
          if (chatListRef.current) {
            previousScrollHeightRef.current = chatListRef.current.scrollHeight;
            isLoadingHistoryRef.current = true;
          }
          setChats((chats) => [...m.data, ...chats]);
          oldestChatTimeRef.current = m.data[0].createdAt;
          fetchMissingUsers(m.data.map((c) => c.userId));
          break;
        }
        case "message": {
          if (chatListRef.current) {
            const { scrollTop, scrollHeight, clientHeight } =
              chatListRef.current;
            shouldScrollToBottomRef.current =
              scrollTop + clientHeight >= scrollHeight - 100;
          } else {
            shouldScrollToBottomRef.current = true;
          }

          setChats((chats) => [...chats, m.data]);
          fetchMissingUsers([m.data.userId]);

          if (document.visibilityState !== "visible") {
            const u = users[m.data.userId];
            document.head
              .querySelector("link[rel='icon']")
              ?.setAttribute("href", "/message-circle-more.svg");

            const n = pushNotification(u?.name ?? "New Message", {
              body: getNotificationBody(m.data),
              icon: u?.image ?? "/icon.svg",
            });
            if (n) {
              notificationListRef.current.push(n);
            }
          }
          break;
        }
        case "roomRealtime": {
          setRoomRealtime(m.data);
          break;
        }
        case "realtimeStatus": {
          setRealtimeStatus(m.data.filter((i) => i.userId !== user.id));
          break;
        }
      }
    },
  });

  useEffect(() => {
    if (settings?.showStatus) {
      start().then();
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
    if (isLoading) {
      return;
    }

    scrollToBottom("instant");
  }, [isLoading]);

  useLayoutEffect(() => {
    if (isLoadingHistoryRef.current && chatListRef.current) {
      const newScrollHeight = chatListRef.current.scrollHeight;
      const diff = newScrollHeight - previousScrollHeightRef.current;
      chatListRef.current.scrollTop += diff;
      isLoadingHistoryRef.current = false;
    } else if (shouldScrollToBottomRef.current) {
      scrollToBottom();
      shouldScrollToBottomRef.current = false;
    }
  }, [chats, chatListRef]);

  useEffect(() => {
    if (!loaderRef.current || isLoading) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && oldestChatTimeRef.current) {
          sendMessage(
            gm({
              type: "loadHistory",
              data: {
                before: oldestChatTimeRef.current,
              },
            }),
          );
        }
      });
    });

    observer.observe(loaderRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isLoading, loaderRef, sendMessage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        notificationListRef.current.forEach((n) => n.close());
        notificationListRef.current = [];

        document.head
          .querySelector("link[rel='icon']")
          ?.setAttribute("href", "/icon.svg");

        if (readyState !== WebSocket.OPEN) {
          connect();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [connect, readyState]);

  const onSend = async (
    data: z.infer<typeof sendMessageSchema> & {
      images: File[];
    },
  ) => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    const { message, images: rawImages } = data;
    let hasSetMessage = false;

    if (rawImages.length > 0) {
      const messageId = crypto.randomUUID();
      setChats((p) => {
        shouldScrollToBottomRef.current = true;
        const n = [
          ...p,
          {
            id: messageId,
            userId: user.id,
            type: "image" as const,
            content: "",
            localFiles: rawImages.map((i) => ({
              file: i,
              isUploading: true,
            })),
            createdAt: new Date().toISOString(),
          },
        ];

        if (message) {
          hasSetMessage = true;
          n.push({
            id: crypto.randomUUID(),
            userId: user.id,
            type: "text",
            content: message,
            createdAt: new Date().toISOString(),
          });
        }

        return n;
      });

      const images = await Promise.all(
        rawImages.map((i) => convertImageToWebP(i)),
      );
      const sha256List = await Promise.all(images.map(calculateSHA256));
      const imageContent = JSON.stringify(sha256List);

      const u = await api
        .post<
          {
            url: string | null;
            key: string;
          }[]
        >("room/upload/presigned", {
          json: { sha256List },
        })
        .json();

      await Promise.all(
        u.map(async (u, i) => {
          if (u.url) {
            await ky.put(u.url, {
              body: images[i],
            });
          }
          setChats((p) =>
            p.map((c) => {
              if (c.id === messageId) {
                return {
                  ...c,
                  localFiles: c.localFiles?.map((f, index) => {
                    if (index === i) {
                      return {
                        ...f,
                        isUploading: false,
                      };
                    }
                    return f;
                  }),
                };
              }
              return c;
            }),
          );
        }),
      );

      sendMessage(
        gm({
          type: "send",
          data: {
            type: "image",
            content: imageContent,
          },
        }),
      );
    }

    if (message) {
      if (!hasSetMessage) {
        shouldScrollToBottomRef.current = true;
        setChats((p) => [
          ...p,
          {
            id: crypto.randomUUID(),
            userId: user.id,
            type: "text",
            content: message,
            createdAt: new Date().toISOString(),
          },
        ]);
      }

      sendMessage(
        gm({
          type: "send",
          data: {
            type: "text",
            content: message,
          },
        }),
      );
    }
  };

  return {
    ws,
    isLoading,
    hasMore,
    chats,
    users,
    roomStats,
    roomInfo,
    roomRealtime,
    realtimeStatus,
    onSend,
  };
}
