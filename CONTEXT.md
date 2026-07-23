# Web Chat

A real-time chat where users exchange text and images in shared rooms.

## Language

### Rooms

**Room Owner**:
The user who created a room and controls its room-level settings. A room has exactly one Room Owner.
_Avoid_: host, admin, room creator

**Public Room**:
A room eligible to appear in Public Room Discovery. Being public affects discoverability, not whether a user with its URL may enter it.
_Avoid_: listed room, open room

**Unlisted Room**:
A room omitted from Public Room Discovery but accessible to any signed-in user who has its URL. It does not imply member-only access.
_Avoid_: private room, secret room

**Public Room Discovery**:
The homepage catalogue through which users find Public Rooms. Regional restrictions may remove this catalogue without restricting direct room access or other chat features.
_Avoid_: public room access, room directory

**Mainland China Visitor**:
A user whose current network exit is identified as mainland China (`CN`). Hong Kong, Macao, Taiwan, and visitors whose region is unknown are not included.
_Avoid_: Chinese user, China-based user

**Room Activity**:
A successfully accepted, user-authored Chat Message that advances a room's latest activity time. A room with no such messages uses its creation time; Room AI messages, System Messages, visits, typing, favorites, and Call activity do not count.
_Avoid_: presence, online activity

**Room AI Availability**:
A room-level permission controlled by the Room Owner. When enabled, any user in the room may invoke the Room AI; when disabled, no user may invoke it.
_Avoid_: AI user permission, personal AI setting

### Messages

**Room AI**:
An automated room participant whose messages are always visibly attributed to AI. It speaks briefly and conversationally like a participant without presenting itself as a human user.
_Avoid_: bot user, virtual member, assistant

**Room AI Invocation**:
A text Chat Message containing the standalone, case-insensitive marker `@AI` while Room AI Availability is enabled. The marker may appear anywhere; one Chat Message causes at most one invocation.
_Avoid_: AI command, prompt

**Room AI Context**:
The triggering Room AI Invocation together with up to 49 preceding text Chat Messages, preserving their speaker identities. Image messages and older history are excluded.
_Avoid_: full history, conversation memory

**AI Typing**:
The transient, room-visible indication that the Room AI is processing one or more invocations. It remains visible until the active generation and its queue are empty; it is not a Room User's User Status.
_Avoid_: AI presence, AI user status

**System Message**:
A persistent, authorless notice in room history that records a room-level state change, such as Room AI Availability being enabled or disabled. It is not a Chat Message and does not count as Room Activity.
_Avoid_: bot message, announcement

**Chat Message**:
A single authored utterance in a room, identified by a server-generated id. A user may send text or images; the Room AI sends text only. Its author type explicitly distinguishes a user from the Room AI.
_Avoid_: post, entry

**Local Files**:
Image `File` objects held in client memory after the user has selected them but before they have been confirmed sent.
Surfaced via `UIChatMessage.localFiles`.
_Avoid_: attachments, drafts

**Reply**:
A Chat Message that explicitly references an earlier Chat Message as its antecedent. The antecedent is captured as
a snapshot at send time (author, type, and a content snippet), so the quote renders on every client even when the
antecedent has scrolled out of the local paginated history window. The reference is denormalized — an id-only lookup
would fail whenever the antecedent isn't in local state, which is the common case under 25-per-page pagination.
_Avoid_: quote (that is the rendered block, not the relationship), thread

**Quote**:
The rendered preview of a Reply's antecedent, shown above the Reply's own bubble. Distinct from the Reply relationship
itself: every Reply carries a Quote, and clicking the Quote jumps to the antecedent. For an image antecedent the Quote
is a `[图片]` text label, or `[图片] x N` for a multi-image antecedent — never the image itself.
_Avoid_: reply (the relationship), citation

### Image lifecycle states

These are three distinct states. Calling all of them "上传失败" causes confusion — pick the right one.

**Uploading**:
A local file is being converted to WebP and/or `PUT` to object storage. Per-file, not per-message. Rendered as a spinner
overlay on the thumbnail.

**Upload Failed**:
A local file did not reach object storage — either WebP conversion threw, or the `PUT` to the presigned URL errored.
Per-file. The rest of the batch may still succeed and be sent. Rendered as a warning overlay on the thumbnail.
_Avoid_: send failed (different concept — see below)

**Send Failed**:
The image bytes were uploaded successfully, but the WebSocket was not `OPEN` when the message was about to be
dispatched, so the recipient never received it. Per-message, not per-file. Implies the bytes exist in storage but no
peer knows about them.
_Avoid_: upload failed (different concept — see above)

### Stickers

**Sticker**:
An image a user has saved from a chat for quick reuse. Identified by the same storage key as its source image — the bytes live in object storage once and are
referenced, never re-uploaded on send. A Sticker is always sent as an image message; it is distinct from a Unicode emoji, which is plain text rendered
oversized.
_Avoid_: emoji (that is the Unicode text concept), 表情 (ambiguous between the two)

**Sticker Library**:
A user's personal collection of Stickers, shared across all their rooms. Per-user, not per-room. Surfaced via the sticker picker in the input area.
_Avoid_: favorites (overloaded — see Favorite), sticker pack

**Favorite** (overloaded — two senses, disambiguate by object):
(1) **Favorite Room** — a room a user has pinned to their favorites list.
(2) **Favorite Sticker** — the act of saving an image to the Sticker Library.
The same word names two unrelated actions on different objects; do not abbreviate to "favorite a …" without naming the object.
_Avoid_: bookmark, save (use the Sticker sense sparingly to avoid clashing with Favorite Room)

**Image Copy**:
Copying an image's bytes to the system clipboard from its context menu, for pasting into other apps. Per-image, keyed by the image's storage key.
Distinct from Favorite Sticker: a Sticker reuses the image _inside this app_ by referencing its storage key; an Image Copy takes the bytes _out_ of the app. The two coexist on the image context menu - they answer different intents. See ADR 0005.
_Avoid_: copy image (use the noun form to stay distinct from copying text)

### Call

**Call**:
A multi-party voice session within a room. At any moment a room has either zero or one Call. Users opt in and out
individually; the Call exists as long as at least one Participant remains.
_Avoid_: realtime (legacy code term — the wire protocol still uses `realtimeJoin`/`realtimeUpdate`/`realtimeLeave`, but
the user-facing concept is the Call)

**Call Participant**:
A user currently in the Call. Implies they hold a live SFU session pushing one audio track, and other Participants are
pulling that track. A Participant who briefly loses their WebSocket is **still a Participant** for a short grace
window — the audio doesn't stop and peers don't see them leave.
_Avoid_: realtime user, joined user

**Joined / Left**:
The two Participant lifecycle transitions visible to peers. `Joined` fires when a user first enters the Call. `Left`
fires either when they explicitly hang up, or when their WebSocket has been gone past the grace window. A WebSocket
reconnect inside the grace window is **not** a Left → Joined cycle; it's invisible to peers.
_Avoid_: connect/disconnect (WebSocket-level events, not Call-level)

### Presence

**User Status**:
A room member's transient, peer-visible state: activity (`active`/`idle`), screen (`locked`/`unlocked`), and whether they
are typing. Exists only while the member's session is live; not persisted, not part of message history. Distinct from the
Call's realtime status.
_Avoid_: presence, online state
