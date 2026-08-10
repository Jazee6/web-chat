import { Button } from "@/components/ui/button.tsx";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import {
  getReadiness,
  getSearchPreview,
  parseSearchPage,
  requestSearch,
  RoomHistoryRequestError,
  validateSearchQuery,
  type HistoryCursor,
  type SearchPage,
  type SearchQueryValidation,
} from "@/lib/room-history.ts";
import { formatChatListTime } from "@/lib/utils.ts";
import type { User } from "better-auth";
import { RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "web-chat-share";

type SearchPhase =
  | "initial"
  | "short"
  | "too-long"
  | "loading"
  | "preparing"
  | "unavailable"
  | "ready"
  | "empty"
  | "error";

type SearchErrorScope = "search" | "more";

type RoomSearchDialogProps = {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: Record<string, User>;
  fetchMissingUsers: (ids: string[]) => void;
  onSelectResult: (message: ChatMessage) => void;
  onRoomNotFound: () => void;
};

const phaseForValidation = (
  state: SearchQueryValidation,
): SearchPhase | null => {
  if (state === "empty") return "initial";
  if (state === "short") return "short";
  if (state === "too-long") return "too-long";
  return null;
};

const getAuthorName = (message: ChatMessage, users: Record<string, User>) => {
  if (message.authorType === "ai") return "AI";
  if (message.authorType === "system") return "System";
  return (message.userId && users[message.userId]?.name) || "Unknown user";
};

const SearchPreview = ({
  message,
  query,
}: {
  message: ChatMessage;
  query: string;
}) => {
  const preview = getSearchPreview(message.content, query);
  return (
    <span className="text-muted-foreground line-clamp-2 wrap-anywhere">
      {preview.clippedBefore && <span aria-hidden="true">... </span>}
      {preview.parts.map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.matched ? "bg-primary/20 text-primary" : undefined}
        >
          {part.text}
        </span>
      ))}
      {preview.clippedAfter && <span aria-hidden="true"> ...</span>}
    </span>
  );
};

