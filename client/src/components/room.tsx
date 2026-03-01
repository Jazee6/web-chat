import AddFavoritesButton from "@/components/add-favorites-button.tsx";
import ChatInput from "@/components/chat-input.tsx";
import ChatList from "@/components/chat-list.tsx";
import RoomStateDialog, {
  type RoomInfo,
} from "@/components/room-state-dialog.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import useIdleDetector from "@/hooks/use-idle-detector.ts";
import useSettings from "@/hooks/use-settings.ts";
import {
  api,
  appName,
  getNotificationBody,
  pushNotification,
} from "@/lib/utils.ts";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import ky from "ky";
import { PictureInPicture } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  gm,
  type RoomStats,
  sendMessageSchema,
  type ServerMessage,
  type UIChatMessage,
} from "web-chat-share";
import { z } from "zod";

const Room = ({
  id,
  user,
  onTogglePip,
  isPipActive,
}: {
  id: string;
  user: User;
  onTogglePip?: () => void;
  isPipActive?: boolean;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<UIChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [roomStateDialogOpen, setRoomStateDialogOpen] = useState(false);
  const [users, setUsers] = useState<{
    [userId: string]: User;
  }>({});
  const [settings] = useSettings();
  const { start, userState, screenState } = useIdleDetector();

  const chatListRef = useRef<HTMLDivElement>(null);
  const notificationListRef = useRef<Notification[]>([]);
  const loaderRef = useRef<HTMLDivElement>(null);
  const oldestChatTimeRef = useRef<string>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const fetchingIdsRef = useRef<Set<string>>(new Set());
  const usersRef = useRef(users);

  useLayoutEffect(() => {
    usersRef.current = users;
  });

  const { data: roomInfo } = useQuery({
    queryKey: ["roomInfo", id],
    queryFn: () =>
      api
        .get<RoomInfo>(`room/${id}/info`)
        .json()
        .then((i) => {
          document.title = `${i.name} - ${appName}`;
          return i;
        }),
  });

  const fetchMissingUsers = useCallback((ids: string[]) => {
    const missingIds = Array.from(new Set(ids)).filter(
      (id) => !usersRef.current[id] && !fetchingIdsRef.current.has(id),
    );
    if (missingIds.length === 0) return;

    missingIds.forEach((id) => fetchingIdsRef.current.add(id));

    api
      .get<User[]>("room/user", {
        searchParams: new URLSearchParams({
          ids: missingIds.join(","),
        }),
      })
      .json()
      .then((newUsersList) => {
        const newUsersMap: Record<string, User> = {};
        newUsersList.forEach((u) => (newUsersMap[u.id] = u));
        setUsers((prev) => ({ ...prev, ...newUsersMap }));
      })
      .finally(() => {
        missingIds.forEach((id) => fetchingIdsRef.current.delete(id));
      });
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (chatListRef.current) {
      chatListRef.current.scrollTo({
        top: chatListRef.current.scrollHeight,
        behavior,
      });
    }
  };

  const { sendMessage, readyState, connect } = useWebSocket(
    `${import.meta.env.VITE_API_URL}/room/${id}/ws`,
    {
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
        toast.error("WebSocket error occurred");
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
          case "initHistory":
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
          case "history":
            if (m.data.length < 25) {
              setHasMore(false);
            }
            if (m.data.length === 0) {
              return;
            }
            if (chatListRef.current) {
              previousScrollHeightRef.current =
                chatListRef.current.scrollHeight;
              isLoadingHistoryRef.current = true;
            }
            setChats((chats) => [...m.data, ...chats]);
            oldestChatTimeRef.current = m.data[0].createdAt;
            fetchMissingUsers(m.data.map((c) => c.userId));
            break;
          case "message": {
            if (chatListRef.current) {
              const { scrollTop, scrollHeight, clientHeight } =
                chatListRef.current;
              shouldScrollToBottomRef.current =
                scrollTop + clientHeight >= scrollHeight - 50;
            } else {
              shouldScrollToBottomRef.current = true;
            }

            setChats((chats) => [...chats, m.data]);
            fetchMissingUsers([m.data.userId]);

            if (document.visibilityState !== "visible") {
              const u = usersRef.current[m.data.userId];
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
        }
      },
    },
  );

  useEffect(() => {
    if (settings?.showStatus) {
      start();
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
  }, [screenState, sendMessage, settings.showStatus, userState, readyState]);

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
  }, [chats]);

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
  }, [sendMessage, isLoading]);

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

    const { message, images } = data;
    let hasSetMessage = false;

    if (images.length > 0) {
      const u = await api
        .get<
          {
            url: string;
            key: string;
          }[]
        >(`room/upload/presigned/${images.length}`)
        .json();

      const content = JSON.stringify(u.map((u) => u.key));
      shouldScrollToBottomRef.current = true;
      const id = crypto.randomUUID();
      setChats((p) => {
        const n = [
          ...p,
          {
            id,
            userId: user.id,
            type: "image" as const,
            content,
            localFiles: images.map((i) => ({
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

      await Promise.all(
        u.map(async (u, i) => {
          await ky.put(u.url, {
            body: images[i],
          });
          setChats((p) =>
            p.map((c) => {
              if (c.id === id) {
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
            content,
          },
        }),
      );
    }

    if (message) {
      sendMessage(
        gm({
          type: "send",
          data: {
            type: "text",
            content: message,
          },
        }),
      );
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
    }
  };

  return (
    <>
      <header className="h-16 absolute top-0 w-full z-10 bg-linear-to-b from-background to-transparent rounded-t-xl backdrop-blur-xl">
        {roomStats && (
          <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center justify-between">
            <div className="max-[1080px]:ml-12">{roomInfo?.name}</div>

            <div className="flex items-center">
              <AddFavoritesButton
                id={id}
                added={!!roomInfo?.isFavorite}
                disabled={roomInfo?.userId === user.id}
              />
              {"documentPictureInPicture" in window && (
                <Button
                  size="icon-sm"
                  className="rounded-full"
                  variant="ghost"
                  onClick={onTogglePip}
                >
                  <PictureInPicture />
                </Button>
              )}
              {"share" in navigator && !isPipActive && (
                <ShareButton title={`${roomInfo?.name} - ${appName}`} />
              )}

              <Button
                className={"rounded-full size-6 ml-1"}
                disabled={isPipActive}
                onClick={() => setRoomStateDialogOpen(true)}
              >
                {roomStats.users.length}
              </Button>

              <RoomStateDialog
                roomStats={roomStats}
                roomInfo={roomInfo}
                open={roomStateDialogOpen}
                onOpenChange={setRoomStateDialogOpen}
              />
            </div>
          </div>
        )}
      </header>

      <div className="h-[calc(100vh-1rem)] flex flex-col">
        {chats && (
          <div
            style={{ scrollbarGutter: "stable both-edges" }}
            className="overflow-y-auto scrollbar pt-16 max-md:px-2"
            ref={chatListRef}
          >
            {hasMore && !isLoading && (
              <div ref={loaderRef} className="flex justify-center py-4">
                <Spinner />
              </div>
            )}

            <ChatList
              className="pb-32"
              chats={chats}
              userId={user.id}
              users={users}
              roomStats={roomStats}
            />
          </div>
        )}

        <ChatInput className="mt-auto" onSend={onSend} isLoading={isLoading} />
      </div>
    </>
  );
};

export default Room;
