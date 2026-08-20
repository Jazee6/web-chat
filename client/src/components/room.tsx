import AddFavoritesButton from "@/components/add-favorites-button.tsx";
import ChatInput, {
  type EditRequest,
  type MentionRequest,
} from "@/components/chat-input.tsx";
import ChatList from "@/components/chat-list.tsx";
import HistoricalContextView from "@/components/historical-context-view.tsx";
import RealtimeLand from "@/components/realtime-land.tsx";
import RealtimeSidebar from "@/components/realtime-sidebar.tsx";
import RoomSearchDialog from "@/components/room-search-dialog.tsx";
import RoomSettingsDialog from "@/components/room-settings-dialog.tsx";
import RoomStateDialog from "@/components/room-state-dialog.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useIncomingCall } from "@/hooks/use-incoming-call.ts";
import { useRoom } from "@/hooks/use-room.ts";
import { usePrefetchStickers } from "@/hooks/use-stickers.ts";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import { RoomContext, type RoomContextType } from "@/lib/context.ts";
import { flashMessage } from "@/lib/flash-message.ts";
import { toReplyRef } from "@/lib/reply.ts";
import {
  getHistoryCursor,
  initialContextRequest,
  pagedContextRequest,
  parseContextPage,
  requestContext,
  RoomHistoryRequestError,
} from "@/lib/room-history.ts";
import { appName } from "@/lib/utils.ts";
import type { User } from "better-auth";
import {
  ArrowDown,
  ChevronDown,
  PictureInPicture,
  Search,
  Settings,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBeforeUnload, useNavigate } from "react-router";
import type {
  ChatMessage,
  HistoryChatMessage,
  ReplyRef,
  UIChatMessage,
} from "web-chat-share";

let realtimeKeyCounter = 0;

const CallSession = lazy(() => import("@/components/call-session.tsx"));

type HistoricalContextState = {
  targetId: string;
  messages: HistoryChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loadingInitial: boolean;
  loadingBefore: boolean;
  loadingAfter: boolean;
  error?: "initial" | "before" | "after";
};

const compareHistoryMessages = (
  left: Pick<ChatMessage, "createdAt" | "id">,
  right: Pick<ChatMessage, "createdAt" | "id">,
) => {
  const time =
    left.createdAt === right.createdAt
      ? 0
      : left.createdAt < right.createdAt
        ? -1
        : 1;
  if (time !== 0) return time;
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
};

const mergeHistoryMessages = (
  current: HistoryChatMessage[],
  incoming: HistoryChatMessage[],
) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()].sort(compareHistoryMessages);
};

// Lives inside RoomContext + UserInfoProvider, so it can react to Call
// arrivals and surface the incoming-call toast + chime.
const RoomEffects = () => {
  useIncomingCall();
  return null;
};

