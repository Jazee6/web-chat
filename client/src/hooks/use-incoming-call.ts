import { useUserInfo } from "@/hooks/use-user-info.ts";
import { playCallChime } from "@/lib/call-chime.ts";
import { useRoomContext } from "@/lib/context.ts";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Incoming-call toast + chime. When the Call gains a new Participant who
// isn't us, and we're not already in the Call ourselves, surface a toast with
// a Join action and play a short synthesized chime. Only participants who
// arrive *after* this tab mounted trigger it — the baseline at mount is
// recorded silently so an already-active Call doesn't greet you with a barrage
// of toasts.
export const useIncomingCall = () => {
  const { roomRealtime, uid, setRealtimeWindowOpen } = useRoomContext();
  const { users, fetchMissingUsers } = useUserInfo();
  // IDs we've already accounted for, so we only toast on *new* arrivals.
  const seenRef = useRef<Set<string>>(new Set());
  // Toast ids we've shown (matches the `incoming-call-${id}` form below), so
  // we can dismiss them the moment the user joins the Call themselves.
  const shownToastIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids = roomRealtime?.userIds ?? [];
    const idSet = new Set(ids);

    // Establish the baseline on the first server snapshot — don't toast for
    // participants who were already in the Call before we connected.
    if (seenRef.current.size === 0) {
      seenRef.current = idSet;
      return;
    }

    // Already in the Call — no point announcing others joining. Also dismiss
    // any outstanding incoming-call toasts: the user just entered, so leftover
    // "X started a Call" prompts are noise.
    if (idSet.has(uid)) {
      seenRef.current = idSet;
      if (shownToastIdsRef.current.size) {
        shownToastIdsRef.current.forEach((toastId) => toast.dismiss(toastId));
        shownToastIdsRef.current.clear();
      }
      return;
    }

    for (const id of ids) {
      if (id === uid) continue;
      if (seenRef.current.has(id)) continue;
      seenRef.current.add(id);

      const name = users[id]?.name ?? "Someone";
      fetchMissingUsers([id]);
      playCallChime();
      const toastId = `incoming-call-${id}`;
      shownToastIdsRef.current.add(toastId);
      toast(`${name} started a Call`, {
        id: toastId,
        duration: 12000,
        action: {
          label: "Join",
          onClick: () => setRealtimeWindowOpen(true),
        },
      });
    }

    // Drop ids that left so a rejoin re-triggers (a fresh toast is correct —
    // the Call state genuinely changed).
    seenRef.current = idSet;
  }, [roomRealtime, uid, users, fetchMissingUsers, setRealtimeWindowOpen]);
};
