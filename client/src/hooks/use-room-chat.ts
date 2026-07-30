import { decideScrollAction } from "@/lib/decide-scroll-action.ts";
import {
  mergeInitialHistory,
  reconcileMessageAcceptance,
} from "@/lib/message-submissions.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ChatMessage,
  gm,
  type MessageAcceptance,
  type MessageSubmission,
  type ReplyRef,
  type RoomStats,
  type UIChatMessage,
} from "web-chat-share";

const STICK_THRESHOLD_PX = 256;
const ACCEPTANCE_TIMEOUT_MS = 10_000;

type UseRoomChatParams = {
  chatListRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  loaderRef: RefObject<HTMLDivElement | null>;
  userId: string;
  sendMessage: (msg: string) => void;
  readyState: number;
  fetchMissingUsers: (ids: string[]) => void;
};

type UseRoomChatReturn = {
  chats: UIChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  roomStats: RoomStats | undefined;
  setChats: Dispatch<SetStateAction<UIChatMessage[]>>;
  sendText: (content: string, replyTo?: ReplyRef) => void;
  sendSubmission: (submission: MessageSubmission) => void;
  retrySubmission: (submissionId: string) => void;
  handleMessageAcceptance: (data: MessageAcceptance) => void;
  handleDisconnect: () => void;
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
  readyState,
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
  const readyStateRef = useRef(readyState);
  const pendingSubmissionsRef = useRef(
    new Map<
      string,
      {
        submission: MessageSubmission;
        timeoutId: ReturnType<typeof setTimeout> | null;
      }
    >(),
  );

  useLayoutEffect(() => {
    readyStateRef.current = readyState;
  }, [readyState]);

  const setStick = useCallback((next: boolean) => {
    if (stickToBottomRef.current === next) return;
    stickToBottomRef.current = next;
    setStickToBottom(next);
    if (next && unreadCountRef.current !== 0) {
      unreadCountRef.current = 0;
      setUnreadCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = chatListRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setStick(true);
    },
    [chatListRef, setStick],
  );

  const requestStickToBottom = useCallback(() => {
    setStick(true);
  }, [setStick]);

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

  // Pending submissions are intentionally page-local. Clear their timers when
  // this room unmounts rather than carrying them across a refresh. See ADR 0009.
  useEffect(() => {
    const pendingSubmissions = pendingSubmissionsRef.current;
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      pendingSubmissions.forEach(({ timeoutId }) => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      pendingSubmissions.clear();
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
      setChats((chats) => mergeInitialHistory(chats, data));
      oldestChatTimeRef.current = data[0].createdAt;
      fetchMissingUsers(
        data.flatMap((c) =>
          c.authorType === "user" && c.userId ? [c.userId] : [],
        ),
      );
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
      setChats((chats) => {
        const existingIds = new Set(chats.map((chat) => chat.id));
        return [...data.filter((chat) => !existingIds.has(chat.id)), ...chats];
      });
      oldestChatTimeRef.current = data[0].createdAt;
      debouncedFetchMissingUsers(
        data.flatMap((c) =>
          c.authorType === "user" && c.userId ? [c.userId] : [],
        ),
      );
    },
    [chatListRef, debouncedFetchMissingUsers],
  );

  const handleMessage = useCallback(
    (data: ChatMessage) => {
      setChats((chats) =>
        chats.some((chat) => chat.id === data.id) ? chats : [...chats, data],
      );
      if (data.authorType === "user" && data.userId) {
        debouncedFetchMissingUsers([data.userId]);
      }
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
  }, [chatListRef, isLoading, setStick]);

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

  const markSubmissionFailed = useCallback((submissionId: string) => {
    const pending = pendingSubmissionsRef.current.get(submissionId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    if (pending) pending.timeoutId = null;
    setChats((chats) =>
      chats.map((chat) =>
        chat.submissionId === submissionId
          ? { ...chat, sendState: "failed" }
          : chat,
      ),
    );
  }, []);

  const sendSubmission = useCallback(
    (submission: MessageSubmission) => {
      const previous = pendingSubmissionsRef.current.get(
        submission.submissionId,
      );
      if (previous?.timeoutId) clearTimeout(previous.timeoutId);
      pendingSubmissionsRef.current.set(submission.submissionId, {
        submission,
        timeoutId: null,
      });

      setChats((chats) =>
        chats.map((chat) =>
          chat.submissionId === submission.submissionId
            ? { ...chat, sendState: "sending" }
            : chat,
        ),
      );

      if (readyStateRef.current !== WebSocket.OPEN) {
        markSubmissionFailed(submission.submissionId);
        return;
      }

      try {
        sendMessage(gm({ type: "send", data: submission }));
      } catch {
        markSubmissionFailed(submission.submissionId);
        return;
      }

      const pending = pendingSubmissionsRef.current.get(
        submission.submissionId,
      );
      if (!pending) return;
      pending.timeoutId = setTimeout(
        () => markSubmissionFailed(submission.submissionId),
        ACCEPTANCE_TIMEOUT_MS,
      );
    },
    [markSubmissionFailed, sendMessage],
  );

  const retrySubmission = useCallback(
    (submissionId: string) => {
      const pending = pendingSubmissionsRef.current.get(submissionId);
      if (pending) sendSubmission(pending.submission);
    },
    [sendSubmission],
  );

  const handleMessageAcceptance = useCallback((data: MessageAcceptance) => {
    const pending = pendingSubmissionsRef.current.get(data.submissionId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    pendingSubmissionsRef.current.delete(data.submissionId);
    setChats((chats) => reconcileMessageAcceptance(chats, data));
  }, []);

  const handleDisconnect = useCallback(() => {
    pendingSubmissionsRef.current.forEach((pending, submissionId) => {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
      markSubmissionFailed(submissionId);
    });
  }, [markSubmissionFailed]);

  const sendText = useCallback(
    (content: string, replyTo?: ReplyRef) => {
      const submissionId = crypto.randomUUID();
      setStick(true);
      setChats((chats) => [
        ...chats,
        {
          id: submissionId,
          submissionId,
          sendState: "sending",
          authorType: "user",
          userId,
          type: "text",
          content,
          replyTo,
          createdAt: new Date().toISOString(),
        },
      ]);
      sendSubmission({ submissionId, type: "text", content, replyTo });
    },
    [sendSubmission, setStick, userId],
  );

  const scrollToBottomSmooth = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return {
    chats,
    isLoading,
    hasMore,
    roomStats,
    setChats,
    sendText,
    sendSubmission,
    retrySubmission,
    handleMessageAcceptance,
    handleDisconnect,
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
