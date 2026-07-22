import { PublicRoomList } from "@/components/public-room-list.tsx";
import { RoomCreateDialog } from "@/components/room-create-dialog.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { UserInfoProvider } from "@/components/user-info.tsx";
import { useDocPip } from "@/hooks/use-doc-pip.ts";
import { useSession } from "@/lib/auth-client.ts";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";

const Room = lazy(() => import("@/components/room.tsx"));

const Index = () => {
  const { id } = useParams() as { id?: string };
  const { data: session, isPending } = useSession();
  const [roomCreateDialogOpen, setRoomCreateDialogOpen] = useState(false);
  const [roomCreateDefaultType, setRoomCreateDefaultType] = useState<
    "public" | "unlisted"
  >("unlisted");
  const { openPip, isActive, pipWindow, closePip } = useDocPip();

  const openRoomCreateDialog = (type: "public" | "unlisted") => {
    setRoomCreateDefaultType(type);
    setRoomCreateDialogOpen(true);
  };

  if (!id) {
    return (
      <div className="h-full overflow-y-auto">
        <PublicRoomList
          onCreateRoom={() => openRoomCreateDialog("unlisted")}
          onCreatePublicRoom={() => openRoomCreateDialog("public")}
          enabled={!isPending && !!session?.user}
        />
        <RoomCreateDialog
          open={roomCreateDialogOpen}
          onOpenChange={setRoomCreateDialogOpen}
          defaultType={roomCreateDefaultType}
        />
      </div>
    );
  }

  if (isPending || !session?.user) {
    return (
      <div className="flex justify-center items-center h-full gap-2">
        <Spinner />
        Loading...
      </div>
    );
  }

  const onTogglePip = async () => {
    if (isActive) {
      closePip();
    } else {
      await openPip();
    }
  };

  if (isActive && pipWindow) {
    return createPortal(
      <UserInfoProvider>
        <Suspense fallback={<RoomLoading />}>
          <Room
            id={id}
            user={session.user}
            key={id}
            onTogglePip={onTogglePip}
            isPipActive
          />
        </Suspense>
      </UserInfoProvider>,
      pipWindow.document.body,
    );
  }

  return (
    <UserInfoProvider>
      <Suspense fallback={<RoomLoading />}>
        <Room id={id} user={session.user} key={id} onTogglePip={onTogglePip} />
      </Suspense>
    </UserInfoProvider>
  );
};

const RoomLoading = () => (
  <div className="flex h-full items-center justify-center gap-2">
    <Spinner />
    Loading...
  </div>
);

export default Index;
