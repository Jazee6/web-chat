# Reply stores an id + denormalized snapshot, not an id-only reference

A Chat Message that is a Reply carries `replyTo: { id, userId, type, snippet }` — the antecedent's id *plus* a
snapshot of its author, type, and a content snippet, captured at send time and persisted on the message. We
deliberately denormalize rather than store only the antecedent's id and look it up at render time.

## Why

History is paginated 25 messages per `loadHistory`. A reply's antecedent is frequently **absent from the local
`chats` array** — it has scrolled out of view, or the client joined after it was sent and only loaded the most
recent page. An id-only reference would force every client to render an empty / "loading…" Quote, or to
reverse-paginate backwards until the antecedent is found — expensive and fiddly with the current `before:
createdAt` cursor. The snapshot makes the Quote renderable on every client, in every state, with zero extra
round-trips — the same trade Telegram, WhatsApp, and Signal make.

The usual cost of denormalization — drift when the source is edited or deleted — does not apply here: this app
has no edit or delete, so the snapshot can never go stale. The antecedent may later be absent from history
entirely (it ages out of retention, the room is fresh, etc.); in that case the Quote still shows a faithful
ghost of what was replied to, which is the *desired* behavior, not a bug.

## Shape

`replyTo?: { id: string; userId: string; type: "text" | "image"; snippet: string }` on `ChatMessage`.

- `id` is for click-Quote-to-jump — best-effort: scrolls to and highlights the antecedent only when it is
  currently rendered in the list; it does **not** reverse-paginate to find a non-local antecedent.
- `snippet`: a text message → its content truncated to ≤100 chars; an image message → the literal `[图片]` label,
  or `[图片] x N` for a multi-image antecedent (image `content` is a JSON id-array with no usable text).
- Persisted as a single `text({ mode: "json" })` column on `messageTable` (Durable Object SQLite): drizzle
  parses/stringifies it, and the server treats it as an opaque snapshot it never reads into.

## Wire impact

- `ClientMessage.send.data` gains optional `replyTo`; `ServerMessage.message`/`history`/`initHistory` carry it
  through the existing `ChatMessage` shape.
- `clientMessageSchema`'s `send` variant validates it.
- The room DO `case "send"` persists `replyTo`; `initHistory` / `loadHistory` return it; the `message`
  broadcast carries it. A Drizzle migration adds the `replyTo` column.
- Backward compatible: `replyTo` is optional; old messages and old clients are unaffected.

## Considered options

- **id-only reference (`replyTo: string`).** Fully normalized, smaller payload. Rejected: the antecedent is
  usually not in local state under pagination, so the Quote cannot render without a lookup the client cannot
  perform. This is the fork that drove the whole decision.
- **Hybrid: id + snapshot, render-time prefer local.** Store both, but when the antecedent happens to be in
  local `chats`, render the fuller local version; otherwise fall back to the snapshot. Rejected: with no
  edit/delete there is nothing "fresher" to prefer — the snapshot *is* the source of truth — so the extra lookup
  branch buys nothing but complexity.
