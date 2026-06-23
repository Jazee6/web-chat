# Web Chat

A real-time chat where users exchange text and images in shared rooms.

## Language

### Messages

**Chat Message**:
A single utterance in a room — either text or a set of images. Identified by an id created on the client when the user
submits.
_Avoid_: post, entry

**Local Files**:
Image `File` objects held in client memory after the user has selected them but before they have been confirmed sent.
Surfaced via `UIChatMessage.localFiles`.
_Avoid_: attachments, drafts

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