const Room = ({
  id,
  user,
  onTogglePip,
  isPipActive,
}: {
  id: string;
  user: User;
  onTogglePip?: () => void;
  isPipActive?: boolean;
}) => {
  const navigate = useNavigate();
  const { fetchMissingUsers } = useUserInfo();
  const [roomStateDialogOpen, setRoomStateDialogOpen] = useState(false);
  const [roomSettingsDialogOpen, setRoomSettingsDialogOpen] = useState(false);
  const [realtimeWindowOpen, setRealtimeWindowOpen] = useState(false);
  const [realtimeSidebarOpen, setRealtimeSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historicalContext, setHistoricalContext] =
    useState<HistoricalContextState>();
  const [audioTrackMap, setAudioTrackMap] = useState<
    Record<string, MediaStreamTrack>
  >({});
  const [realtimeKey, setRealtimeKey] = useState(0);
  // The message being replied to, captured as a denormalized snapshot the
  // moment the user picks "回复". Lives here so both ChatList (source) and
  // ChatInput (preview + send) share one source of truth. See ADR 0003.
  const [replyTarget, setReplyTarget] = useState<ReplyRef | null>(null);
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(
    null,
  );
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  usePrefetchStickers(user.id);

  const chatListRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const previousSearchFocusRef = useRef<HTMLElement | null>(null);
  const contextRequestIdRef = useRef(0);
  const contextControllerRef = useRef<AbortController | null>(null);
  const contextPageLoadingRef = useRef(false);

  const onOpen = () => {
    if (realtimeWindowOpen) {
      setRealtimeKey(++realtimeKeyCounter);
    }
  };

  const {
    ws,
    readyState,
    isLoading,
    hasMore,
    chats,
    users,
    roomStats,
    roomInfo,
    aiTyping,
    roomRealtime,
    realtimeStatus,
    onSend,
    setTyping,
    sendSticker,
    retrySubmission,
    cancelSubmission,
    removeSubmission,
    retryImageUpload,
    confirmUploadedImages,
    stickToBottom,
    unreadCount,
    scrollToBottom,
  } = useRoom({
    id,
    user,
    chatListRef,
    contentRef,
    loaderRef,
    onOpen,
    isHistoricalView: !!historicalContext,
  });

  const openSearch = useCallback(() => {
    if (searchOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      previousSearchFocusRef.current = active;
    }
    setSearchOpen(true);
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    const previous = previousSearchFocusRef.current;
    previousSearchFocusRef.current = null;
    if (!previous?.isConnected) return;
    window.requestAnimationFrame(() => previous.focus());
  }, []);

  const handleSearchOpenChange = useCallback(
    (open: boolean) => {
      if (open) openSearch();
      else closeSearch();
    },
    [closeSearch, openSearch],
  );

  const handleRoomNotFound = useCallback(() => {
    closeSearch();
    navigate("/rooms");
  }, [closeSearch, navigate]);

  const loadInitialContext = useCallback(
    (targetId: string) => {
      contextControllerRef.current?.abort();
      contextPageLoadingRef.current = false;
      const requestId = ++contextRequestIdRef.current;
      const controller = new AbortController();
      contextControllerRef.current = controller;
      setHistoricalContext({
        targetId,
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
        loadingInitial: true,
        loadingBefore: false,
        loadingAfter: false,
      });

      void requestContext(
        id,
        initialContextRequest(targetId),
        controller.signal,
      )
        .then((response) => {
          if (requestId !== contextRequestIdRef.current) return;
          const page = parseContextPage(response);
          fetchMissingUsers(
            page.messages.flatMap((message) =>
              message.authorType === "user" && message.userId
                ? [message.userId]
                : [],
            ),
          );
          setHistoricalContext((current) =>
            current && current.targetId === targetId
              ? {
                  ...current,
                  messages: mergeHistoryMessages([], page.messages),
                  hasMoreBefore: page.hasMoreBefore,
                  hasMoreAfter: page.hasMoreAfter,
                  loadingInitial: false,
                  error: undefined,
                }
              : current,
          );
        })
        .catch((error: unknown) => {
          if (requestId !== contextRequestIdRef.current) return;
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (
            error instanceof RoomHistoryRequestError &&
            error.status === 404
          ) {
            handleRoomNotFound();
            return;
          }
          setHistoricalContext((current) =>
            current && current.targetId === targetId
              ? { ...current, loadingInitial: false, error: "initial" }
              : current,
          );
        })
        .finally(() => {
          if (requestId === contextRequestIdRef.current) {
            contextControllerRef.current = null;
          }
        });
    },
    [fetchMissingUsers, handleRoomNotFound, id],
  );

  const loadContextPage = useCallback(
    async (direction: "before" | "after") => {
      const current = historicalContext;
      if (
        !current ||
        current.loadingInitial ||
        current.loadingBefore ||
        current.loadingAfter ||
        contextPageLoadingRef.current
      ) {
        return;
      }
      if (
        direction === "before" &&
        (current.loadingBefore || !current.hasMoreBefore)
      ) {
        return;
      }
      if (
        direction === "after" &&
        (current.loadingAfter || !current.hasMoreAfter)
      ) {
        return;
      }

      const edge =
        direction === "before"
          ? current.messages[0]
          : current.messages[current.messages.length - 1];
      if (!edge) return;

      contextControllerRef.current?.abort();
      const requestId = ++contextRequestIdRef.current;
      const controller = new AbortController();
      contextControllerRef.current = controller;
      contextPageLoadingRef.current = true;
      setHistoricalContext((state) =>
        state
          ? {
              ...state,
              loadingBefore: direction === "before",
              loadingAfter: direction === "after",
              error: undefined,
            }
          : state,
      );

      try {
        const response = await requestContext(
          id,
          pagedContextRequest(
            direction,
            current.targetId,
            getHistoryCursor(edge),
          ),
          controller.signal,
        );
        if (requestId !== contextRequestIdRef.current) return;

        const page = parseContextPage(response);
        fetchMissingUsers(
          page.messages.flatMap((message) =>
            message.authorType === "user" && message.userId
              ? [message.userId]
              : [],
          ),
        );
        setHistoricalContext((state) =>
          state
            ? {
                ...state,
                messages: mergeHistoryMessages(state.messages, page.messages),
                hasMoreBefore:
                  direction === "before"
                    ? page.hasMoreBefore
                    : state.hasMoreBefore,
                hasMoreAfter:
                  direction === "after"
                    ? page.hasMoreAfter
                    : state.hasMoreAfter,
                error: undefined,
              }
            : state,
        );
      } catch (error: unknown) {
        if (requestId !== contextRequestIdRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (error instanceof RoomHistoryRequestError && error.status === 404) {
          handleRoomNotFound();
          return;
        }
        setHistoricalContext((state) =>
          state ? { ...state, error: direction } : state,
        );
      } finally {
        if (requestId === contextRequestIdRef.current) {
          contextControllerRef.current = null;
          contextPageLoadingRef.current = false;
          setHistoricalContext((state) =>
            state
              ? { ...state, loadingBefore: false, loadingAfter: false }
              : state,
          );
        }
      }
    },
    [fetchMissingUsers, handleRoomNotFound, historicalContext, id],
  );

  const handleSearchResult = useCallback(
    (message: ChatMessage) => {
      if (!historicalContext && document.getElementById(message.id)) {
        closeSearch();
        window.requestAnimationFrame(() =>
          flashMessage(message.id, {
            block: "start",
            behavior: "instant",
            scrollMarginTop: 64,
          }),
        );
        return;
      }
      closeSearch();
      loadInitialContext(message.id);
    },
    [closeSearch, historicalContext, loadInitialContext],
  );

  const retryInitialContext = useCallback(() => {
    if (historicalContext) loadInitialContext(historicalContext.targetId);
  }, [historicalContext, loadInitialContext]);

  const backToLatest = useCallback(() => {
    contextControllerRef.current?.abort();
    contextPageLoadingRef.current = false;
    contextRequestIdRef.current += 1;
    setHistoricalContext(undefined);
    window.requestAnimationFrame(() => scrollToBottom());
  }, [scrollToBottom]);

  const loadBeforeContext = useCallback(
    () => loadContextPage("before"),
    [loadContextPage],
  );
  const loadAfterContext = useCallback(
    () => loadContextPage("after"),
    [loadContextPage],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openSearch]);

  useEffect(() => {
    return () => contextControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (detail.id === id) setRoomSettingsDialogOpen(true);
    };
    addEventListener("room-settings:open", openSettings);
    return () => removeEventListener("room-settings:open", openSettings);
  }, [id]);

  useBeforeUnload((e) => {
    if (realtimeWindowOpen) {
      e.preventDefault();
    }
  });

  const onCall = () => {
    setRealtimeWindowOpen(true);
  };

  const tracksToPull =
    realtimeStatus
      ?.filter((i) => i.userId !== user.id)
      ?.filter((status) => status.sessionId && status.audio?.id)
      .map((status) => ({
        uid: status.userId,
        sessionId: status.sessionId!,
        trackName: status.audio!.id,
      })) ?? [];

  const roomContextValue: RoomContextType = {
    ws,
    wsReadyState: readyState,
    uid: user.id,
    roomRealtime,
    realtimeStatus,
    setRealtimeWindowOpen,
    realtimeSidebarOpen,
    audioTrackMap,
  };

  // Stable identities: these feed AudioTrack's effect deps. Without memo,
  // every Room re-render makes new function refs and the effect tears down +
  // re-subscribes every pull — which re-creates transceivers and fires a
  // fresh tracks/new + renegotiate round-trip per peer, even when nothing
  // about the tracks actually changed.
  const onTrackAdded = useCallback((uid: string, track: MediaStreamTrack) => {
    setAudioTrackMap((previous) => ({
      ...previous,
      [uid]: track,
    }));
  }, []);

  const onTrackRemoved = useCallback((uid: string) => {
    setAudioTrackMap((previous) => {
      const update = { ...previous };
      delete update[uid];
      return update;
    });
  }, []);

  return (
    <>
      <RoomContext value={roomContextValue}>
        <RoomEffects />
        {realtimeWindowOpen && (
          <Suspense
            fallback={
              <div className="fixed right-16 top-20 z-50 flex h-24 w-64 items-center justify-center rounded-lg border bg-background/80 shadow-lg backdrop-blur">
                <Spinner />
              </div>
            }
          >
            <CallSession
              realtimeKey={realtimeKey}
              tracksToPull={tracksToPull}
              onOpenChange={setRealtimeWindowOpen}
              onTrackAdded={onTrackAdded}
              onTrackRemoved={onTrackRemoved}
            />
          </Suspense>
        )}
        <SidebarProvider
          open={realtimeSidebarOpen}
          onOpenChange={setRealtimeSidebarOpen}
        >
          <SidebarInset>
            <header className="absolute top-0 z-10 w-full rounded-t-xl app-blur">
              <div className="h-16">
                {roomStats && (
                  <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center justify-between relative">
                    <div className="max-[1080px]:ml-12">{roomInfo?.name}</div>

                    <div className="absolute left-1/2 -translate-x-1/2">
                      <RealtimeLand
                        data={roomRealtime}
                        onClick={() => setRealtimeSidebarOpen(true)}
                      />
                    </div>

                    <div className="flex items-center">
                      <Button
                        size="icon-sm"
                        className="rounded-full"
                        variant="ghost"
                        onClick={openSearch}
                        title="Search room history (Ctrl+F)"
                      >
                        <Search />
                        <span className="sr-only">Search room history</span>
                      </Button>
                      {roomInfo?.userId === user.id && (
                        <Button
                          size="icon-sm"
                          className="rounded-full"
                          variant="ghost"
                          onClick={() => setRoomSettingsDialogOpen(true)}
                        >
                          <Settings />
                          <span className="sr-only">Room settings</span>
                        </Button>
                      )}
                      <AddFavoritesButton
                        id={id}
                        added={!!roomInfo?.isFavorite}
                        disabled={roomInfo?.userId === user.id}
                      />
                      {"documentPictureInPicture" in window && (
                        <Button
                          size="icon-sm"
                          className="rounded-full"
                          variant="ghost"
                          onClick={onTogglePip}
                        >
                          <PictureInPicture />
                        </Button>
                      )}
                      {"share" in navigator && !isPipActive && (
                        <ShareButton title={`${roomInfo?.name} - ${appName}`} />
                      )}

                      <Button
                        className="rounded-full size-6 ml-1"
                        disabled={isPipActive}
                        onClick={() => setRoomStateDialogOpen(true)}
                      >
                        {roomStats.users.length}
                      </Button>

                      <RoomStateDialog
                        roomStats={roomStats}
                        roomInfo={roomInfo}
                        open={roomStateDialogOpen}
                        onOpenChange={setRoomStateDialogOpen}
                      />
                    </div>
                  </div>
                )}
              </div>
              {historicalContext && (
                <div className="relative h-14">
                  <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-between gap-3 max-md:px-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        Historical context
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        Search result context, separate from the latest messages
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={backToLatest}
                      className="shrink-0"
                    >
                      <ArrowDown data-icon="inline-start" />
                      {unreadCount > 0
                        ? `Back to latest (${unreadCount} new)`
                        : "Back to latest"}
                    </Button>
                  </div>
                  <Separator className="pointer-events-none absolute inset-x-0 bottom-0" />
                </div>
              )}
            </header>

            <div className="h-dvh flex flex-col relative">
              {historicalContext ? (
                <HistoricalContextView
                  targetId={historicalContext.targetId}
                  messages={historicalContext.messages}
                  hasMoreBefore={historicalContext.hasMoreBefore}
                  hasMoreAfter={historicalContext.hasMoreAfter}
                  loadingInitial={historicalContext.loadingInitial}
                  loadingBefore={historicalContext.loadingBefore}
                  loadingAfter={historicalContext.loadingAfter}
                  error={historicalContext.error}
                  userId={user.id}
                  users={users}
                  roomStats={roomStats}
                  onLoadBefore={loadBeforeContext}
                  onLoadAfter={loadAfterContext}
                  onRetryInitial={retryInitialContext}
                  onRetryBefore={() => void loadBeforeContext()}
                  onRetryAfter={() => void loadAfterContext()}
                />
              ) : chats ? (
                <div
                  className="overflow-y-auto scrollbar pt-16 max-md:px-2 scrollbar-gutter-both overflow-x-hidden"
                  ref={chatListRef}
                >
                  <div ref={contentRef}>
                    {hasMore && !isLoading && (
                      <div ref={loaderRef} className="flex justify-center py-4">
                        <Spinner />
                      </div>
                    )}

                    <ChatList
                      className="pb-24"
                      chats={chats}
                      userId={user.id}
                      users={users}
                      roomStats={roomStats}
                      aiTyping={aiTyping}
                      onRetry={retrySubmission}
                      onCancel={cancelSubmission}
                      onRemove={removeSubmission}
                      onRetryUpload={(submissionId, index) =>
                        void retryImageUpload(submissionId, index)
                      }
                      onConfirmImages={confirmUploadedImages}
                      onEditRejected={(message) => {
                        if (!message.submissionId) return;
                        removeSubmission(message.submissionId);
                        setReplyTarget(message.replyTo ?? null);
                        setEditRequest((current) => ({
                          id: (current?.id ?? 0) + 1,
                          content: message.content,
                        }));
                      }}
                      onReply={(message: UIChatMessage) => {
                        if (message.submissionId) return;
                        setReplyTarget(toReplyRef(message));
                      }}
                      onMention={(name) =>
                        setMentionRequest((current) => ({
                          id: (current?.id ?? 0) + 1,
                          name,
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}

              {!historicalContext && !isLoading && !stickToBottom && (
                <Button
                  size="sm"
                  onClick={scrollToBottom}
                  className="absolute left-1/2 -translate-x-1/2 bottom-36 z-10 rounded-full shadow-md backdrop-blur-[20px] backdrop-saturate-180"
                >
                  <ChevronDown className="size-4" />
                  {unreadCount > 0 && <span>{unreadCount}</span>}
                </Button>
              )}

              <ChatInput
                className="mt-auto"
                onSend={onSend}
                isLoading={isLoading}
                onCall={onCall}
                onTypingChange={setTyping}
                onSendSticker={sendSticker}
                userId={user.id}
                replyTarget={replyTarget}
                users={users}
                onCancelReply={() => setReplyTarget(null)}
                mentionRequest={mentionRequest}
                editRequest={editRequest}
              />
            </div>
          </SidebarInset>

          {!!roomRealtime?.total && <RealtimeSidebar />}
        </SidebarProvider>
        <RoomSearchDialog
          roomId={id}
          open={searchOpen}
          onOpenChange={handleSearchOpenChange}
          users={users}
          fetchMissingUsers={fetchMissingUsers}
          onSelectResult={handleSearchResult}
          onRoomNotFound={handleRoomNotFound}
        />
        {roomInfo?.userId === user.id && (
          <RoomSettingsDialog
            roomInfo={roomInfo}
            open={roomSettingsDialogOpen}
            onOpenChange={setRoomSettingsDialogOpen}
          />
        )}
      </RoomContext>
    </>
  );
};

export default Room;
