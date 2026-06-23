# Typing indicator has no timeout; cleared by disconnect

Typing presence rides on the existing `userStatus` broadcast rather than a dedicated message, and — unlike nearly every
other chat app — carries **no client-side or server-side timeout**. The indicator clears solely because a `typing:false`
arrives reliably while the WebSocket is OPEN, or because the sender's WebSocket dropped and their session was removed
from `roomStats`.

The standard pattern is a heartbeat (`typing:true` every few seconds) plus a server timeout (~7s of silence ⇒ clear). We
rejected it. This simpler approach is safe because of the asymmetry in [ADR 0001](./0001-call-disconnect-grace.md): the
disconnect grace window retains **Call** (`realtime`) entries so audio survives a transient WS blip, but it does **not**
retain chat/presence entries — `handleSocketDrop` runs `this.sessions.delete(ws)` + `this.broadcastRoomStats()`
immediately, even on the grace path. So a typing user who drops is evicted from presence on the spot, and their typing
disappears for peers without any timeout logic. The only remaining risk — WS still OPEN but the client frozen so it
never sends `typing:false` — is the exact failure mode the heartbeat option buys robustness against, and it was judged
too rare to justify the perpetual chatter and a server timer.

## Sender discipline

Edge-triggered, not per-keystroke. The first keypress after idle sends `typing:true`; each subsequent keypress resets a
2s debounce; when it fires (or on submit / blur / cleared input) a single `typing:false` is sent. A typing session is
therefore at most two `userStatus` broadcasts — it never storms the room.

## Partial status must merge, not replace

The server's `userStatus` handler previously did `status: clientMessage.data` — a full replace. That was safe while a
single client effect sent the complete `{user, screen}`. Typing adds a second, independent effect that sends a partial
`{typing}` (and the presence effect sends a partial `{user, screen}` omitting `typing`), so the handler now merges:
`{...currentSession.status, ...clientMessage.data}`. With the old replace, a `typing:true` would have clobbered
`user`/`screen` and blanked that user's avatar badge; conversely a presence update would have silently cleared someone
else's view of their typing.

## Considered options

- **Dedicated `typing` message + server timeout.** The conventional approach. Rejected: the heartbeat is perpetual
  chatter for a state that flips twice per session, and a server timeout is state the room DO must own and evict — all
  to cover the frozen-open-tab case, which is rare. The disconnect path already clears presence for free (see ADR 0001).
- **Client-side timeout on the receiver.** Each peer timestamps the last `typing:true` and clears locally after N
  seconds. Rejected: reintroduces the very timeout we're avoiding, and would briefly show a ghost typist whose
  `typing:false` was merely delayed, not absent. If we're trusting the ordered-Wire delivery, trust it fully.
- **Persist typing.** Rejected on sight: typing is the definition of ephemeral. Not in the DB, not in message history,
  not replayed on `loadHistory`.

## Wire impact

- `userStatus` handler changes from replace to merge (one line). Fully backward compatible — a full `{user, screen}`
  send now merges onto itself identically.
- Typing is never sent unless the local `showTyping` setting is on. The setting gates only the *broadcast* of one's own
  typing; receiving/seeing others' typing (like the avatar presence badge) is unaffected by the local toggle.
