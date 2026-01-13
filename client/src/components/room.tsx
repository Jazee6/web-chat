import ChatList from "@/components/chat-list.tsx";
import Footer from "@/components/footer.tsx";
import RoomStateDialog from "@/components/room-state-dialog.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pushNotification } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import { ArrowUpIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  type ChatMessage,
  gm,
  type RoomStats,
  type ServerMessage,
} from "web-chat-share";
import { z } from "zod";

const sendMessageSchema = z.object({
  message: z.string().min(1),
});

const Room = ({ id, user }: { id: string; user: User }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);

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
            if (m.data.length === 0) {
              return;
            }
            if (m.data.length < 25) {
              setHasMore(false);
            }
            setChats(m.data);
            setIsLoading(false);
            setTimeout(() => scrollToBottom("instant"));
            oldestChatTimeRef.current = m.data[0].createdAt;
            break;
          case "history":
            if (m.data.length === 0) {
              return;
            }
            if (m.data.length < 25) {
              setHasMore(false);
            }
            if (chatListRef.current) {
              previousScrollHeightRef.current =
                chatListRef.current.scrollHeight;
              isLoadingHistoryRef.current = true;
            }
            setChats((chats) => [...m.data, ...chats]);
            oldestChatTimeRef.current = m.data[0].createdAt;
            break;
          case "message": {
            setChats((chats) => [...chats, m.data]);
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

  const form = useForm<z.infer<typeof sendMessageSchema>>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      message: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    form.reset();
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
    scrollToBottom();
  };

  return (
    <>
      {roomStats && (
        <header className="h-16 absolute top-0 w-full z-10 bg-linear-to-b from-background to-transparent rounded-t-xl">
          <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center">
            <RoomStateDialog roomStats={roomStats} />
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

          <ChatList chats={chats} userId={user.id} />
        </div>
      )}

      <form
        className="absolute bottom-0 w-full max-md:px-2 bg-linear-to-t from-background to-transparent rounded-b-xl"
        onSubmit={(e) => form.handleSubmit(onSubmit)(e)}
      >
        <InputGroup className="max-w-3xl mx-auto max-h-64 dark:!bg-[#151515]">
          <Controller
            name="message"
            control={form.control}
            render={({ field }) => (
              <>
                <InputGroupTextarea
                  className="scrollbar"
                  placeholder="Text here..."
                  autoFocus
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      form.handleSubmit(onSubmit)();
                    }
                  }}
                  {...field}
                />
                <InputGroupAddon align="block-end">
                  <InputGroupButton
                    variant="default"
                    className="rounded-full ml-auto"
                    size="icon-xs"
                    type="submit"
                    disabled={isLoading}
                  >
                    {isLoading ? <Spinner /> : <ArrowUpIcon />}
                    <span className="sr-only">Send</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </>
            )}
          />
        </InputGroup>

        <Footer classname="my-2" />
      </form>
    </>
  );
};

export default Room;
