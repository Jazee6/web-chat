import { decideScrollAction } from "@/lib/decide-scroll-action.ts";
import {
  mergeInitialHistory,
  reconcileMessageAcceptance,
} from "@/lib/message-submissions.ts";
import { getHistoryCursor, type HistoryCursor } from "@/lib/room-history.ts";
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
  type HistoryChatMessage,
  type MessageAcceptance,
  type MessageRejection,
  type MessageSubmission,
  type ReplyRef,
  type RoomStats,
  type RoomUser,
  type UIChatMessage,
  type UserStatus,
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
  isHistoricalView: boolean;
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
  cancelSubmission: (submissionId: string) => void;
  removeSubmission: (submissionId: string) => void;
  handleMessageAcceptance: (data: MessageAcceptance) => void;
  handleMessageRejection: (data: MessageRejection) => void;
  handleDisconnect: () => void;
  handleInitHistory: (data: HistoryChatMessage[]) => void;
  handleHistory: (data: HistoryChatMessage[]) => void;
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
  isHistoricalView,
}: UseRoomChatParams): UseRoomChatReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [roomStats, setRoomStats] = useState<RoomStats>();
  const [chats, setChats] = useState<UIChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const oldestChatCursorRef = useRef<HistoryCursor | null>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isLoadingHistoryRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const unreadCountRef = useRef(0);
  const pendingUserIdsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyStateRef = useRef(readyState);
  const isHistoricalViewRef = useRef(isHistoricalView);
  const pendingSubmissionsRef = useRef(
    new Map<
      string,
      {
        submission: MessageSubmission;
        timeoutId: ReturnType<typeof setTimeout> | null;
        state: "waiting" | "sending" | "failed";
        attempted: boolean;
      }
    >(),
  );
  const resumePendingSubmissionsRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    readyStateRef.current = readyState;
  }, [readyState]);

  useLayoutEffect(() => {
    isHistoricalViewRef.current = isHistoricalView;
  }, [isHistoricalView]);

  const setStick = useCallback((next: boolean) => {
    if (stickToBottomRef.current === next) {
      if (next && unreadCountRef.current !== 0) {
        unreadCountRef.current = 0;
        setUnreadCount(0);
      }
      return;
    }
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
    // A member can hold multiple WebSocket sessions (e.g. the room open in two
    // tabs → two entries with the same id). Merge per ADR 0012: any-visible wins
    // for `tab`, any-true wins for `typing`; `user`/`screen` come from the same
    // physical device across tabs so take the first defined. The prior whole-
    // object last-wins could let a hidden tab's status overwrite a visible one.
    const groups = new Map<string, RoomUser[]>();
    for (const u of data.users) {
      const arr = groups.get(u.id);
      if (arr) arr.push(u);
      else groups.set(u.id, [u]);
    }
    const users: RoomUser[] = [];
    for (const [id, group] of groups) {
      if (group.length === 1) {
        users.push(group[0]);
        continue;
      }
      let anyVisible = false;
      let anyHidden = false;
      let anyTyping = false;
      let user: UserStatus["user"];
      let screen: UserStatus["screen"];
      let hasStatus = false;
      for (const u of group) {
        const s = u.status;
        if (!s) continue;
        hasStatus = true;
        if (s.tab === "visible") anyVisible = true;
        else if (s.tab === "hidden") anyHidden = true;
        if (s.typing) anyTyping = true;
        if (s.user && !user) user = s.user;
        if (s.screen && !screen) screen = s.screen;
      }
      if (!hasStatus) {
        users.push({ id });
        continue;
      }
      const status: UserStatus = {};
      if (anyVisible) status.tab = "visible";
      else if (anyHidden) status.tab = "hidden";
      if (anyTyping) status.typing = true;
      if (user) status.user = user;
      if (screen) status.screen = screen;
      users.push({ id, status });
    }
    setRoomStats({ ...data, users });
  }, []);

  const handleInitHistory = useCallback(
    (data: HistoryChatMessage[]) => {
      setIsLoading(false);
      setHasMore(data.length === 25);
      data.forEach(({ submissionId }) => {
        if (!submissionId) return;
        const pending = pendingSubmissionsRef.current.get(submissionId);
        if (pending?.timeoutId) clearTimeout(pending.timeoutId);
        pendingSubmissionsRef.current.delete(submissionId);
      });
      setChats((chats) => mergeInitialHistory(chats, data));
      if (data.length > 0) {
        oldestChatCursorRef.current = getHistoryCursor(data[0]);
        fetchMissingUsers(
          data.flatMap((c) =>
            c.authorType === "user" && c.userId ? [c.userId] : [],
          ),
        );
      }
      resumePendingSubmissionsRef.current();
    },
    [fetchMissingUsers],
  );

  const handleHistory = useCallback(
    (data: HistoryChatMessage[]) => {
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
        return [
          ...data
            .filter((chat) => !existingIds.has(chat.id))
            .map(({ submissionId, ...chat }) => {
              void submissionId;
              return chat;
            }),
          ...chats,
        ];
      });
      oldestChatCursorRef.current = getHistoryCursor(data[0]);
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
      if (isHistoricalViewRef.current || !stickToBottomRef.current) {
        unreadCountRef.current += 1;
        setUnreadCount(unreadCountRef.current);
      }
    },
    [debouncedFetchMissingUsers],
  );

  // Initial scroll to bottom once history loaded
  useEffect(() => {
    if (isLoading || isHistoricalView) return;
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [chatListRef, isHistoricalView, isLoading]);

  // Scroll listener: track user intent (stick vs free)
  useEffect(() => {
    const el = chatListRef.current;
    if (!el || isLoading || isHistoricalView) return;

    const onScroll = () => {
      const stick =
        el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD_PX;
      setStick(stick);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatListRef, isHistoricalView, isLoading, setStick]);

  // ResizeObserver on the inner content (its height tracks content growth;
  // the scroll container's box stays the same size).
  useEffect(() => {
    const el = chatListRef.current;
    const content = contentRef.current;
    if (!el || !content || isLoading || isHistoricalView) return;

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
  }, [chatListRef, contentRef, isHistoricalView, isLoading]);

  // Infinite scroll: load history when loader is visible
  useEffect(() => {
    if (!loaderRef.current || isLoading || isHistoricalView) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (
          entry.isIntersecting &&
          oldestChatCursorRef.current &&
          !isLoadingHistoryRef.current &&
          hasMore
        ) {
          sendMessage(
            JSON.stringify({
              type: "loadHistory",
              data: {
                before: oldestChatCursorRef.current,
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
  }, [hasMore, isHistoricalView, isLoading, loaderRef, sendMessage]);

  const setSubmissionState = useCallback(
    (submissionId: string, sendState: "waiting" | "sending" | "failed") => {
      const pending = pendingSubmissionsRef.current.get(submissionId);
      if (pending) pending.state = sendState;
      setChats((chats) =>
        chats.map((chat) =>
          chat.submissionId === submissionId
            ? {
                ...chat,
                sendState,
                canCancelSend:
                  sendState === "waiting" && !!pending && !pending.attempted,
              }
            : chat,
        ),
      );
    },
    [],
  );

  const markSubmissionFailed = useCallback(
    (submissionId: string) => {
      const pending = pendingSubmissionsRef.current.get(submissionId);
      if (pending?.timeoutId) clearTimeout(pending.timeoutId);
      if (pending) pending.timeoutId = null;
      setSubmissionState(submissionId, "failed");
    },
    [setSubmissionState],
  );

  const sendSubmission = useCallback(
    (submission: MessageSubmission) => {
      const previous = pendingSubmissionsRef.current.get(
        submission.submissionId,
      );
      if (previous?.timeoutId) clearTimeout(previous.timeoutId);
      pendingSubmissionsRef.current.set(
        submission.submissionId,
        previous ?? {
          submission,
          timeoutId: null,
          state: "waiting",
          attempted: false,
        },
      );

      if (readyStateRef.current !== WebSocket.OPEN) {
        setSubmissionState(submission.submissionId, "waiting");
        return;
      }

      const pendingBeforeSend = pendingSubmissionsRef.current.get(
        submission.submissionId,
      );
      if (pendingBeforeSend) pendingBeforeSend.attempted = true;
      try {
        sendMessage(gm({ type: "send", data: submission }));
      } catch {
        setSubmissionState(submission.submissionId, "waiting");
        return;
      }

      setSubmissionState(submission.submissionId, "sending");

      const pending = pendingSubmissionsRef.current.get(
        submission.submissionId,
      );
      if (!pending) return;
      pending.timeoutId = setTimeout(
        () => markSubmissionFailed(submission.submissionId),
        ACCEPTANCE_TIMEOUT_MS,
      );
    },
    [markSubmissionFailed, sendMessage, setSubmissionState],
  );

  useLayoutEffect(() => {
    resumePendingSubmissionsRef.current = () => {
      pendingSubmissionsRef.current.forEach((pending) => {
        if (pending.state === "waiting") sendSubmission(pending.submission);
      });
    };
  }, [sendSubmission]);

  const retrySubmission = useCallback(
    (submissionId: string) => {
      const pending = pendingSubmissionsRef.current.get(submissionId);
      if (pending) sendSubmission(pending.submission);
    },
    [sendSubmission],
  );

  const removeSubmission = useCallback((submissionId: string) => {
    const pending = pendingSubmissionsRef.current.get(submissionId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    pendingSubmissionsRef.current.delete(submissionId);
    setChats((chats) =>
      chats.filter((chat) => chat.submissionId !== submissionId),
    );
  }, []);

  const cancelSubmission = useCallback(
    (submissionId: string) => {
      const pending = pendingSubmissionsRef.current.get(submissionId);
      if (pending?.state === "waiting" && !pending.attempted) {
        removeSubmission(submissionId);
      }
    },
    [removeSubmission],
  );

  const handleMessageAcceptance = useCallback((data: MessageAcceptance) => {
    const pending = pendingSubmissionsRef.current.get(data.submissionId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    pendingSubmissionsRef.current.delete(data.submissionId);
    setChats((chats) => reconcileMessageAcceptance(chats, data));
  }, []);

  const handleMessageRejection = useCallback((data: MessageRejection) => {
    const pending = pendingSubmissionsRef.current.get(data.submissionId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    pendingSubmissionsRef.current.delete(data.submissionId);
    setChats((chats) =>
      chats.map((chat) =>
        chat.submissionId === data.submissionId
          ? {
              ...chat,
              sendState: "rejected",
              rejectionReason: data.reason,
            }
          : chat,
      ),
    );
  }, []);

  const handleDisconnect = useCallback(() => {
    pendingSubmissionsRef.current.forEach((pending, submissionId) => {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
      if (pending.state === "sending") {
        setSubmissionState(submissionId, "waiting");
      }
    });
  }, [setSubmissionState]);

  const sendText = useCallback(
    (content: string, replyTo?: ReplyRef) => {
      const submissionId = crypto.randomUUID();
      setStick(true);
      setChats((chats) => [
        ...chats,
        {
          id: submissionId,
          submissionId,
          sendState:
            readyStateRef.current === WebSocket.OPEN ? "sending" : "waiting",
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
    cancelSubmission,
    removeSubmission,
    handleMessageAcceptance,
    handleMessageRejection,
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
