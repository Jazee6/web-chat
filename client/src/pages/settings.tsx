import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import useSettings from "@/hooks/use-settings.ts";
import {
  getCurrentPushDestinationId,
  getCurrentPushSubscription,
  isIOS,
  isPushSupported,
  isStandalone,
  registerCurrentBrowserPush,
  unregisterCurrentBrowserPush,
} from "@/lib/push.ts";
import { api } from "@/lib/utils.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Laptop, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { PushDestinationInfo, RoomSubscription } from "web-chat-share";

const Settings = () => {
  const [settings, setSettings] = useSettings();
  const queryClient = useQueryClient();
  const [isRegisteringDevice, setIsRegisteringDevice] = useState(false);

  const {
    data: currentDestinationId = null,
    refetch: checkCurrentSubscription,
  } = useQuery({
    queryKey: ["currentPushDestination"],
    queryFn: async () => {
      const subscription = await getCurrentPushSubscription();
      return getCurrentPushDestinationId(subscription);
    },
  });

  const setNewSettings = (newSettings: Partial<typeof settings>) => {
    setSettings({
      ...settings,
      ...newSettings,
    });
  };

  // Push destinations query
  const { data: destinations = [] } = useQuery({
    queryKey: ["pushDestinations"],
    queryFn: () =>
      api.get("notification/destinations").json<PushDestinationInfo[]>(),
  });

  // Room subscriptions query
  const { data: subscriptions = [] } = useQuery({
    queryKey: ["notificationSubscriptions"],
    queryFn: () =>
      api.get("notification/subscriptions").json<RoomSubscription[]>(),
  });

  const revokeDestinationMutation = useMutation({
    mutationFn: async (id: string) => {
      if (id === currentDestinationId) {
        await unregisterCurrentBrowserPush();
        return;
      }
      await api.delete(`notification/destinations/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pushDestinations"] });
      await checkCurrentSubscription();
      toast.success("Browser removed");
    },
    onError: () => {
      toast.error("Failed to revoke device destination");
    },
  });

  const unsubscribeRoomMutation = useMutation({
    mutationFn: (roomId: string) =>
      api.delete(`notification/subscriptions/${roomId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notificationSubscriptions"],
      });
      await queryClient.invalidateQueries({ queryKey: ["roomInfo"] });
      toast.success("Unsubscribed from room");
    },
    onError: () => {
      toast.error("Failed to unsubscribe from room");
    },
  });

  const onToggleCurrentDevice = async (checked: boolean) => {
    setIsRegisteringDevice(true);
    try {
      if (checked) {
        const result = await registerCurrentBrowserPush();
        if (result.permissionDenied) {
          toast.error("Notification permission denied in this browser.");
        } else if (result.unavailable) {
          toast.warning("Push notifications are unavailable in this browser.");
        } else if (result.success) {
          toast.success("Push notifications enabled in this browser");
        }
      } else {
        await unregisterCurrentBrowserPush();
        toast.success("Push notifications disabled in this browser");
      }
      await checkCurrentSubscription();
      await queryClient.invalidateQueries({ queryKey: ["pushDestinations"] });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update push status");
    } finally {
      setIsRegisteringDevice(false);
    }
  };

  const showIosInstallNotice = isIOS() && !isStandalone();
  const pushSupported = isPushSupported();

  return (
    <div className="max-w-3xl w-full mx-auto pt-16 pb-24 px-4 space-y-12">
      {/* Presence & Privacy Settings */}
      <FieldSet>
        <FieldLegend>Presence</FieldLegend>
        <FieldDescription>
          Control how your activity is displayed to other members in rooms.
        </FieldDescription>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="status">Show my status</FieldLabel>
            <FieldDescription>
              When enabled, room members will be able to see your status.
            </FieldDescription>
            <Switch
              id="status"
              checked={settings?.showStatus}
              disabled={!("IdleDetector" in window)}
              onCheckedChange={async (checked) => {
                if (checked) {
                  const permission =
                    await window.IdleDetector.requestPermission();
                  if (permission === "denied") {
                    toast.warning("Idle Detection permission denied.");
                    return;
                  }
                }

                setNewSettings({
                  showStatus: checked,
                });
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="typing">Show typing indicator</FieldLabel>
            <FieldDescription>
              When enabled, room members will see a typing indicator while you
              type. Receiving others' indicator is unaffected by this setting.
            </FieldDescription>
            <Switch
              id="typing"
              checked={settings?.showTyping ?? true}
              onCheckedChange={(checked) => {
                setNewSettings({
                  showTyping: checked,
                });
              }}
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <Separator />

      {/* Notifications & Push Destinations */}
      <FieldSet>
        <FieldLegend>Push Notifications</FieldLegend>
        <FieldDescription>
          Receive Web Push alerts for new messages in subscribed rooms when you
          do not have them open on any device.
        </FieldDescription>

        {showIosInstallNotice && (
          <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 p-4 text-sm text-sky-200">
            <p className="font-medium">iOS / iPadOS Web Push Installation</p>
            <p className="mt-1 text-xs text-sky-300/80 leading-relaxed">
              To receive push notifications on iPhone or iPad, add Web Chat to
              your Home Screen: tap the Share button in Safari and select
              &quot;Add to Home Screen&quot;, then launch Web Chat from your
              Home Screen.
            </p>
          </div>
        )}

        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Enable notifications in this browser</FieldTitle>
              <FieldDescription>
                {!pushSupported
                  ? "Web Push is not supported in this browser."
                  : currentDestinationId
                    ? "This browser is registered to receive push notifications."
                    : "Authorize this browser to receive notifications for subscribed rooms."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="device-push"
              checked={currentDestinationId !== null}
              disabled={!pushSupported || isRegisteringDevice}
              onCheckedChange={onToggleCurrentDevice}
              aria-label="Enable notifications in this browser"
            />
          </Field>
        </FieldGroup>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              Registered browsers ({destinations.length}/5)
            </h4>
          </div>

          {destinations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No browsers registered. Enable notifications above to register
              this one.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border text-sm">
              {destinations.map((dest) => {
                const isCurrent = currentDestinationId === dest.id;

                return (
                  <div
                    key={dest.id}
                    className="flex items-center justify-between p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Laptop className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {dest.deviceLabel}
                          </span>
                          {isCurrent && (
                            <Badge variant="secondary" className="text-[10px]">
                              This browser
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Added: {new Date(dest.createdAt).toLocaleDateString()}{" "}
                          · Last active:{" "}
                          {new Date(dest.lastUsedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => revokeDestinationMutation.mutate(dest.id)}
                      disabled={revokeDestinationMutation.isPending}
                      title="Remove browser"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                      <span className="sr-only">Revoke</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FieldSet>

      <Separator />

      {/* Subscribed Rooms */}
      <FieldSet>
        <FieldLegend>Subscribed Rooms</FieldLegend>
        <FieldDescription>
          Rooms for which you receive message notifications when you are not
          viewing them.
        </FieldDescription>

        {subscriptions.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">
            You have not subscribed to notifications for any rooms. Open Room
            Settings in any room to subscribe.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-md border text-sm">
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between p-3"
              >
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <Link
                      to={`/room/${sub.roomId}`}
                      className="font-medium hover:underline text-foreground"
                    >
                      {sub.roomName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      Subscribed on{" "}
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => unsubscribeRoomMutation.mutate(sub.roomId)}
                  disabled={unsubscribeRoomMutation.isPending}
                >
                  Unsubscribe
                </Button>
              </div>
            ))}
          </div>
        )}
      </FieldSet>
    </div>
  );
};

export default Settings;
