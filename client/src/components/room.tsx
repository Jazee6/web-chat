import ChatList from "@/components/chat-list.tsx";
import RoomStateDialog, {
  type RoomInfo,
} from "@/components/room-state-dialog.tsx";

import AddFavoritesButton from "@/components/add-favorites-button.tsx";
import ChatInput from "@/components/chat-input.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { api, appName, pushNotification } from "@/lib/utils.ts";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import { PictureInPicture } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type ChatMessage,
  gm,
  type RoomStats,
  sendMessageSchema,
  type ServerMessage,
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
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [roomStateDialogOpen, setRoomStateDialogOpen] = useState(false);
  const [users, setUsers] = useState<{
    [userId: string]: User;
  }>({});

  const chatListRef = useRef<HTMLDivElement>(null);
  const notificationListRef = useRef<Notification[]>([]);
  const loaderRef = useRef<HTMLDivElement>(null);
  const oldestChatTimeRef = useRef<string>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const pingIntervalRef = useRef<number>(null);

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

  useEffect(() => {
    const ids = userIds.filter((id) => !users[id]);
    if (ids.length === 0) {
      return;
    }

    api
      .get<User[]>("room/user", {
        searchParams: new URLSearchParams({
          ids: ids.join(","),
        }),
      })
      .json()
      .then((i) => {
        const newUsers: { [userId: string]: User } = {};
        i.forEach((u) => {
          newUsers[u.id] = u;
        });
        setUsers((prev) => ({ ...prev, ...newUsers }));
      });
  }, [userIds, users]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (chatListRef.current) {
      chatListRef.current.scrollTo({
        top: chatListRef.current.scrollHeight,
        behavior,
      });
    }
  };

  const { sendMessage } = useWebSocket(
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
        }, 1000 * 60);
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
          case "roomStats":
            setRoomStats({
              ...m.data,
              users: m.data.users.filter(
                (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
              ),
            });
            break;
          case "initHistory":
            setIsLoading(false);
            if (m.data.length < 25) {
              setHasMore(false);
            }
            if (m.data.length === 0) {
              return;
            }
            setChats(m.data);
            setUserIds(Array.from(new Set(m.data.map((c) => c.userId))));
            oldestChatTimeRef.current = m.data[0].createdAt;
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
            setUserIds((prev) =>
              Array.from(new Set([...prev, ...m.data.map((c) => c.userId)])),
            );
            oldestChatTimeRef.current = m.data[0].createdAt;
            break;
          case "message": {
            setChats((chats) => [...chats, m.data]);
            setUserIds((prev) => {
              if (prev.includes(m.data.userId)) return prev;
              return [...prev, m.data.userId];
            });
            if (document.visibilityState !== "visible") {
              document.head
                .querySelector("link[rel='icon']")
                ?.setAttribute("href", "/message-circle-more.svg");

              const n = pushNotification(
                users[m.data.userId]?.name ?? "New Message",
                {
                  body: m.data.content,
                  icon: users[m.data.userId]?.image ?? "/icon.svg",
                },
              );
              if (n) {
                notificationListRef.current.push(n);
              }
            }
            setTimeout(() => {
              if (chatListRef.current) {
                const { scrollTop, scrollHeight, clientHeight } =
                  chatListRef.current;
                const isAtBottom =
                  scrollTop + clientHeight >= scrollHeight - 50;
                if (isAtBottom) {
                  scrollToBottom();
                }
              }
            }, 10);
            break;
          }
          case "pong": {
            setUsers((u) => ({ ...u }));
            break;
          }
        }
      },
    },
  );

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
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const onSend = async (data: z.infer<typeof sendMessageSchema>) => {
    const { message } = data;
    sendMessage(
      gm({
        type: "send",
        data: message,
      }),
    );
    setChats((p) => [
      ...p,
      {
        id: crypto.randomUUID(),
        userId: user.id,
        content: message,
        createdAt: new Date().toISOString(),
      },
    ]);

    queueMicrotask(() => scrollToBottom());
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
            className="overflow-y-auto scrollbar pt-16 "
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
            />
          </div>
        )}

        <ChatInput className="mt-auto" onSend={onSend} isLoading={isLoading} />
      </div>
    </>
  );
};

export default Room;