const ResultItem = ({
  message,
  query,
  users,
  onSelect,
}: {
  message: ChatMessage;
  query: string;
  users: Record<string, User>;
  onSelect: (message: ChatMessage) => void;
}) => {
  const authorName = getAuthorName(message, users);
  const content =
    message.type === "text" ? (
      <SearchPreview message={message} query={query} />
    ) : (
      <span className="text-muted-foreground">Image message</span>
    );

  return (
    <CommandItem
      value={message.id}
      onSelect={() => onSelect(message)}
      className="items-start py-2.5 [&>svg:last-child]:hidden"
      aria-label={`${authorName}, ${formatChatListTime(message.createdAt)}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{authorName}</span>
          <time
            dateTime={message.createdAt}
            className="ml-auto shrink-0 text-xs text-muted-foreground"
          >
            {formatChatListTime(message.createdAt)}
          </time>
        </div>
        {content}
      </div>
    </CommandItem>
  );
};

const RoomSearchDialog = ({
  roomId,
  open,
  onOpenChange,
  users,
  fetchMissingUsers,
  onSelectResult,
  onRoomNotFound,
}: RoomSearchDialogProps) => {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("initial");
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorScope, setErrorScope] = useState<SearchErrorScope>("search");

  const queryRef = useRef("");
  const snapshotRef = useRef<HistoryCursor | undefined>(undefined);
  const nextCursorRef = useRef<HistoryCursor | undefined>(undefined);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollTopRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const abortActiveRequest = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const resetPagination = useCallback(() => {
    snapshotRef.current = undefined;
    nextCursorRef.current = undefined;
    setHasMore(false);
    scrollTopRef.current = 0;
    listRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const applyPage = useCallback((page: SearchPage) => {
    const nextSnapshot = page.snapshot;
    const next = page.nextCursor;
    snapshotRef.current = nextSnapshot;
    nextCursorRef.current = next;
    setHasMore(page.hasMore && next !== undefined);
  }, []);

  const handleRequestError = useCallback(
    (error: unknown, scope: SearchErrorScope) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof RoomHistoryRequestError && error.status === 404) {
        onRoomNotFound();
        return;
      }
      setErrorScope(scope);
      setPhase("error");
    },
    [onRoomNotFound],
  );

  const performSearch = useCallback(
    async (normalized: string, action: "status" | "retry" = "status") => {
      abortActiveRequest();
      const requestId = requestIdRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      queryRef.current = normalized;
      setQuery(normalized);
      setPhase("loading");
      setIsLoadingMore(false);
      setErrorScope("search");
      resetPagination();

      try {
        const statusResponse = await requestSearch(
          roomId,
          { action },
          controller.signal,
        );
        if (requestId !== requestIdRef.current) return;

        const readiness = getReadiness(statusResponse);
        if (readiness !== "ready") {
          setResults([]);
          setPhase(readiness);
          return;
        }

        const response = await requestSearch(
          roomId,
          { action: "search", query: normalized },
          controller.signal,
        );
        if (requestId !== requestIdRef.current) return;

        const page = parseSearchPage(response);
        applyPage(page);
        if (page.readiness !== "ready") {
          setResults([]);
          setPhase(page.readiness);
          return;
        }
        setResults(page.results);
        setPhase(page.results.length > 0 ? "ready" : "empty");
      } catch (error) {
        if (requestId === requestIdRef.current) {
          handleRequestError(error, "search");
        }
      } finally {
        if (requestId === requestIdRef.current) {
          controllerRef.current = null;
        }
      }
    },
    [
      abortActiveRequest,
      applyPage,
      handleRequestError,
      resetPagination,
      roomId,
    ],
  );

  const loadMore = useCallback(async () => {
    const currentSnapshot = snapshotRef.current;
    const cursor = nextCursorRef.current;
    const normalized = queryRef.current;
    if (
      !currentSnapshot ||
      cursor === undefined ||
      !normalized ||
      isLoadingMore
    ) {
      return;
    }

    abortActiveRequest();
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoadingMore(true);
    setErrorScope("more");

    try {
      const response = await requestSearch(
        roomId,
        {
          action: "search",
          query: normalized,
          snapshot: currentSnapshot,
          cursor,
        },
        controller.signal,
      );
      if (requestId !== requestIdRef.current) return;

      const page = parseSearchPage(response);
      if (page.readiness !== "ready") {
        setPhase(page.readiness);
        return;
      }
      applyPage({
        ...page,
        snapshot: page.snapshot ?? currentSnapshot,
      });
      setResults((current) => {
        const existing = new Set(current.map((message) => message.id));
        return [
          ...current,
          ...page.results.filter((message) => !existing.has(message.id)),
        ];
      });
      setPhase("ready");
    } catch (error) {
      if (requestId === requestIdRef.current) {
        handleRequestError(error, "more");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoadingMore(false);
        controllerRef.current = null;
      }
    }
  }, [
    abortActiveRequest,
    applyPage,
    handleRequestError,
    isLoadingMore,
    roomId,
  ]);

  const retryUnavailable = useCallback(() => {
    const normalized = queryRef.current;
    if (!normalized) return;
    void performSearch(normalized, "retry");
  }, [performSearch]);

  const retry = useCallback(() => {
    if (errorScope === "more") {
      void loadMore();
    } else if (phase === "unavailable") {
      retryUnavailable();
    } else {
      const normalized = queryRef.current;
      if (normalized) void performSearch(normalized);
    }
  }, [errorScope, loadMore, performSearch, phase, retryUnavailable]);

  const applyInvalidDraft = useCallback(
    (state: SearchQueryValidation) => {
      abortActiveRequest();
      resetPagination();
      queryRef.current = "";
      setQuery("");
      setResults([]);
      setPhase(phaseForValidation(state) ?? "initial");
      setIsLoadingMore(false);
    },
    [abortActiveRequest, resetPagination],
  );

  useEffect(() => {
    const validation = validateSearchQuery(draft);
    if (validation.state !== "valid") return;

    if (validation.normalized === queryRef.current) return;

    const timer = window.setTimeout(() => {
      if (validation.normalized === queryRef.current) return;
      void performSearch(validation.normalized);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, performSearch]);

  useEffect(() => {
    const ids = results.flatMap((message) =>
      message.authorType === "user" && message.userId ? [message.userId] : [],
    );
    fetchMissingUsers(ids);
  }, [fetchMissingUsers, results]);

  useEffect(() => {
    if (!open || phase !== "preparing") return;

    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void requestSearch(roomId, { action: "status" }, controller.signal)
        .then((response) => {
          const readiness = getReadiness(response);
          if (readiness === "ready") {
            setPhase("initial");
          } else if (readiness === "unavailable") {
            setPhase("unavailable");
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (
            error instanceof RoomHistoryRequestError &&
            error.status === 404
          ) {
            onRoomNotFound();
          }
        });
    }, 2_000);

    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [onRoomNotFound, open, phase, roomId]);

  useEffect(() => {
    return () => abortActiveRequest();
  }, [abortActiveRequest]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (list) list.scrollTop = scrollTopRef.current;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (list) scrollTopRef.current = list.scrollTop;
    };
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && listRef.current) {
      scrollTopRef.current = listRef.current.scrollTop;
    }
    onOpenChange(nextOpen);
  };

  const handleInputChange = (value: string) => {
    setDraft(value);
    const validation = validateSearchQuery(value);
    if (validation.state === "valid") {
      if (validation.normalized !== queryRef.current) setPhase("loading");
    } else {
      applyInvalidDraft(validation.state);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const validation = validateSearchQuery(draft);
    if (validation.state === "valid") {
      void performSearch(validation.normalized);
    } else {
      applyInvalidDraft(validation.state);
    }
  };

  const renderEmptyState = () => {
    switch (phase) {
      case "initial":
        return <CommandEmpty>Search this room's message history.</CommandEmpty>;
      case "short":
        return (
          <CommandEmpty>Use at least 3 characters to search.</CommandEmpty>
        );
      case "too-long":
        return <CommandEmpty>Use no more than 100 characters.</CommandEmpty>;
      case "loading":
        return (
          <CommandEmpty className="flex items-center justify-center gap-2">
            <Spinner />
            Searching...
          </CommandEmpty>
        );
      case "preparing":
        return (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2">
              <Spinner />
              <span>Search is still preparing for this room.</span>
              <Button size="sm" variant="outline" onClick={retry}>
                Check again
              </Button>
            </div>
          </CommandEmpty>
        );
      case "unavailable":
        return (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2">
              <span>Search is unavailable right now.</span>
              <Button size="sm" variant="outline" onClick={retryUnavailable}>
                <RotateCcw data-icon="inline-start" />
                Retry search
              </Button>
            </div>
          </CommandEmpty>
        );
      case "empty":
        return <CommandEmpty>No messages match this search.</CommandEmpty>;
      case "error":
        return results.length === 0 ? (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2">
              <span>Search failed temporarily.</span>
              <Button size="sm" variant="outline" onClick={retry}>
                <RotateCcw data-icon="inline-start" />
                Retry search
              </Button>
            </div>
          </CommandEmpty>
        ) : null;
      case "ready":
        return results.length === 0 ? (
          <CommandEmpty>No messages match this search.</CommandEmpty>
        ) : null;
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search room history"
      description="Search messages in this room."
      className="max-h-[min(70dvh,36rem)] sm:max-w-2xl"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          value={draft}
          onValueChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder="Search room history..."
          aria-label="Search room history"
        />
        <CommandList ref={listRef} className="max-h-[min(70dvh,32rem)]">
          {phase === "loading" && results.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner />
              Searching...
            </div>
          )}

          {phase === "preparing" && results.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner />
              <span>Search is still preparing for this room.</span>
              <Button size="xs" variant="outline" onClick={retry}>
                Check again
              </Button>
            </div>
          )}

          {phase === "unavailable" && results.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-destructive">
              <span>Search is unavailable right now.</span>
              <Button size="xs" variant="outline" onClick={retryUnavailable}>
                <RotateCcw data-icon="inline-start" />
                Retry
              </Button>
            </div>
          )}

          {phase === "error" && results.length > 0 && (
            <CommandGroup>
              <CommandItem value="retry-search" onSelect={retry}>
                <RotateCcw />
                <span>Search failed temporarily. Retry</span>
              </CommandItem>
            </CommandGroup>
          )}

          {results.length > 0 && (
            <CommandGroup heading="Matches">
              {results.map((message) => (
                <ResultItem
                  key={message.id}
                  message={message}
                  query={query}
                  users={users}
                  onSelect={onSelectResult}
                />
              ))}
            </CommandGroup>
          )}

          {results.length === 0 && renderEmptyState()}

          {hasMore && results.length > 0 && (
            <CommandGroup>
              <CommandItem
                value="load-more-results"
                onSelect={() => void loadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <Spinner />
                ) : (
                  <span aria-hidden="true">+</span>
                )}
                <span>{isLoadingMore ? "Loading more..." : "Load more"}</span>
              </CommandItem>
            </CommandGroup>
          )}

          {isLoadingMore && results.length > 0 && phase !== "error" && (
            <div className="flex justify-center px-3 py-2">
              <Spinner />
            </div>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

export default RoomSearchDialog;
