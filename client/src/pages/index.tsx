import { RoomCreateDialog } from "@/components/room-create-dialog.tsx";
import Room from "@/components/room.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { UserInfoProvider } from "@/components/user-info.tsx";
import { useDocPip } from "@/hooks/use-doc-pip.ts";
import { useSession } from "@/lib/auth-client.ts";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";

const Index = () => {
  const { id } = useParams() as { id?: string };
  const { data: session, isPending } = useSession();
  const [roomCreateDialogOpen, setRoomCreateDialogOpen] = useState(false);
  const { openPip, isActive, pipWindow, closePip } = useDocPip();

  if (!id) {
    return (
      <div className="flex justify-center items-center h-full">
        <Button onClick={() => setRoomCreateDialogOpen(true)}>
          Create Room
        </Button>

        <RoomCreateDialog
          open={roomCreateDialogOpen}
          onOpenChange={setRoomCreateDialogOpen}
        />
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

  if (isPending || !session?.user) {
    return (
      <div className="flex justify-center items-center h-full gap-2">
        <Spinner />
        Loading...
      </div>
    );
  }

  if (isActive && pipWindow) {
    return createPortal(
      <UserInfoProvider>
        <Room
          id={id}
          user={session.user}
          key={id}
          onTogglePip={onTogglePip}
          isPipActive
        />
      </UserInfoProvider>,
      pipWindow.document.body,
    );
  }

  return (
    <UserInfoProvider>
      <Room id={id} user={session.user} key={id} onTogglePip={onTogglePip} />
    </UserInfoProvider>
  );
};

export default Index;
