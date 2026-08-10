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

**Deleting Room**:
A room whose Room Owner has requested irreversible deletion but whose cleanup is not yet complete. It cannot be entered and accepts no new Message Submissions; failed cleanup remains resumable until deletion completes.
_Avoid_: deleted room, inactive room, hidden room

**Room Deletion**:
The completed removal of a room's metadata, history, Favorite Room relationships, and Image References. Reclaiming an Unreferenced Image after its 24-hour safety delay is not part of Room Deletion completion.
_Avoid_: archive, hide room, image reclamation

**Room Expiration**:
The point when any Public Room or Unlisted Room reaches 30 consecutive days without Room Activity. At the next scheduled cleanup it enters Room Deletion without an additional recovery period.
_Avoid_: message expiry, archive, idle session

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
`@AI` is reserved for the Room AI, so a user whose full display name is `AI` cannot be referenced by a User Mention.
_Avoid_: AI command, prompt

**Room AI Context**:
The triggering Room AI Invocation together with up to 49 preceding text Chat Messages, preserving their speaker identities. Image messages and older history are excluded.
_Avoid_: full history, conversation memory

**Room AI Web Search**:
An optional external-information lookup available when the deployment enables it and Room AI Availability is enabled. The Room AI may use it at most once per invocation when current information, outside facts, or sources are needed; its use does not change the resulting message's normal Room AI attribution.
_Avoid_: search command, web mode, automatic search

**Transient AI Data**:
Data used for the current Room AI Invocation but not written by Web Chat to room history or its other business storage. External processing services may retain it under their own logging and retention policies.
_Avoid_: never stored, ephemeral data

**Web Search Query**:
The minimum external-search terms needed to answer a Room AI Invocation. It is Transient AI Data and may use the language best suited to the sought material or be derived from Room AI Context to resolve references, but excludes participant names, unrelated conversation, and sensitive information; if those cannot be excluded, no search occurs.
_Avoid_: prompt, chat history, context dump

**Web Search Evidence**:
Untrusted content returned by Room AI Web Search and used only as factual support for the current invocation. It is Transient AI Data; medical, legal, and financial responses require authoritative evidence.
_Avoid_: instructions, persisted sources, verified truth

**Web Search Failure Response**:
A room-visible Room AI Chat Message stating that reliable search results could not be obtained or that Web Search is unavailable, and suggesting a later retry when appropriate. It replaces neither missing results with model knowledge nor the Chat Message with a caller-only error.
_Avoid_: unavailable error, silent fallback, guessed answer

**AI Typing**:
The transient, room-visible indication that the Room AI is processing one or more invocations, including any optional Web Search. It remains visible until the active generation and its queue are empty; it is not a Room User's User Status.
_Avoid_: AI presence, AI user status

**System Message**:
A persistent, authorless notice in room history that records a room-level state change, such as Room AI Availability being enabled or disabled. It is not a Chat Message and does not count as Room Activity.
_Avoid_: bot message, announcement

**Chat Message**:
A single authored utterance in a room, identified by a server-generated id. A user may send text or images; the Room AI sends text only. Its author type explicitly distinguishes a user from the Room AI.
_Avoid_: post, entry

**Room History Search**:
A search of all persistent text Chat Messages in the current room. It includes messages authored by users and the Room AI, but excludes System Messages and image content. After surrounding whitespace is removed, a query contains 3 to 100 Unicode code points and matches a continuous substring of a message's own text. ASCII English letters are compared without regard to case; all other characters are compared as written. Reply snapshots do not participate, and the search does not imply token, fuzzy, pinyin, semantic, width-normalized, accent-normalized, or traditional/simplified Chinese matching. Matches are presented newest first and may be opened in their conversation context. Searching and opening context do not count as Room Activity.
_Avoid_: global search, loaded-message search, Web Search, semantic search

**Room History Search Readiness**:
Whether a room's complete retained history is available to Room History Search. A room is Ready when that complete view is searchable, Preparing while the view is being built, and Search Unavailable after preparation or maintenance fails. A new empty room is Ready immediately. An existing room remains usable while its history is prepared, but search reports that it is preparing rather than returning incomplete matches. Newly accepted searchable messages are included when readiness is reached. A failure while preparing or maintaining search must not prevent Message Acceptance; search instead becomes unavailable, offers a retry, and may return to Preparing while its complete view of retained history is rebuilt.
_Avoid_: partial search, room availability, search results

**History Search Match**:
A persistent text Chat Message that satisfies a Room History Search query.
_Avoid_: search result (may mean its rendered presentation), context message

**History Search Snapshot**:
The stable set of History Search Matches eligible for one submitted query, bounded by the room history that exists when the query is submitted. Messages accepted later do not enter that snapshot; submitting a query again creates a new snapshot. Its query and results exist only in the current room page and are discarded on refresh or when leaving the room.
_Avoid_: live results, search cache

**History Search Context**:
A continuous window containing a History Search Match, up to 12 earlier and 12 later room-history items. It preserves the room's original history, including image Chat Messages and System Messages that cannot themselves be History Search Matches. It is opened from a search result so the user can understand the matching Chat Message in its original conversation.
_Avoid_: search result, filtered history

