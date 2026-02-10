import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import type { User } from "@/lib/auth-client.ts";
import { cn, formatChatListTime } from "@/lib/utils.ts";
import dayjs from "dayjs";
import { Fragment } from "react";
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
  return (
    <ul className={cn("space-y-1", className)}>
      {chats.map((c, i) => {
        const isEmoji = isEmojiOnly(c.content);
        const prevMessage = chats[i - 1];
        const showTime =
          !prevMessage ||
          dayjs(c.createdAt).diff(dayjs(prevMessage.createdAt), "minute") > 5;

        return (
          <Fragment key={c.id}>
            {showTime && (
              <li className="flex justify-center py-4 text-xs text-muted-foreground brightness-75 ani-slide-top">
                {formatChatListTime(c.createdAt)}
              </li>
            )}

            {c.userId === userId ? (
              <li className="max-w-3xl px-1 mx-auto w-full flex justify-end">
                <div className="ani-slide-top max-w-[90%] flex gap-2 group">
                  <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity sticky bottom-2">
                    {dayjs(c.createdAt).format("HH:mm")}
                  </div>

                  <div
                    className={cn(
                      "rounded-md break-all hover:brightness-75",
                      isEmoji
                        ? "bg-transparent text-5xl"
                        : "bg-secondary px-2 py-1",
                    )}
                  >
                    {formatContent(c.content)}
                  </div>
                </div>
              </li>
            ) : (
              <li className="max-w-3xl px-1 mx-auto w-full flex">
                <div className="flex gap-2 ani-slide-top group">
                  <div className="flex gap-1 max-w-[90%] ">
                    <Avatar className="self-end sticky bottom-2 hover:brightness-75">
                      <AvatarImage
                        src={users[c.userId]?.image ?? undefined}
                        alt={users[c.userId]?.name || "Avatar"}
                      />
                      <AvatarFallback>
                        {users[c.userId]?.name.slice(0, 2) ??
                          c.userId.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className={cn(
                        "rounded-md break-all hover:brightness-75",
                        isEmoji
                          ? "bg-transparent text-5xl"
                          : "bg-secondary px-2 py-1",
                      )}
                    >
                      {formatContent(c.content)}
                    </div>
                  </div>

                  <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity sticky bottom-2">
                    {dayjs(c.createdAt).format("HH:mm")}
                  </div>
                </div>
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
};

export default ChatList;
