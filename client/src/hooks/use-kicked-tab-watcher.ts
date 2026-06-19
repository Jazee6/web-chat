import { useRoomContext } from "@/lib/context.ts";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Self-exit watcher for "kicked" tabs. When the same user joins the Call in
// another tab, the server's later-tab-kicks-earlier rule evicts this tab's
// Participant immediately — our own entry vanishes from realtimeStatus even
// though our Call window and peer connection are still live. Left unhandled,
// the user keeps speaking into a dead mic with no feedback. This watcher
// closes the Call window and toasts an explanation.
//
// State machine:
//   mounting → (own entry appears) joined → (own entry vanishes) kicked
// A 5s mount timeout covers a join that never confirms. A short grace before
// the kick exit avoids a false positive during a WebSocket reconnect, where
// the server briefly evicts then re-adds our entry as realtimeJoin re-fires.
const MOUNT_TIMEOUT_MS = 5_000;
const KICK_GRACE_MS = 3_000;

export const useKickedTabWatcher = () => {
  const { realtimeStatus, uid, setRealtimeWindowOpen } = useRoomContext();
  // null = haven't seen our own entry yet (still mounting); true = joined.
  const wasJoinedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const present = (realtimeStatus ?? []).some((s) => s.userId === uid);
    const wasJoined = wasJoinedRef.current;

    if (present) {
      wasJoinedRef.current = true;
      return;
    }

    // Our entry is absent.
    if (wasJoined === null) {
      // Still mounting — arm the mount timeout: if our entry never shows up,
      // the join didn't take. Re-arm on every snapshot while still mounting.
      const mountTimer = setTimeout(() => {
        if (wasJoinedRef.current === null) {
          setRealtimeWindowOpen(false);
          toast("Couldn't join the Call", { duration: 6000 });
        }
      }, MOUNT_TIMEOUT_MS);
      return () => clearTimeout(mountTimer);
    }

    // Was joined, now gone → likely kicked. Arm the kick grace; if our entry
    // doesn't reappear (reconnect re-join) within it, exit. This covers two
    // cases that look identical from here: (1) a normal WS reconnect where the
    // server briefly evicts then re-adds our entry as realtimeJoin re-fires —
    // our entry reappears inside the grace and we stay; (2) a stolen-tombstone
    // reconnect (same user joined in another tab and took our entry), where
    // the server silently fails our re-join and our entry never reappears —
    // the grace expires and we exit cleanly. See ADR 0001.
    const kickTimer = setTimeout(() => {
      setRealtimeWindowOpen(false);
      toast("Call opened in another tab", { duration: 6000 });
    }, KICK_GRACE_MS);
    return () => clearTimeout(kickTimer);
  }, [realtimeStatus, uid, setRealtimeWindowOpen]);
};
