import ChatList from "@/components/chat-list.tsx";
import Footer from "@/components/footer.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pushNotification } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWebSocket } from "ahooks";
import type { User } from "better-auth";
import { ArrowUpIcon, PhoneCall } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
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
  const chatListRef = useRef<HTMLDivElement>(null);
  const notificationListRef = useRef<Notification[]>([]);
  const [scroll, setScroll] = useState(true);

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
          case "history":
            setChats(m.data);
            setIsLoading(false);
            break;
          case "message": {
            setChats((chats) => [...chats, m.data]);
            const n = pushNotification("New message", {
              body: m.data.content,
            });
            if (n) {
              notificationListRef.current.push(n);
            }
            break;
          }
          case "received":
        }
      },
    },
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        notificationListRef.current.forEach((n) => n.close());
        notificationListRef.current = [];
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const scrollToBottom = () => {
    if (chatListRef.current) {
      chatListRef.current.scrollTo({
        top: chatListRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [scroll]);

  const form = useForm<z.infer<typeof sendMessageSchema>>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      message: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    if ("Notification" in window && Notification.permission !== "granted") {
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
    setChats([
      ...chats,
      {
        id: crypto.randomUUID(),
        userId: user.id,
        content: message,
        createdAt: new Date(),
      },
    ]);
    setScroll(!scroll);
  };

  return (
    <>
      {roomStats && (
        <header className="h-16 absolute top-0 w-full z-10 bg-linear-to-b from-background to-transparent rounded-t-xl">
          <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center">
            <Dialog>
              <DialogTrigger asChild>
                <Badge className="ml-auto">{roomStats?.users.length}</Badge>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Users in Room</DialogTitle>
                  <DialogDescription></DialogDescription>
                </DialogHeader>

                <ItemGroup>
                  {roomStats.users.map((u, index) => (
                    <Fragment key={u.id}>
                      <Item className="p-0">
                        {/*<ItemMedia>*/}
                        {/*  <Avatar>*/}
                        {/*    <AvatarImage*/}
                        {/*      src={person.avatar}*/}
                        {/*      className="grayscale"*/}
                        {/*    />*/}
                        {/*    <AvatarFallback>*/}
                        {/*      {person.username.charAt(0)}*/}
                        {/*    </AvatarFallback>*/}
                        {/*  </Avatar>*/}
                        {/*</ItemMedia>*/}
                        <ItemContent className="gap-1">
                          <ItemTitle>{u.id}</ItemTitle>
                          {/*<ItemDescription></ItemDescription>*/}
                        </ItemContent>
                        <ItemActions>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            disabled
                          >
                            <PhoneCall />
                          </Button>
                        </ItemActions>
                      </Item>
                      {index !== roomStats.users.length - 1 && (
                        <ItemSeparator />
                      )}
                    </Fragment>
                  ))}
                </ItemGroup>
              </DialogContent>
            </Dialog>
          </div>
        </header>
      )}

      {chats && (
        <div
          style={{ scrollbarGutter: "stable both-edges" }}
          className="overflow-y-auto scrollbar pt-20 pb-60 h-[calc(100vh-1rem)]"
          ref={chatListRef}
        >
          <ChatList chats={chats} userId={user.id} />
        </div>
      )}

      <form
        className="absolute bottom-0 w-full max-md:px-2 bg-linear-to-t from-background to-transparent rounded-t-xl"
        onSubmit={form.handleSubmit(onSubmit)}
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
