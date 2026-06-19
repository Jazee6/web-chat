# Call disconnect grace window

When a Participant's WebSocket closes, the room DO does **not** immediately drop them from the Call. It tombstones the
entry by `(userId, tabId)` for 10 seconds; if a fresh WS arrives within that window carrying the same `tabId`, the entry
is re-bound to the new WS and no `Joined`/`Left` is broadcast. Otherwise the entry is evicted on a `setTimeout` and
`Left` is broadcast.

This exists because `partytracks` heals the SFU PeerConnection on its own (it triggers a fresh session after ICE stays
disconnected for ≥7s with `retryWithBackoff`), so the only thing that turns a transient WS blip into audible audio loss
is the server's eager `realtimeStatus` broadcast — peers re-derive `tracksToPull` from it, unmount the `<AudioTrack>`,
and stop pulling. Holding the entry across the WS reconnect keeps audio flowing transparently.

## Stolen tombstones

The grace window is keyed by `tabId`, so it only rebinds when the **same tab** reconnects. A second tab joining for the
same user still triggers "later tab kicks earlier": its `realtimeJoin` evicts the tombstoned entry and takes the Call.
The wrinkle is what happens to the **original** tab when it reconnects after its tombstone was taken.

If the original tab's reconnect were treated as a fresh join, the later-tab-kicks-earlier rule would make it steal the
Call right back from the tab the user is actively using — a flaky background tab would yank the Call away from the
foreground one on every reconnect. To avoid that, a tombstone evicted by a later tab is **marked `stolen` rather than
deleted**. The original tab's reconnect reads the stolen marker (via a `callStolen` flag on the new socket's attachment)
and its `realtimeJoin` **silently fails** — no `storeRealtime`, no broadcast. The reconnecting tab never re-enters the
Call; its kicked-tab watcher sees itself absent from `realtimeStatus` and exits after its grace. The active tab keeps
the Call uninterrupted.

This does **not** contradict the rejected "Reject the second tab's join" option above. That option rejected a **fresh**
tab's legitimate first join, which would let orphan tabs block real re-joins. Stolen-tombstone rejection targets a tab
whose entry was **already taken over** — a fundamentally different precondition. A fresh tab (no tombstone, or a
non-stolen one) still evicts and takes the Call as before, so a frozen-but-still-OPEN orphan background tab cannot block
a fresh foreground tab from joining.

The stolen marker self-cleans: when a tombstone is marked stolen, its grace timeout is re-armed to delete the marker
after the window. A reconnect past the window is indistinguishable from a fresh tab anyway (its tombstone is gone), so
the marker only needs to live the grace window.

## Considered options

- **Client re-`realtimeJoin` on WS open.** Simpler — no DO state machine. Rejected: the broadcast that tells peers "this
  user left" still fires on close, so audio actually cuts out and avatars flicker for the duration of the WS gap. The
  user-facing decision was "silently retain"; this option fails that.
- **`ctx.storage.setAlarm` instead of `setTimeout`.** Survives DO hibernation. Rejected: the window is 10s; the
  probability of hibernation inside that window is low, and the failure mode of a missed eviction (a ghost participant
  that no one can hear, who naturally times out at the SFU layer) is not data corruption. Worth ~30 lines of
  alarm-scheduling state, no.
- **Allow same userId in multiple tabs simultaneously.** Rejected: peers would pull two audio tracks and hear the user
  at 2× volume. `realtimeJoin` actively evicts any other entry (live or tombstoned) for the same `userId` — "later tab
  kicks earlier".
- **Reject the second tab's join.** Rejected: orphan tabs (frozen background, closed without `realtimeLeave`) would
  block legitimate re-joins from a fresh tab. Failure mode is worse than the chosen one.

## Wire impact

- WS URL grows a `tab_id` query param (client generates per-tab via `crypto.randomUUID()`, persisted in
  `sessionStorage`).
- `webSocketClose` no longer broadcasts `Left` synchronously when the closing socket holds a Call entry — peers see
  `Left` either after 10s or never (if the same `tabId` re-binds first).
- On rebind, the carried-over entry keeps its **old `audio.id`** as a transition value so peers don't briefly pull
  nothing. The reconnecting client's SFU session is fresh, so its `realtimeUpdate` arrives shortly after with the new
  `audio.id` and overwrites it.