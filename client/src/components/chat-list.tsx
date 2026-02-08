import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import type { User } from "@/lib/auth-client.ts";
import { cn } from "@/lib/utils.ts";
import dayjs from "dayjs";
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
      {chats.map((c) => {
        if (c.userId === userId) {
          return (
            <li
              key={c.id}
              className="max-w-3xl px-1 mx-auto w-full flex justify-end"
            >
              <div className="ani-slide-top max-w-[90%] flex gap-2 group">
                <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity sticky bottom-2">
                  {dayjs(c.createdAt).fromNow()}
                </div>

                <div className="bg-secondary px-2 py-1 rounded-md break-all">
                  {formatContent(c.content)}
                </div>
              </div>
            </li>
          );
        }

        return (
          <li key={c.id} className="max-w-3xl px-1 mx-auto w-full flex">
            <div className="flex gap-2 ani-slide-top group">
              <div className="flex gap-1 max-w-[90%] break-all">
                <Avatar className="self-end sticky bottom-2">
                  <AvatarImage
                    src={users[c.userId]?.image ?? undefined}
                    alt={users[c.userId]?.name || "Avatar"}
                  />
                  <AvatarFallback>
                    {users[c.userId]?.name.slice(0, 2) ?? c.userId.slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="bg-secondary px-2 py-1 rounded-md">
                  {formatContent(c.content)}
                </div>
              </div>

              <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity sticky bottom-2">
                {dayjs(c.createdAt).fromNow()}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default ChatList;
