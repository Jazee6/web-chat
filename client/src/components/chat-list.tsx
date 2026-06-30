import { LinkCard } from "@/components/link-card.tsx";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import type { User } from "@/lib/auth-client.ts";
import { cn, formatChatListTime } from "@/lib/utils.ts";
import { CircleAlert, Copy, Reply, TriangleAlert } from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import type { ReplyRef, RoomStats, UIChatMessage } from "web-chat-share";

const ChatImage = ({ src, alt }: { src: string; alt: string }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <Skeleton className="h-36 rounded aspect-square" />}
      <Zoom
        classDialog='[&_[data-rmiz-modal-overlay="visible"]]:bg-background/80!
      [&_[data-rmiz-modal-overlay="visible"]]:backdrop-blur-md
      [&_[data-rmiz-modal-img]]:rounded'
      >
        <img
          src={src}
          alt={alt}
          className={cn(
            "h-36 rounded cursor-zoom-in object-cover hover:brightness-75",
            !loaded && "size-0 absolute",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          loading="lazy"
        />
      </Zoom>
    </>
  );
};

const urlPattern = "https?://[^\\s<>\\[\\]{}|^`]+";
const urlRegex = new RegExp(`(${urlPattern})`, "g");
const pureUrlRegex = new RegExp(`^${urlPattern}$`);

const cleanUrl = (raw: string): string => {
  let url = raw.replace(/[.,;:!?]+$/, "");
  // Strip unmatched trailing close-parens, e.g. "(see https://x.com/foo)".
  let depth = 0;
  for (const ch of url) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  while (depth < 0 && url.endsWith(")")) {
    url = url.slice(0, -1);
    depth++;
  }
  return url;
};

const isPureUrl = (content: string): string | null => {
  const trimmed = content.trim();
  if (!pureUrlRegex.test(trimmed)) return null;
  return cleanUrl(trimmed);
};

