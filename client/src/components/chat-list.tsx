import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";
import { cn } from "@/lib/utils.ts";
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
              className="max-w-3xl max-md:px-2 mx-auto w-full flex"
            >
              <div className="bg-secondary px-2 py-1 rounded-md ani-slide-top ml-auto max-w-[90%]">
                {c.content}
              </div>
            </li>
          );
        }

        return (
          <li key={c.id} className="max-w-3xl max-md:px-2 mx-auto w-full flex">
            <div className="flex space-x-1 max-w-[90%] ani-slide-top">
              <Avatar>
                <AvatarFallback>{c.userId.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="bg-secondary px-2 py-1 rounded-md">
                {c.content}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default ChatList;
