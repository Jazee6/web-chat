import ChatList from "@/components/chat-list.tsx";
import RoomStateDialog from "@/components/room-state-dialog.tsx";

import ChatInput from "@/components/chat-input.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { api, pushNotification } from "@/lib/utils.ts";
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

interface RoomInfo {
  name: string;
}

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
  const [roomInfo, setRoomInfo] = useState<RoomInfo>();

  const chatListRef = useRef<HTMLDivElement>(null);
  const notificationListRef = useRef<Notification[]>([]);
  const loaderRef = useRef<HTMLDivElement>(null);
  const oldestChatTimeRef = useRef<string>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);

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
      },
      onError: (_, instance) => {
        toast.error("WebSocket error occurred");
        instance.close();
      },
      onMessage: (message) => {
        const m = JSON.parse(message.data) as ServerMessage;
        switch (m.type) {
          case "roomStats":
            setRoomStats(m.data);
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

              const n = pushNotification("New message", {
                body: m.data.content,
              });
              if (n) {
                notificationListRef.current.push(n);
              }
            }
            if (chatListRef.current) {
              const { scrollTop, scrollHeight, clientHeight } =
                chatListRef.current;
              const isAtBottom = scrollTop + clientHeight >= scrollHeight - 50;
              if (isAtBottom) {
                scrollToBottom();
              }
            }
            break;
          }
        }
      },
    },
  );

  useEffect(() => {
    api
      .get<RoomInfo>("room/info/" + id)
      .json()
      .then(setRoomInfo);
  }, [id]);

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
      {roomStats && (
        <header className="h-16 absolute top-0 w-full z-10 bg-linear-to-b from-background to-transparent rounded-t-xl backdrop-blur-xl">
          <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center justify-between">
            <div className="max-[1080px]:ml-12">{roomInfo?.name}</div>

            <div className="flex items-center">
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
              {"share" in navigator && !isPipActive && <ShareButton />}
              <RoomStateDialog
                roomStats={roomStats}
                className="ml-1"
                disabled={isPipActive}
              />
            </div>
          </div>
        </header>
      )}

      {chats && (
        <div
          style={{ scrollbarGutter: "stable both-edges" }}
          className="overflow-y-auto scrollbar pt-16 pb-60 h-[calc(100vh-1rem)]"
          ref={chatListRef}
        >
          {hasMore && !isLoading && (
            <div ref={loaderRef} className="flex justify-center py-4">
              <Spinner />
            </div>
          )}

          <ChatList chats={chats} userId={user.id} userIds={userIds} />
        </div>
      )}

      <ChatInput onSend={onSend} isLoading={isLoading} />
    </>
  );
};

export default Room;
