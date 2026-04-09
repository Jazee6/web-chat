import AddFavoritesButton from "@/components/add-favorites-button.tsx";
import { AudioStream } from "@/components/audio-stream.tsx";
import ChatInput from "@/components/chat-input.tsx";
import ChatList from "@/components/chat-list.tsx";
import RealtimeProvider from "@/components/realtime-context.tsx";
import RealtimeLand from "@/components/realtime-land.tsx";
import RealtimeWindow from "@/components/realtime-window.tsx";
import RoomStateDialog from "@/components/room-state-dialog.tsx";
import ShareButton from "@/components/share-button.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useRoom } from "@/hooks/use-room.ts";
import { RoomContext } from "@/lib/context.ts";
import { appName } from "@/lib/utils.ts";
import type { User } from "better-auth";
import { PictureInPicture } from "lucide-react";
import { useRef, useState } from "react";

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
  const [realtimeWindowOpen, setRealtimeWindowOpen] = useState(false);

  const chatListRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  const {
    ws,
    isLoading,
    hasMore,
    chats,
    users,
    roomStats,
    roomInfo,
    roomRealtime,
    realtimeStatus,
    onSend,
  } = useRoom({
    id,
    user,
    chatListRef,
    loaderRef,
  });

  const onCall = () => {
    setRealtimeWindowOpen(true);
  };

  const tracksToPull = realtimeStatus
    .filter((status) => status.sessionId && status.audio?.id)
    .map((status) => ({
      sessionId: status.sessionId!,
      trackName: status.audio!.id,
    }));

  return (
    <>
      <header className="h-16 absolute top-0 w-full z-10 bg-linear-to-b from-background to-transparent rounded-t-xl backdrop-blur-xl">
        {roomStats && (
          <div className="max-w-3xl max-md:px-2 mx-auto h-full flex items-center justify-between relative">
            <div className="max-[1080px]:ml-12">{roomInfo?.name}</div>

            <div className="absolute left-1/2 -translate-x-1/2">
              <RealtimeLand data={roomRealtime} onClick={onCall} />
            </div>

            <div className="flex items-center">
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

      <div className="h-[calc(100vh-1rem)] flex flex-col">
        {chats && (
          <div
            style={{ scrollbarGutter: "stable both-edges" }}
            className="overflow-y-auto scrollbar pt-16 max-md:px-2"
            ref={chatListRef}
          >
            {hasMore && !isLoading && (
              <div ref={loaderRef} className="flex justify-center py-4">
                <Spinner />
              </div>
            )}

            <ChatList
              className="pb-32"
              chats={chats}
              userId={user.id}
              users={users}
              roomStats={roomStats}
            />
          </div>
        )}

        <ChatInput
          className="mt-auto"
          onSend={onSend}
          isLoading={isLoading}
          onCall={onCall}
        />

        {/*<ViewTransition>*/}
        {realtimeWindowOpen && (
          <RoomContext
            value={{
              ws,
            }}
          >
            <RealtimeProvider>
              <RealtimeWindow
                open={realtimeWindowOpen}
                onOpenChange={setRealtimeWindowOpen}
              />

              <AudioStream tracksToPull={tracksToPull} />
            </RealtimeProvider>
          </RoomContext>
        )}
      </div>
    </>
  );
};

export default Room;
