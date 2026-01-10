import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";
import { cn } from "@/lib/utils.ts";
import dayjs from "dayjs";
import type { ChatMessage } from "web-chat-share";

const ChatList = ({
  chats,
  className,
  userId,
}: {
  chats: ChatMessage[];
  className?: string;
  userId: string;
}) => {
  return (
    <ul className={cn("space-y-1", className)}>
      {chats.map((c) => {
        if (c.userId === userId) {
          return (
            <li
              key={c.id}
              className="max-w-3xl max-md:px-2 mx-auto w-full flex justify-end"
            >
              <div className="ani-slide-top max-w-[90%] flex gap-2 group">
                <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity">
                  {dayjs(c.createdAt).fromNow()}
                </div>

                <div className="bg-secondary px-2 py-1 rounded-md break-all">
                  {c.content}
                </div>
              </div>
            </li>
          );
        }

        return (
          <li key={c.id} className="max-w-3xl max-md:px-2 mx-auto w-full flex">
            <div className="flex gap-2 ani-slide-top group">
              <div className="flex gap-1 max-w-[90%] break-all">
                <Avatar>
                  <AvatarFallback>{c.userId.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="bg-secondary px-2 py-1 rounded-md">
                  {c.content}
                </div>
              </div>

              <div className="text-muted text-xs self-end opacity-0 group-hover:opacity-100 transition-opacity">
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
