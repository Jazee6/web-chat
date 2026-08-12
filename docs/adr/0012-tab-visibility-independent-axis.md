# Tab Visibility is an independent User Status axis, not a flavor of idle

User Status gains a fourth dimension, **Tab Visibility** (`tab: "visible" | "hidden"`), sourced from the Page Visibility
API (`document.visibilityState`). It is broadcast on the existing `userStatus` channel, gated by the same **Show My
Status** opt-in as activity and screen, and — like them — transient and unpersisted. Unlike them it needs no browser
permission, so the gate is a privacy choice, not a capability precondition.

The defining decision is that Tab Visibility is its **own axis**, orthogonal to `user` (`active`/`idle`, device-level via
IdleDetector) and `screen` (`locked`/`unlocked`). A member can be device-active while their tab is hidden (typing in
another tab) or device-idle while their tab is visible (staring without moving). Folding those into `idle` would erase
exactly the distinction peers want: "is this person looking at this room right now?"

## Why this shape

- **Fold tab-hidden into `idle`.** Rejected: it makes `idle` mean two things ("no device input" *or* "tab not visible")
  and peers can no longer tell "walked away" from "on another tab." The IdleDetector signal and the visibility signal are
  independent and worth seeing independently.
- **Extend the `user` enum with `"away"`.** Rejected: `away` and `idle` would be mutually exclusive enum values, so a
  device-idle user with a visible tab still loses one axis. A fourth field keeps the two signals composable.
- **Window focus (`document.hasFocus()` / `focus`|`blur`) instead of Page Visibility.** Rejected: window focus is far
  noisier — clicking the system tray, switching to another app window, or a transient steal-and-return focus all flip it.
  `visibilityState` flips only on tab switch / minimize, which matches "is this tab the one being looked at."
- **Always-on (no opt-in).** Rejected: Show My Status is the user's single intent to share presence. Silently adding a
  new always-on channel, just because visibility needs no permission, would bypass that intent. Consistency over
  capability.

## Multi-tab merge: any-visible wins

The server keys sessions by WebSocket (`room.ts` `sessions = new Map<WebSocket, WsSession>()`), so one member with the
room open in two tabs is two sessions, each carrying its own `tab` value. The broadcast `users` list therefore contains
two entries with the same `id`.

The client dedup at `use-room-chat.ts:177` is whole-object last-wins
(`[...new Map(data.users.map((u) => [u.id, u])).values()]`). That cannot express "any visible ⇒ visible." Implementing
this rule requires a **field-level merge** across same-`id` entries: `tab` is `visible` if any session is `visible`;
`typing` is `true` if any session is typing; `user`/`screen` take the value from the most-recently-active session (or a
defined precedence). The current last-wins line must become an explicit reducer. This is the one place the decision
forces non-trivial existing-code change.

## UI: size encodes tab, color encodes device

The avatar badge stays a single dot; the new axis is encoded in a **separate visual dimension** so orthogonality is
preserved on screen, not just in the data model:

- **Color** continues to encode device state with the existing priority: `locked` (grey) > `idle` (yellow) > default
  green (`room-state-dialog.tsx:89-95`, `chat-list.tsx:335-343`).
- **Size** encodes Tab Visibility: `visible` ⇒ `size-2` (8px); `hidden`, unknown, or not shared ⇒ the current
  `size-1.5!` (6px) default. No other signal is shown for hidden — the enlargement *is* the visible signal, so its
  absence reads as hidden/unknown.

This applies to both avatar surfaces (the chat-list message avatar and the room-state-dialog member list) since they use
the same `AvatarBadge` pattern.

## Wire impact

`userStatusSchema` (`share/zod/room.ts:186`) gains `tab: z.enum(["visible", "hidden"]).optional()`. The server's
`userStatus` handler already **merges** rather than replaces (`{...currentSession.status, ...clientMessage.data}`,
established by ADR 0002 for typing), so adding a field needs no handler change — only schema and type updates. The
client sends the current `visibilityState` on socket open (so peers see it before the first switch) and on every
`visibilitychange` while Show My Status is on, reusing the listener already wired at `use-room.ts:281-306` for
notifications and reconnection.

## Considered rendering alternatives

- **Same-dot priority color (locked > idle > tab-hidden > green).** Rejected: it collapses Tab Visibility back into the
  color dimension, reproducing the information loss we rejected for the data model.
- **Second indicator (ring or extra dot).** Rejected: avatar thumbnails are small and the badge already crowds them; a
  second indicator would have to be replicated at every avatar site and would read as visual clutter for a soft signal.
- **Member-list-only.** Rejected as the default: "this person may not have seen your message" is useful at the message
  surface, not only in a dialog the peer has to open. Size-on-visible puts it where the conversation is happening.
