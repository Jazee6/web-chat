import ChatList from "@/components/chat-list.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { flashMessage } from "@/lib/flash-message.ts";
import type { User } from "better-auth";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { HistoryChatMessage, RoomStats } from "web-chat-share";

type HistoricalContextViewProps = {
  targetId: string;
  messages: HistoryChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loadingInitial: boolean;
  loadingBefore: boolean;
  loadingAfter: boolean;
  error?: "initial" | "before" | "after";
  userId: string;
  users: Record<string, User>;
  roomStats?: RoomStats;
  onLoadBefore: () => Promise<void>;
  onLoadAfter: () => Promise<void>;
  onRetryInitial: () => void;
  onRetryBefore: () => void;
  onRetryAfter: () => void;
};

const HistoricalContextView = ({
  targetId,
  messages,
  hasMoreBefore,
  hasMoreAfter,
  loadingInitial,
  loadingBefore,
  loadingAfter,
  error,
  userId,
  users,
  roomStats,
  onLoadBefore,
  onLoadAfter,
  onRetryInitial,
  onRetryBefore,
  onRetryAfter,
}: HistoricalContextViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const beforeSentinelRef = useRef<HTMLDivElement>(null);
  const afterSentinelRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const flashedTargetRef = useRef<string | null>(null);
  const pageRequestRef = useRef(false);

  const loadBefore = useCallback(async () => {
    if (pageRequestRef.current || loadingBefore || !hasMoreBefore) return;
    pageRequestRef.current = true;
    const element = scrollRef.current;
    if (element) {
      prependAnchorRef.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
      };
    }
    try {
      await onLoadBefore();
    } finally {
      pageRequestRef.current = false;
    }
  }, [hasMoreBefore, loadingBefore, onLoadBefore]);

  const loadAfter = useCallback(async () => {
    if (pageRequestRef.current || loadingAfter || !hasMoreAfter) return;
    pageRequestRef.current = true;
    try {
      await onLoadAfter();
    } finally {
      pageRequestRef.current = false;
    }
  }, [hasMoreAfter, loadingAfter, onLoadAfter]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = beforeSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      !hasMoreBefore ||
      loadingBefore ||
      error === "before"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadBefore();
      },
      { root, rootMargin: "128px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMoreBefore, loadBefore, loadingBefore]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = afterSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      !hasMoreAfter ||
      loadingAfter ||
      error === "after"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadAfter();
      },
      { root, rootMargin: "128px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMoreAfter, loadAfter, loadingAfter]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || loadingBefore || !element) return;

    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    prependAnchorRef.current = null;
  }, [loadingBefore, messages]);

  useEffect(() => {
    if (loadingInitial) flashedTargetRef.current = null;
  }, [loadingInitial]);

  useEffect(() => {
    if (flashedTargetRef.current === targetId) return;
    if (
      loadingInitial ||
      !messages.some((message) => message.id === targetId)
    ) {
      return;
    }

    flashedTargetRef.current = targetId;
    const frame = window.requestAnimationFrame(() =>
      flashMessage(targetId, {
        block: "start",
        behavior: "instant",
        scrollMarginTop: 64,
      }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [loadingInitial, messages, targetId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-16">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar scrollbar-gutter-both"
      >
        <div aria-hidden className="h-14" />

        {loadingInitial ? (
          <div className="flex min-h-64 items-center justify-center gap-2">
            <Spinner />
            Loading context...
          </div>
        ) : error === "initial" ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyTitle>Could not load this context</EmptyTitle>
              <EmptyDescription>
                The message may be temporarily unavailable.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={onRetryInitial}>
                <RotateCcw data-icon="inline-start" />
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="min-h-full py-2">
            <div
              ref={beforeSentinelRef}
              className="flex min-h-9 items-center justify-center px-3"
            >
              {loadingBefore ? (
                <Spinner />
              ) : hasMoreBefore ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadBefore()}
                >
                  <ArrowUp data-icon="inline-start" />
                  Load earlier messages
                </Button>
              ) : null}
            </div>

            {error === "before" && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-destructive">
                <span>Could not load earlier messages.</span>
                <Button size="xs" variant="outline" onClick={onRetryBefore}>
                  Retry
                </Button>
              </div>
            )}

            <ChatList
              className="pb-4"
              chats={messages}
              userId={userId}
              users={users}
              roomStats={roomStats}
            />

            {error === "after" && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-destructive">
                <span>Could not load newer context messages.</span>
                <Button size="xs" variant="outline" onClick={onRetryAfter}>
                  Retry
                </Button>
              </div>
            )}

            <div
              ref={afterSentinelRef}
              className="flex min-h-9 items-center justify-center px-3"
            >
              {loadingAfter ? (
                <Spinner />
              ) : hasMoreAfter ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadAfter()}
                >
                  Load newer context messages
                  <ArrowDown data-icon="inline-end" />
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoricalContextView;
