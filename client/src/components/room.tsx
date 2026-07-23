import AddFavoritesButton from "@/components/add-favorites-button.tsx";
import ChatInput from "@/components/chat-input.tsx";
import ChatList from "@/components/chat-list.tsx";
import RealtimeLand from "@/components/realtime-land.tsx";
import RealtimeSidebar from "@/components/realtime-sidebar.tsx";
import RoomSettingsDialog from "@/components/room-settings-dialog.tsx";
import RoomStateDialog from "@/components/room-state-dialog.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useIncomingCall } from "@/hooks/use-incoming-call.ts";
import { useRoom } from "@/hooks/use-room.ts";
import { RoomContext, type RoomContextType } from "@/lib/context.ts";
import { toReplyRef } from "@/lib/reply.ts";
import { appName } from "@/lib/utils.ts";
import type { User } from "better-auth";
import { ChevronDown, PictureInPicture, Settings } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBeforeUnload } from "react-router";
import type { ReplyRef, UIChatMessage } from "web-chat-share";

let realtimeKeyCounter = 0;

const CallSession = lazy(() => import("@/components/call-session.tsx"));

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
  const [roomStateDialogOpen, setRoomStateDialogOpen] = useState(false);
  const [roomSettingsDialogOpen, setRoomSettingsDialogOpen] = useState(false);
  const [realtimeWindowOpen, setRealtimeWindowOpen] = useState(false);
  const [realtimeSidebarOpen, setRealtimeSidebarOpen] = useState(false);
  const [audioTrackMap, setAudioTrackMap] = useState<
    Record<string, MediaStreamTrack>
  >({});
  const [realtimeKey, setRealtimeKey] = useState(0);
  // The message being replied to, captured as a denormalized snapshot the
  // moment the user picks "回复". Lives here so both ChatList (source) and
  // ChatInput (preview + send) share one source of truth. See ADR 0003.
  const [replyTarget, setReplyTarget] = useState<ReplyRef | null>(null);

  const chatListRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

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
  });

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
            <header className="h-16 absolute top-0 w-full z-10 rounded-t-xl app-blur">
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
            </header>

            <div className="h-dvh flex flex-col relative">
              {chats && (
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
                      onReply={(message: UIChatMessage) =>
                        setReplyTarget(toReplyRef(message))
                      }
                    />
                  </div>
                </div>
              )}

              {!isLoading && !stickToBottom && (
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
                replyTarget={replyTarget}
                users={users}
                onCancelReply={() => setReplyTarget(null)}
              />
            </div>
          </SidebarInset>

          {!!roomRealtime?.total && <RealtimeSidebar />}
        </SidebarProvider>
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
