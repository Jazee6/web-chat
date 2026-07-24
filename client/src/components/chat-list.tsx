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
import { useFavoriteSticker } from "@/hooks/use-stickers.ts";
import type { User } from "@/lib/auth-client.ts";
import { findMentionRanges } from "@/lib/mentions.ts";
import { api, cn, formatChatListTime } from "@/lib/utils.ts";
import {
  Bot,
  CircleAlert,
  Copy,
  HeartPlus,
  Reply,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, Fragment, memo, useMemo, useState } from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { toast } from "sonner";
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

// Wraps an image in a per-image context menu: Reply (the whole message, not
// this single file), Copy (this image's bytes to the system clipboard), and
// Save to stickers (in-app reuse). Used both for sent images (keyed by their
// storage key) and for the sender's just-uploaded local files (keyed once the
// PUT lands - see ADR 0004). Local/uploading/failed files have no key and
// aren't wrapped. See CONTEXT.md "Stickers" and ADR 0005.
const ImageWithFavorite = ({
  storageKey,
  message,
  onFavorite,
  onReply,
  children,
}: {
  storageKey: string;
  message: UIChatMessage;
  onFavorite: (key: string) => void;
  onReply?: (message: UIChatMessage) => void;
  children: ReactNode;
}) => (
  <ContextMenu>
    <ContextMenuTrigger render={<div className="shrink-0" />}>
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => onReply?.(message)}>
        <Reply />
        <span>Reply</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void copyImage(storageKey)}>
        <Copy />
        <span>Copy</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onFavorite(storageKey)}>
        <HeartPlus />
        <span>Save to stickers</span>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

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

const formatMentions = (content: string, userNames: string[]) => {
  const mentions = findMentionRanges(content, userNames);
  if (mentions.length === 0) return content;

  const result: ReactNode[] = [];
  let offset = 0;
  mentions.forEach(({ start, end }) => {
    if (start > offset) result.push(content.slice(offset, start));
    result.push(
      <span
        key={`${start}-${end}`}
        className="rounded-sm bg-primary/15 px-0.5 font-medium text-primary"
      >
        {content.slice(start, end)}
      </span>,
    );
    offset = end;
  });
  if (offset < content.length) result.push(content.slice(offset));
  return result;
};

