import { RoomCreateDialog } from "@/components/room-create-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useState } from "react";
import { useParams } from "react-router";

const Index = () => {
  const { id } = useParams() as { id?: string };
  const [roomCreateDialogOpen, setRoomCreateDialogOpen] = useState(false);

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
};

export default Index;
