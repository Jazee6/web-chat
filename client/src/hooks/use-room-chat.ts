import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type ChatMessage,
  gm,
  type RoomStats,
  type UIChatMessage,
} from "web-chat-share";
import { decideScrollAction } from "@/lib/decide-scroll-action.ts";

const STICK_THRESHOLD_PX = 64;

type UseRoomChatParams = {
  chatListRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  loaderRef: RefObject<HTMLDivElement | null>;
  userId: string;
  sendMessage: (msg: string) => void;
  fetchMissingUsers: (ids: string[]) => void;
};

type UseRoomChatReturn = {
  chats: UIChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  roomStats: RoomStats | undefined;
  setChats: Dispatch<SetStateAction<UIChatMessage[]>>;
  addChatMessage: (
    msg: Omit<UIChatMessage, "id" | "userId" | "createdAt">,
  ) => void;
  sendText: (content: string) => void;
  handleInitHistory: (data: ChatMessage[]) => void;
  handleHistory: (data: ChatMessage[]) => void;
  handleMessage: (data: ChatMessage) => void;
  handleRoomStats: (data: RoomStats) => void;
  stickToBottom: boolean;
  unreadCount: number;
  scrollToBottom: () => void;
  requestStickToBottom: () => void;
};

export function useRoomChat({
  chatListRef,
  contentRef,
  loaderRef,
  userId,
  sendMessage,
  fetchMissingUsers,
}: UseRoomChatParams): UseRoomChatReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<UIChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const oldestChatTimeRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const unreadCountRef = useRef(0);
  const pendingUserIdsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStick = useEffectEvent((next: boolean) => {
    if (stickToBottomRef.current === next) return;
    stickToBottomRef.current = next;
    setStickToBottom(next);
    if (next && unreadCountRef.current !== 0) {
      unreadCountRef.current = 0;
      setUnreadCount(0);
    }
  });

  const scrollToBottom = useEffectEvent(
    (behavior: ScrollBehavior = "smooth") => {
      const el = chatListRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setStick(true);
    },
  );

  const requestStickToBottom = useCallback(() => {
    setStick(true);
  }, []);

  // Debounced fetchMissingUsers
  const debouncedFetchMissingUsers = useCallback(
    (newIds: string[]) => {
      newIds.forEach((id) => pendingUserIdsRef.current.add(id));

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        const ids = [...pendingUserIdsRef.current];
        pendingUserIdsRef.current.clear();
        fetchMissingUsers(ids);
        debounceTimerRef.current = null;
      }, 100);
    },
    [fetchMissingUsers],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleRoomStats = useCallback((data: RoomStats) => {
    setRoomStats({
      ...data,
      users: [...new Map(data.users.map((u) => [u.id, u])).values()],
    });
  }, []);

  const handleInitHistory = useCallback(
    (data: ChatMessage[]) => {
      setIsLoading(false);
      if (data.length < 25) {
        setHasMore(false);
      }
      if (data.length === 0) {
        return;
      }
      setChats(data);
      oldestChatTimeRef.current = data[0].createdAt;
      fetchMissingUsers(data.map((c) => c.userId));
    },
    [fetchMissingUsers],
  );

  const handleHistory = useCallback(
    (data: ChatMessage[]) => {
      if (data.length < 25) {
        setHasMore(false);
      }
      if (data.length === 0) {
        return;
      }
      if (chatListRef.current) {
        previousScrollHeightRef.current = chatListRef.current.scrollHeight;
        isLoadingHistoryRef.current = true;
      }
      setChats((chats) => [...data, ...chats]);
      oldestChatTimeRef.current = data[0].createdAt;
      debouncedFetchMissingUsers(data.map((c) => c.userId));
    },
    [chatListRef, debouncedFetchMissingUsers],
  );

  const handleMessage = useCallback(
    (data: ChatMessage) => {
      setChats((chats) => [...chats, data]);
      debouncedFetchMissingUsers([data.userId]);
      if (!stickToBottomRef.current) {
        unreadCountRef.current += 1;
        setUnreadCount(unreadCountRef.current);
      }
    },
    [debouncedFetchMissingUsers],
  );

  // Initial scroll to bottom once history loaded
  useEffect(() => {
    if (isLoading) return;
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [isLoading, chatListRef]);

  // Scroll listener: track user intent (stick vs free)
  useEffect(() => {
    const el = chatListRef.current;
    if (!el || isLoading) return;

    const onScroll = () => {
      const stick =
        el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD_PX;
      setStick(stick);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatListRef, isLoading]);

  // ResizeObserver on the inner content (its height tracks content growth;
  // the scroll container's box stays the same size).
  useEffect(() => {
    const el = chatListRef.current;
    const content = contentRef.current;
    if (!el || !content || isLoading) return;

    const observer = new ResizeObserver(() => {
      const action = decideScrollAction({
        scrollHeight: el.scrollHeight,
        prevScrollHeight: previousScrollHeightRef.current,
        isLoadingHistory: isLoadingHistoryRef.current,
        isStick: stickToBottomRef.current,
      });

      if (action.kind === "history-compensate") {
        el.scrollTop += action.diff;
        isLoadingHistoryRef.current = false;
      } else if (action.kind === "stick-to-bottom") {
        // New message arrived while pinned to the bottom — glide down to keep
        // the latest in view. History pagination (above) and the initial load
        // scroll jump instantly. The typing indicator no longer reaches here:
        // it's a fixed-height always-present slot in ChatList, so a typist
        // appearing/disappearing doesn't change content height and never fires
        // this observer.
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [chatListRef, contentRef, isLoading]);

  // Infinite scroll: load history when loader is visible
  useEffect(() => {
    if (!loaderRef.current || isLoading) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (
          entry.isIntersecting &&
          oldestChatTimeRef.current &&
          !isLoadingHistoryRef.current &&
          hasMore
        ) {
          sendMessage(
            gm({
              type: "loadHistory",
              data: {
                before: oldestChatTimeRef.current,
              },
            }),
          );
        }
      });
    });

    observer.observe(loaderRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isLoading, loaderRef, sendMessage, hasMore]);

  const addChatMessage = useCallback(
    (msg: Omit<UIChatMessage, "id" | "userId" | "createdAt">) => {
      setStick(true);
      setChats((prev) => [
        ...prev,
        {
          ...msg,
          id: crypto.randomUUID(),
          userId,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    [userId],
  );

  const sendText = useCallback(
    (content: string) => {
      addChatMessage({ type: "text", content });
      sendMessage(
        gm({
          type: "send",
          data: { type: "text", content },
        }),
      );
    },
    [addChatMessage, sendMessage],
  );

  const scrollToBottomSmooth = useCallback(() => {
    scrollToBottom("smooth");
  }, []);

  return {
    chats,
    isLoading,
    hasMore,
    roomStats,
    setChats,
    addChatMessage,
    sendText,
    handleInitHistory,
    handleHistory,
    handleMessage,
    handleRoomStats,
    stickToBottom,
    unreadCount,
    scrollToBottom: scrollToBottomSmooth,
    requestStickToBottom,
  };
}
