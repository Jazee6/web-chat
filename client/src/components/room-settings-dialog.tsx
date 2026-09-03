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
import { registerCurrentBrowserPush } from "@/lib/push.ts";
import { api, showAlertDialog } from "@/lib/utils.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const RoomSettingsDialog = ({
  roomInfo,
  open,
  onOpenChange,
  isOwner,
}: {
  roomInfo: RoomInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwner: boolean;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [subscribing, setSubscribing] = useState(false);

  const refreshRoom = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room"] }),
      queryClient.invalidateQueries({ queryKey: ["publicRooms"] }),
      queryClient.invalidateQueries({ queryKey: ["roomInfo", roomInfo.id] }),
      queryClient.invalidateQueries({
        queryKey: ["notificationSubscriptions"],
      }),
    ]);
  };

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      await api.post(`room/${roomInfo.id}/subscription`);
    },
    onSuccess: async () => {
      await refreshRoom();
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`room/${roomInfo.id}/subscription`);
    },
    onSuccess: async () => {
      await refreshRoom();
      toast.success("Unsubscribed from room notifications");
    },
  });

  const onToggleSubscription = async (checked: boolean) => {
    if (!checked) {
      unsubscribeMutation.mutate();
      return;
    }

    setSubscribing(true);
    try {
      // Start saving the account preference before requesting permission, but
      // do not await the network: browsers require the permission prompt to
      // remain inside this user activation.
      const subscribe = subscribeMutation.mutateAsync();
      const registerPush = registerCurrentBrowserPush().catch((error) => {
        console.error(error);
        return {
          success: false,
          permissionDenied: undefined,
          unavailable: undefined,
        };
      });
      try {
        await subscribe;
      } catch (error) {
        await registerPush;
        throw error;
      }
      const pushResult = await registerPush;
      if (pushResult.permissionDenied) {
        toast.info(
          "Subscribed! Push permission was denied in this browser; notifications will still be sent to your other registered devices.",
        );
      } else if (pushResult.unavailable) {
        toast.info(
          "Subscribed! Push notifications are unavailable in this browser environment.",
        );
      } else if (pushResult.success) {
        toast.success("Subscribed to room notifications in this browser");
      } else {
        toast.warning(
          "Subscribed, but this browser could not be registered for push notifications.",
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to subscribe to room notifications");
    } finally {
      setSubscribing(false);
    }
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
        navigate("/rooms");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room settings</DialogTitle>
          <DialogDescription>
            <span className="block">{roomInfo.name}</span>
            <span className="mt-1 block">
              Every room with no successfully accepted user messages for 30
              consecutive days is permanently deleted, including its message
              history.
            </span>
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {/* Notifications: visible to ALL room members */}
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Room notifications</FieldTitle>
              <FieldDescription>
                Receive push notifications when you have no visible tabs showing
                this room on any device.
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={Boolean(roomInfo.isSubscribed)}
              disabled={
                subscribing ||
                subscribeMutation.isPending ||
                unsubscribeMutation.isPending
              }
              onCheckedChange={onToggleSubscription}
              aria-label="Room notifications"
            />
          </Field>

          {/* Owner-only room management */}
          {isOwner && (
            <>
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
                    Anyone can mention @AI. The latest 50 text messages and
                    speaker names are sent to Cloudflare Workers AI. When
                    available, AI may send a minimized search query to Exa. Web
                    Chat does not save queries or results in room history;
                    Cloudflare and Exa may retain data under their policies.
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
            </>
          )}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
};

export default RoomSettingsDialog;
