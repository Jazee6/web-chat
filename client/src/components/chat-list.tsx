import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import type { User } from "@/lib/auth-client.ts";
import { api, cn } from "@/lib/utils.ts";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import type { ChatMessage } from "web-chat-share";

const ChatList = ({
  chats,
  className,
  userId,
  userIds,
}: {
  chats: ChatMessage[];
  className?: string;
  userId: string;
  userIds: string[];
}) => {
  const [users, setUsers] = useState<{
    [userId: string]: User;
  }>({});

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
                  <AvatarImage
                    src={users[c.userId]?.image ?? undefined}
                    alt={users[c.userId]?.name || "Avatar"}
                  />
                  <AvatarFallback>
                    {users[c.userId]?.name.slice(0, 2) ?? c.userId.slice(0, 2)}
                  </AvatarFallback>
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
