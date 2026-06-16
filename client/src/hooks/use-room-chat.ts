import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ChatMessage,
  gm,
  type RoomStats,
  type UIChatMessage,
} from "web-chat-share";

type UseRoomChatParams = {
  chatListRef: RefObject<HTMLDivElement | null>;
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
  forceScrollRef: RefObject<boolean>;
};

export function useRoomChat({
  chatListRef,
  loaderRef,
  userId,
  sendMessage,
  fetchMissingUsers,
}: UseRoomChatParams): UseRoomChatReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<UIChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const oldestChatTimeRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const forceScrollRef = useRef(false);
  const pendingUserIdsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useEffectEvent(
    (behavior: ScrollBehavior = "smooth") => {
      if (chatListRef.current) {
        chatListRef.current.scrollTo({
          top: chatListRef.current.scrollHeight,
          behavior,
        });
      }
    },
  );

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
    },
    [debouncedFetchMissingUsers],
  );

  // Scroll to bottom on initial load
  useEffect(() => {
    if (isLoading) {
      return;
    }

    scrollToBottom("instant");
  }, [isLoading]);

  // Scroll logic: post-render scroll decision
  useLayoutEffect(() => {
    if (!chatListRef.current) return;

    if (isLoadingHistoryRef.current) {
      const newScrollHeight = chatListRef.current.scrollHeight;
      const diff = newScrollHeight - previousScrollHeightRef.current;
      chatListRef.current.scrollTop += diff;
      isLoadingHistoryRef.current = false;
    } else if (forceScrollRef.current) {
      scrollToBottom();
      forceScrollRef.current = false;
    } else {
      const { scrollTop, scrollHeight, clientHeight } = chatListRef.current;
      if (scrollTop + clientHeight >= scrollHeight - 100) {
        scrollToBottom();
      }
    }
  }, [chats, chatListRef]);

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
      forceScrollRef.current = true;
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
    forceScrollRef,
  };
}