**Historical Context View**:
The room view displaying a History Search Context separately from the latest, live conversation. It preserves the user's search state, identifies the matching message, and provides a way back to the latest conversation without presenting discontinuous history as one continuous sequence.
_Avoid_: search results, live conversation, merged history

**Message Retention**:
An accepted Chat Message remains in room history for as long as its room exists; it has no independent expiry. Owner-requested Room Deletion or Room Expiration ends the retention of all its Chat Messages.
_Avoid_: message expiry, temporary history

**Message Submission**:
A user's request to add one authored utterance to room history, identified by a client-generated id that remains stable across retries. Repeating it by the same user in the same room must resolve to the same Chat Message.
_Avoid_: Chat Message (that is the accepted, persistent utterance), send attempt

**Message Acceptance**:
The server's confirmation that a Message Submission has become a persistent Chat Message, including its server-generated id. It is the boundary at which a user message is considered sent.
_Avoid_: delivery receipt (it does not confirm that another client rendered the message), WebSocket send

**Message Rejection**:
The server's definitive response that a Message Submission cannot become a Chat Message as submitted. Retrying the unchanged submission will not succeed; the user must change or discard it.
_Avoid_: Send Failed (that is an absence of acceptance and may be retried), error

**User Mention**:
A visible, standalone `@` reference matching a known user's full display name in a text Chat Message, whether typed or inserted through the user's message avatar. It is presentational only and does not notify the referenced user; a Room AI Invocation remains the distinct behavioral meaning of mentioning the Room AI.
_Avoid_: notification, alert, tag

**Local Files**:
Image files held by the sending page session after selection. They provide the Local Image Preview for that page session after Message Acceptance, but do not survive a refresh or move to another device.
_Avoid_: attachments, Persistent Images, drafts

**Local Image Preview**:
The sender-only presentation of a Local File for the lifetime of the sending page session. Message Acceptance updates the Chat Message's persistent identity without replacing this preview; a refreshed page or another device renders the Persistent Image instead.
_Avoid_: Persistent Image, upload preview

**Image Asset**:
Image bytes identified by their content hash and available for reuse by Message Images and Stickers. An Image Asset is retained while it has a business reference and becomes eligible for delayed reclamation after its last reference disappears.
_Avoid_: attachment, uploaded file, R2 object

**Persistent Image**:
An Image Asset referenced by an accepted image Chat Message. It is rendered when no Local Image Preview from the sending page session is available, such as after refresh or on another device.
_Avoid_: Local File, Local Image Preview, Image Asset

**Image Reference**:
A business relationship that keeps an Image Asset retained. Each Message Image and Sticker is a distinct Image Reference, even when several of them target the same Image Asset.
_Avoid_: storage key, copy, duplicate image

**Image Reservation**:
Temporary retention of an Image Asset for an image Message Submission before that submission receives Message Acceptance. It becomes an Image Reference when the message is accepted, or is released by reconciliation after the submission is confirmed absent.
_Avoid_: Image Reference, upload lease, pending message

**Unreferenced Image**:
An Image Asset with neither Image References nor Image Reservations, either because an upload was never submitted or because its last retention relationship was removed. It is reclaimed 24 hours after its last retention relationship disappears.
_Avoid_: deleted image, expired message, unused attachment

**Image Reclamation**:
Removal of an Unreferenced Image from source object storage after its safety delay. It reclaims storage but does not promise removal of copies already held by browser, intermediary, or CDN caches.
_Avoid_: access revocation, privacy deletion, cache purge

**Image Message Integrity**:
An image Message Submission can receive Message Acceptance only while every referenced Image Asset exists and is retained. A retry may transparently recreate a reclaimed Image Asset from its Local File while keeping the same submission id.
_Avoid_: best-effort image, broken image acceptance

**Message Image**:
One ordered image occurrence within an image Chat Message. Multiple Message Images may reference the same Persistent Image; their positions and order remain distinct even when their storage keys match.
_Avoid_: Persistent Image (that is the stored content), attachment

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

### Sending and image lifecycle states

These are distinct states. Calling all of them "上传失败" causes confusion — pick the right one.

**Waiting for Connection**:
A Message Submission retained while its room connection is unavailable. It will return to Sending once after the connection recovers; it has not yet become Send Failed.
_Avoid_: Sending, Send Failed, offline message

**Sending**:
A Message Submission is awaiting Message Acceptance. This state applies to every user-authored message type.
_Avoid_: uploading (that is the per-file image state), delivered

**Uploading**:
A local file is being converted to WebP and/or `PUT` to object storage. Per-file, not per-message. Rendered as a spinner
overlay on the thumbnail.

**Upload Failed**:
A local file did not reach object storage — either WebP conversion threw, or the `PUT` to the presigned URL errored.
Per-file. The rest of the batch may still succeed and be sent. Rendered as a warning overlay on the thumbnail.
_Avoid_: send failed (different concept — see below)

**Send Failed**:
A Message Submission has not obtained Message Acceptance and requires an idempotent retry. Per-message, not per-file,
and applies to every user-authored message type; it does not prove that the Chat Message is absent from room history or that the server rejected it.
_Avoid_: upload failed (different concept — see above)

**Rejected**:
A Message Submission has received Message Rejection and cannot succeed unchanged. It is terminal for that submission, unlike Send Failed.
_Avoid_: Send Failed, Upload Failed

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