const formatContent = (content: string, userNames: string[]) => {
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
    return <Fragment key={i}>{formatMentions(part, userNames)}</Fragment>;
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

const TextMessageContent = ({
  content,
  userNames,
}: {
  content: string;
  userNames: string[];
}) => {
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
      {formatContent(content, userNames)}
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
// inside this message, else the whole message text.
const copyMessage = async (c: UIChatMessage) => {
  try {
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const el = document.getElementById(c.id);
    const selected =
      sel && sel.toString().trim() && el?.contains(node)
        ? sel.toString()
        : c.content;
    await navigator.clipboard.writeText(selected);
  } catch {
    // Silent - see Q2.
  }
};

// Copies image bytes (WebP) to the system clipboard for pasting into other
// apps. Distinct from favoriting as a Sticker (in-app reuse) - see CONTEXT.md
// "Stickers" and ADR 0005. Silent on failure, matching copyMessage.
const copyImage = async (storageKey: string) => {
  try {
    const blob = await api(`room/images/${storageKey}`).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch {
    // Silent - see Q2.
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
  const author = replyTo.userId ? users[replyTo.userId] : undefined;
  const name =
    replyTo.authorType === "ai"
      ? "AI"
      : author?.name || replyTo.userId?.slice(0, 2) || "Unknown user";
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

const MessageAvatar = ({
  authorType,
  user,
  userId,
  roomUser,
}: {
  authorType: UIChatMessage["authorType"];
  user?: User;
  userId?: string;
  roomUser?: RoomStats["users"][0];
}) => (
  <Avatar className="hover:brightness-75 transition shrink-0 ani-slide-top">
    <AvatarImage
      src={user?.image ?? undefined}
      alt={authorType === "ai" ? "AI" : user?.name || "Avatar"}
    />
    <AvatarFallback>
      {authorType === "ai" ? (
        <Bot className="size-4" />
      ) : (
        (user?.name.slice(0, 2) ?? userId?.slice(0, 2) ?? "?")
      )}
    </AvatarFallback>

    {roomUser && (
      <AvatarBadge
        className={cn(
          "size-1.5! bg-green-500",
          roomUser.status?.user === "idle" && "bg-yellow-500",
          roomUser.status?.screen === "locked" && "bg-neutral-500",
        )}
      />
    )}
  </Avatar>
);

const ChatList = memo(
  ({
    chats,
    className,
    userId,
    users,
    roomStats,
    aiTyping,
    onReply,
    onMention,
  }: {
    chats: UIChatMessage[];
    className?: string;
    userId: string;
    users: Record<string, User>;
    roomStats?: RoomStats;
    aiTyping?: boolean;
    onReply?: (message: UIChatMessage) => void;
    onMention?: (name: string) => void;
  }) => {
    const favoriteSticker = useFavoriteSticker();
    const onFavoriteSticker = (key: string) => {
      favoriteSticker.mutate(key);
      toast.success("Saved to stickers");
    };
    const groups = useMemo(() => {
      const res: {
        id: string;
        authorType: UIChatMessage["authorType"];
        userId?: string;
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

        if (
          c.authorType === "system" ||
          showTime ||
          !currentGroup ||
          currentGroup.authorType !== c.authorType ||
          currentGroup.userId !== c.userId
        ) {
          currentGroup = {
            id: c.id,
            authorType: c.authorType,
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

    const mentionUserNames = useMemo(
      () => Object.values(users).map((user) => user.name),
      [users],
    );

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
          const isMe = group.authorType === "user" && group.userId === userId;
          const user = group.userId ? users[group.userId] : undefined;
          const roomUser = group.userId ? roomUserMap[group.userId] : undefined;
          const mentionName =
            group.authorType === "ai"
              ? "AI"
              : user?.name.toLocaleLowerCase() === "ai"
                ? undefined
                : user?.name;
          const canMention = !!mentionName && !!onMention;

          return (
            <Fragment key={group.id}>
              {group.showTime && (
                <li className="flex justify-center py-4 text-xs text-muted-foreground brightness-75 ani-slide-top">
                  {formatChatListTime(group.time)}
                </li>
              )}

              {group.authorType === "system" ? (
                <li className="max-w-3xl mx-auto w-full flex justify-center px-4 py-1">
                  <div className="max-w-xl rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground ani-slide-top">
                    {group.messages[0].content}
                  </div>
                </li>
              ) : (
                <li
                  className={cn(
                    "max-w-3xl mx-auto w-full flex",
                    isMe ? "justify-end" : "",
                  )}
                >
                  <div className="flex gap-1 max-w-[90%] min-w-0">
                    {!isMe && (
                      <div className="self-end sticky bottom-1 shrink-0">
                        {canMention ? (
                          <button
                            type="button"
                            aria-label={`Mention ${mentionName}`}
                            className="rounded-full cursor-pointer"
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => onMention?.(mentionName)}
                          >
                            <MessageAvatar
                              authorType={group.authorType}
                              user={user}
                              userId={group.userId}
                              roomUser={roomUser}
                            />
                          </button>
                        ) : (
                          <MessageAvatar
                            authorType={group.authorType}
                            user={user}
                            userId={group.userId}
                            roomUser={roomUser}
                          />
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-1 min-w-0">
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
                                  "flex gap-1 ani-slide-top min-w-0",
                                  isMe ? "flex-row-reverse" : "",
                                )}
                              >
                                {c.type === "text" && (
                                  <TextMessageContent
                                    content={c.content}
                                    userNames={mentionUserNames}
                                  />
                                )}

                                {c.type === "image" && (
                                  <div className="flex flex-col gap-1 peer max-w-full">
                                    <div className="flex overflow-x-auto scrollbar gap-1 max-w-full">
                                      {c.localFiles?.length
                                        ? c.localFiles.map(
                                            (
                                              {
                                                file,
                                                isUploading,
                                                uploadFailed,
                                                key,
                                              },
                                              index,
                                            ) =>
                                              // Uploaded successfully → has a key →
                                              // favorite/copy like a sent image. Still
                                              // uploading or failed → no key, render
                                              // with the status overlay and no menu.
                                              key ? (
                                                <ImageWithFavorite
                                                  key={`${file.name}_${index}`}
                                                  storageKey={key}
                                                  message={c}
                                                  onFavorite={onFavoriteSticker}
                                                  onReply={onReply}
                                                >
                                                  <ChatImage
                                                    src={getLocalFileUrl(file)}
                                                    alt={file.name}
                                                  />
                                                </ImageWithFavorite>
                                              ) : (
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
                                        : (
                                            JSON.parse(c.content) as string[]
                                          ).map((i, index) => (
                                            <ImageWithFavorite
                                              key={i}
                                              storageKey={i}
                                              message={c}
                                              onFavorite={onFavoriteSticker}
                                              onReply={onReply}
                                            >
                                              <ChatImage
                                                src={`${import.meta.env.VITE_API_URL}/room/images/${i}`}
                                                alt={`image_${index}`}
                                              />
                                            </ImageWithFavorite>
                                          ))}
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
                                <span>Reply</span>
                              </ContextMenuItem>
                              {c.type === "text" && (
                                <ContextMenuItem
                                  onClick={() => void copyMessage(c)}
                                >
                                  <Copy />
                                  <span>Copy</span>
                                </ContextMenuItem>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  </div>
                </li>
              )}
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
          aria-hidden={typingUsers.length === 0 && !aiTyping}
        >
          {(typingUsers.length > 0 || aiTyping) && (
            <div className="flex gap-1 max-w-[90%] ani-slide-top">
              <AvatarGroup className="self-end shrink-0">
                {aiTyping && (
                  <Avatar title="AI">
                    <AvatarFallback>
                      <Bot className="size-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
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
