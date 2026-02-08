import { RoomCreateDialog } from "@/components/room-create-dialog.tsx";
import Room from "@/components/room.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useDocPip } from "@/components/use-doc-pip.ts";
import { useSession } from "@/lib/auth-client.ts";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";

const Index = () => {
  const { id } = useParams() as { id?: string };
  const { data, isPending } = useSession();
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

  if (isPending || !data?.user) {
    return (
      <div className="flex justify-center items-center h-full gap-2">
        <Spinner />
        Loading...
      </div>
    );
  }

  return isActive && pipWindow ? (
    createPortal(
      <Room
        id={id}
        user={data.user}
        key={id}
        onTogglePip={onTogglePip}
        isPipActive
      />,
      pipWindow.document.body,
    )
  ) : (
    <Room id={id} user={data.user} key={id} onTogglePip={onTogglePip} />
  );
};

export default Index;
