import type { RoomInfo } from "@/components/room-state-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, showAlertDialog } from "@/lib/utils.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const RoomSettingsDialog = ({
  roomInfo,
  open,
  onOpenChange,
}: {
  roomInfo: RoomInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const refreshRoom = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room"] }),
      queryClient.invalidateQueries({ queryKey: ["publicRooms"] }),
      queryClient.invalidateQueries({ queryKey: ["roomInfo", roomInfo.id] }),
    ]);
  };

  const visibility = useMutation({
    mutationFn: (type: "public" | "unlisted") =>
      api.patch(`room/${roomInfo.id}/visibility`, { json: { type } }),
    onSuccess: async (_, type) => {
      await refreshRoom();
      toast.success(
        type === "public" ? "Room is now public" : "Room is now unlisted",
      );
    },
  });

  const ai = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch(`room/${roomInfo.id}/ai`, { json: { enabled } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["roomInfo", roomInfo.id],
      });
    },
  });

  const updateVisibility = (isPublic: boolean) => {
    if (!isPublic) {
      visibility.mutate("unlisted");
      return;
    }
    showAlertDialog({
      title: "Make this room public?",
      description:
        "Anyone signed in will be able to find this room, enter it, and read its existing message history.",
      confirmText: "Make public",
      onConfirmAction: () => visibility.mutateAsync("public"),
    });
  };

  const deleteRoom = () => {
    showAlertDialog({
      title: "Delete Room",
      description:
        "Are you sure you want to delete this room? This action cannot be undone.",
      confirmText: "Delete",
      onConfirmAction: async () => {
        await api.delete(`room/${roomInfo.id}`);
        toast.success("Room deleted successfully");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["room"] }),
          queryClient.invalidateQueries({ queryKey: ["publicRooms"] }),
        ]);
        navigate("/");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room settings</DialogTitle>
          <DialogDescription>{roomInfo.name}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Public room</FieldTitle>
              <FieldDescription>
                Show this room in public room discovery.
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={roomInfo.type === "public"}
              disabled={visibility.isPending}
              onCheckedChange={updateVisibility}
              aria-label="Public room"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Room AI</FieldTitle>
              <FieldDescription>
                Anyone can mention @AI. The latest 50 text messages and speaker
                names are sent to OpenRouter with each invocation.
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={roomInfo.aiEnabled}
              disabled={ai.isPending}
              onCheckedChange={(enabled) => ai.mutate(enabled)}
              aria-label="Room AI"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Delete room</FieldTitle>
              <FieldDescription>
                Permanently delete this room and its message history.
              </FieldDescription>
            </FieldContent>
            <Button variant="destructive" onClick={deleteRoom}>
              Delete
            </Button>
          </Field>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
};

export default RoomSettingsDialog;
