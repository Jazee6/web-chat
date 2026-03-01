import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import type { User } from "@/lib/auth-client.ts";
import { cn, formatChatListTime } from "@/lib/utils.ts";
import { Fragment, memo, useMemo, useState } from "react";
import type { RoomStats, UIChatMessage } from "web-chat-share";

const ChatImage = ({ src, alt }: { src: string; alt: string }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <Skeleton className="h-36 rounded aspect-video" />}
      <img
        src={src}
        alt={alt}
        className={cn(
          "h-36 rounded cursor-zoom-in object-cover",
          !loaded && "size-0",
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        loading="lazy"
      />
    </>
  );
};

const urlRegex = /(https?:\/\/\S+)/g;

const formatContent = (content: string) => {
  return content.split(urlRegex).map((part, i) => {
    if (i % 2 === 1) {
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

let isEmojiRegex: RegExp | null = null;
try {
  isEmojiRegex = new RegExp("^\\p{RGI_Emoji}{1,3}$", "v");
} catch {
  // ignore
}

const isEmojiOnly = (content: string) => {
  if (!isEmojiRegex) return false;
  return isEmojiRegex.test(content);
};

const ChatList = memo(
  ({
    chats,
    className,
    userId,
    users,
    roomStats,
  }: {
    chats: UIChatMessage[];
    className?: string;
    userId: string;
    users: Record<string, User>;
    roomStats?: RoomStats;
  }) => {
    const groups = useMemo(() => {
      const res: {
        id: string;
        userId: string;
        messages: UIChatMessage[];
        showTime: boolean;
        time: string;
      }[] = [];
      let currentGroup: (typeof res)[0] | null = null;

      chats.forEach((c, i) => {
        const prevMessage = chats[i - 1];
        const showTime =
          !prevMessage ||
          new Date(c.createdAt).getTime() -
            new Date(prevMessage.createdAt).getTime() >
            5 * 60 * 1000;

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

    const roomUserMap = useMemo(() => {
      const map: { [userId: string]: RoomStats["users"][0] } = {};
      roomStats?.users.forEach((u) => {
        map[u.id] = u;
      });
      return map;
    }, [roomStats?.users]);

    return (
      <ul className={cn("space-y-4 pb-4", className)}>
        {groups.map((group) => {
          const isMe = group.userId === userId;
          const user = users[group.userId];
          const roomUser = roomUserMap[group.userId];

          return (
            <Fragment key={group.id}>
              {group.showTime && (
                <li className="flex justify-center py-4 text-xs text-muted-foreground brightness-75 ani-slide-top">
                  {formatChatListTime(group.time)}
                </li>
              )}

              <li
                className={cn(
                  "max-w-3xl mx-auto w-full flex",
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

                      <div
                        className={cn(
                          "absolute bottom-0 right-0 size-2 rounded-full",
                          roomUser ? "bg-green-500" : "",
                          roomUser?.status?.user === "idle"
                            ? "bg-yellow-500"
                            : "",
                          roomUser?.status?.screen === "locked"
                            ? "bg-neutral-500"
                            : "",
                        )}
                      />
                    </Avatar>
                  )}

                  <div className="flex flex-col gap-1">
                    {group.messages.map((c) => {
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            "flex gap-1 ani-slide-top",
                            isMe ? "flex-row-reverse" : "",
                          )}
                        >
                          {c.type === "text" && (
                            <div
                              className={cn(
                                "rounded-md wrap-anywhere whitespace-pre-wrap hover:brightness-75 transition peer",
                                isEmojiOnly(c.content)
                                  ? "bg-transparent text-5xl"
                                  : "bg-secondary px-2 py-1",
                              )}
                            >
                              {formatContent(c.content)}
                            </div>
                          )}

                          {c.type === "image" && (
                            <div className="flex overflow-x-auto scrollbar gap-1">
                              {c.localFiles?.length
                                ? c.localFiles.map(
                                    ({ file, isUploading }, index) => (
                                      <div className="relative">
                                        <ChatImage
                                          key={`${file.name}_${index}`}
                                          src={URL.createObjectURL(file)}
                                          alt={file.name}
                                        />

                                        {isUploading && (
                                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <Spinner />
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )
                                : (JSON.parse(c.content) as string[]).map(
                                    (i, index) => (
                                      <ChatImage
                                        key={i}
                                        src={`${import.meta.env.VITE_FILE_URL}/images/${i}`}
                                        alt={`image_${index}`}
                                      />
                                    ),
                                  )}
                            </div>
                          )}

                          <div className="text-muted text-xs self-end opacity-0 peer-hover:opacity-100 transition-opacity">
                            {new Date(c.createdAt)
                              .getHours()
                              .toString()
                              .padStart(2, "0")}
                            :
                            {new Date(c.createdAt)
                              .getMinutes()
                              .toString()
                              .padStart(2, "0")}
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
  },
);

export default ChatList;
