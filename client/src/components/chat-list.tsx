import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import type { User } from "@/lib/auth-client.ts";
import { cn, formatChatListTime } from "@/lib/utils.ts";
import dayjs from "dayjs";
import { Fragment, useMemo } from "react";
import type { ChatMessage } from "web-chat-share";

const formatContent = (content: string) => {
  const urlRegex = /(https?:\/\/\S+)/g;
  return content.split(urlRegex).map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const isEmojiOnly = (content: string) => {
  try {
    const isEmojiRegex = /^\p{RGI_Emoji}{1,3}$/v;
    return isEmojiRegex.test(content);
  } catch {
    return false;
  }
};

const ChatList = ({
  chats,
  className,
  userId,
  users,
}: {
  chats: ChatMessage[];
  className?: string;
  userId: string;
  users: {
    [userId: string]: User;
  };
}) => {
  const groups = useMemo(() => {
    const res: {
      id: string;
      userId: string;
      messages: ChatMessage[];
      showTime: boolean;
      time: string;
    }[] = [];
    let currentGroup: (typeof res)[0] | null = null;

    chats.forEach((c, i) => {
      const prevMessage = chats[i - 1];
      const showTime =
        !prevMessage ||
        dayjs(c.createdAt).diff(dayjs(prevMessage.createdAt), "minute") > 5;

      if (showTime || !currentGroup || currentGroup.userId !== c.userId) {
        currentGroup = {
          id: c.id,
          userId: c.userId,
          messages: [c],
          showTime,
          time: c.createdAt,
        };
        res.push(currentGroup);
      } else {
        currentGroup.messages.push(c);
      }
    });

    return res;
  }, [chats]);

  return (
    <ul className={cn("space-y-4 pb-4", className)}>
      {groups.map((group) => {
        const isMe = group.userId === userId;
        const user = users[group.userId];

        return (
          <Fragment key={group.id}>
            {group.showTime && (
              <li className="flex justify-center py-4 text-xs text-muted-foreground brightness-75 ani-slide-top">
                {formatChatListTime(group.time)}
              </li>
            )}

            <li
              className={cn(
                "max-w-3xl px-1 mx-auto w-full flex",
                isMe ? "justify-end" : "",
              )}
            >
              <div className="flex gap-1 max-w-[90%]">
                {!isMe && (
                  <Avatar className="self-end sticky bottom-1 hover:brightness-75 transition shrink-0 ani-slide-top">
                    <AvatarImage
                      src={user?.image ?? undefined}
                      alt={user?.name || "Avatar"}
                    />
                    <AvatarFallback>
                      {user?.name.slice(0, 2) ?? group.userId.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                )}

                <div className="flex flex-col gap-1">
                  {group.messages.map((c) => {
                    const isEmoji = isEmojiOnly(c.content);
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "flex gap-1 ani-slide-top",
                          isMe ? "flex-row-reverse" : "",
                        )}
                      >
                        <div
                          className={cn(
                            "rounded-md wrap-anywhere whitespace-pre-wrap hover:brightness-75 transition peer",
                            isEmoji
                              ? "bg-transparent text-5xl"
                              : "bg-secondary px-2 py-1",
                          )}
                        >
                          {formatContent(c.content)}
                        </div>

                        <div className="text-muted text-xs self-end opacity-0 peer-hover:opacity-100 transition-opacity">
                          {dayjs(c.createdAt).format("HH:mm")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
};

export default ChatList;