const formatContent = (content: string) => {
  return content.split(urlRegex).map((part, i) => {
    if (i % 2 === 1) {
      const href = cleanUrl(part);
      const trailing = part.slice(href.length);
      return (
        <Fragment key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {href}
          </a>
          {trailing}
        </Fragment>
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

const TextMessageContent = ({ content }: { content: string }) => {
  const pureUrl = isPureUrl(content);
  if (pureUrl) return <LinkCard url={pureUrl} />;
  return (
    <div
      className={cn(
        "rounded-md wrap-anywhere whitespace-pre-wrap hover:brightness-75 transition peer select-text",
        isEmojiOnly(content)
          ? "bg-transparent text-5xl"
          : "bg-secondary px-2 py-1",
      )}
    >
      {formatContent(content)}
    </div>
  );
};

const localFileUrlCache = new WeakMap<File, string>();
const getLocalFileUrl = (file: File) => {
  let url = localFileUrlCache.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    localFileUrlCache.set(file, url);
  }
  return url;
};

// Best-effort scroll + flash to a replied-to message. No-ops when the
// antecedent isn't in the loaded DOM (paginated out) — the snapshot Quote
// still renders; only the jump gives up. See ADR 0003.
const flashMessage = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("reply-flash");
  const cleanup = () => {
    el.classList.remove("reply-flash");
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 1600);
  el.addEventListener("animationend", cleanup, { once: true });
};

// Silent copy (Q2: no toast). Text → the user's current selection if it lives
// inside this message, else the whole message text; image → first image's
// bytes via the ClipboardItem API, falling back to the image URL when the
// type isn't accepted (e.g. webp on browsers that only allow png). Image copy
// is gated to fully-sent messages at the call site.
const copyMessage = async (c: UIChatMessage) => {
  try {
    if (c.type === "text") {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = document.getElementById(c.id);
      const selected =
        sel && sel.toString().trim() && el?.contains(node)
          ? sel.toString()
          : c.content;
      await navigator.clipboard.writeText(selected);
      return;
    }
    const ids = JSON.parse(c.content) as string[];
    const first = ids[0];
    if (!first) return;
    const url = `${import.meta.env.VITE_API_URL}/room/images/${first}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const type = blob.type || "image/png";
    if (
      navigator.clipboard &&
      "write" in navigator.clipboard &&
      typeof ClipboardItem !== "undefined"
    ) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
        return;
      } catch {
        // Unsupported image type — fall through to URL copy below.
      }
    }
    await navigator.clipboard.writeText(url);
  } catch {
    // Silent — see Q2.
  }
};

const Quote = ({
  replyTo,
  isMe,
  users,
  onJump,
}: {
  replyTo: ReplyRef;
  isMe: boolean;
  users: Record<string, User>;
  onJump: () => void;
}) => {
  const author = users[replyTo.userId];
  const name = author?.name || replyTo.userId.slice(0, 2);
  return (
    <button
      type="button"
      onClick={onJump}
      className={cn(
        "flex flex-col gap-0.5 max-w-full text-left rounded-md bg-secondary/60 border-l-2 border-primary/60 px-2 py-1 hover:bg-secondary transition-colors ani-slide-top",
        isMe ? "self-end items-end" : "self-start items-start",
      )}
    >
      <span className="text-xs font-medium text-primary line-clamp-1">
        {name}
      </span>
      <span className="text-xs text-muted-foreground line-clamp-1 wrap-anywhere">
        {replyTo.snippet}
      </span>
    </button>
  );
};

const ChatList = memo(
  ({
    chats,
    className,
    userId,
    users,
    roomStats,
    onReply,
  }: {
    chats: UIChatMessage[];
    className?: string;
    userId: string;
    users: Record<string, User>;
    roomStats?: RoomStats;
    onReply?: (message: UIChatMessage) => void;
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

    // Who besides me is typing right now. Never includes the local user — we
    // never render our own typing. Drives the trailing indicator <li>. See
    // ADR 0002: cleared by disconnect, so this is just a read of roomStats.
    const typingUsers = useMemo(
      () =>
        roomStats?.users.filter((u) => u.id !== userId && u.status?.typing) ??
        [],
      [roomStats?.users, userId],
    );

    return (
      <ul className={cn("space-y-2", className)}>
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

                      {roomUser && (
                        <AvatarBadge
                          className={cn(
                            "size-1.5!",
                            roomUser ? "bg-green-500" : "",
                            roomUser?.status?.user === "idle"
                              ? "bg-yellow-500"
                              : "",
                            roomUser?.status?.screen === "locked"
                              ? "bg-neutral-500"
                              : "",
                          )}
                        />
                      )}
                    </Avatar>
                  )}

                  <div className="flex flex-col gap-1">
                    {group.messages.map((c) => {
                      return (
                        <ContextMenu key={c.id}>
                          <ContextMenuTrigger
                            render={
                              <div
                                id={c.id}
                                className="flex flex-col gap-0.5"
                              />
                            }
                          >
                            {c.replyTo && (
                              <Quote
                                replyTo={c.replyTo}
                                isMe={isMe}
                                users={users}
                                onJump={() => flashMessage(c.replyTo!.id)}
                              />
                            )}

                            <div
                              className={cn(
                                "flex gap-1 ani-slide-top",
                                isMe ? "flex-row-reverse" : "",
                              )}
                            >
                              {c.type === "text" && (
                                <TextMessageContent content={c.content} />
                              )}

                              {c.type === "image" && (
                                <div className="flex flex-col gap-1 peer">
                                  <div className="flex overflow-x-auto scrollbar gap-1">
                                    {c.localFiles?.length
                                      ? c.localFiles.map(
                                          (
                                            { file, isUploading, uploadFailed },
                                            index,
                                          ) => (
                                            <div
                                              className="relative shrink-0"
                                              key={`${file.name}_${index}`}
                                            >
                                              <ChatImage
                                                src={getLocalFileUrl(file)}
                                                alt={file.name}
                                              />

                                              {isUploading && (
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                  <Spinner />
                                                </div>
                                              )}

                                              {uploadFailed && (
                                                <div className="absolute inset-0 bg-amber-500/30 flex items-center justify-center">
                                                  <TriangleAlert className="text-amber-500" />
                                                </div>
                                              )}
                                            </div>
                                          ),
                                        )
                                      : (JSON.parse(c.content) as string[]).map(
                                          (i, index) => (
                                            <div className="shrink-0" key={i}>
                                              <ChatImage
                                                src={`${import.meta.env.VITE_API_URL}/room/images/${i}`}
                                                alt={`image_${index}`}
                                              />
                                            </div>
                                          ),
                                        )}
                                  </div>

                                  {c.sendFailed && (
                                    <div className="flex items-center gap-1 self-end text-xs text-destructive">
                                      <CircleAlert className="size-3.5 shrink-0" />
                                      <span>未送达</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="text-muted-foreground brightness-75 text-xs self-end opacity-0 peer-hover:opacity-100 transition-opacity">
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
                          </ContextMenuTrigger>

                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => onReply?.(c)}>
                              <Reply />
                              <span>回复</span>
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => void copyMessage(c)}
                              disabled={
                                c.type === "image" &&
                                (!!c.localFiles?.length || !!c.sendFailed)
                              }
                            >
                              <Copy />
                              <span>复制</span>
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                  </div>
                </div>
              </li>
            </Fragment>
          );
        })}

        {/* Always mounted at a fixed height so a typist appearing/disappearing
            never changes content height — which would otherwise shift the
            message list (a smooth-glide on appear via the stick-to-bottom
            ResizeObserver, and a browser scrollTop-clamp jump on disappear).
            Only the inner content toggles, so ani-slide-top still plays on
            entry. The <ul>'s bottom padding is reduced (pb-24 in room.tsx) to
            keep total bottom clearance unchanged. */}
        <li
          key="typing"
          className="max-w-3xl mx-auto w-full flex -mt-1 h-8 items-end"
          aria-hidden={typingUsers.length === 0}
        >
          {typingUsers.length > 0 && (
            <div className="flex gap-1 max-w-[90%] ani-slide-top">
              <AvatarGroup className="self-end shrink-0">
                {typingUsers.slice(0, 5).map((u) => {
                  const user = users[u.id];
                  return (
                    <Avatar key={u.id}>
                      <AvatarImage
                        src={user?.image ?? ""}
                        alt={user?.name || "Avatar"}
                      />
                      <AvatarFallback>{user?.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                  );
                })}
                {typingUsers.length > 5 && (
                  <AvatarGroupCount>+{typingUsers.length - 5}</AvatarGroupCount>
                )}
              </AvatarGroup>

              <div className="h-8 bg-secondary px-2 py-1.5 rounded-md flex items-center gap-1 self-end">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot size-1.5 rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </li>
      </ul>
    );
  },
);

export default ChatList;
