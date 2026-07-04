# Sticker send reuses the image message channel via a key-only fast path

A Sticker's source image already lives in object storage, keyed by its sha256. When a user sends a Sticker from the
picker, we send a `type: "image"` WebSocket message whose `content` is the existing key — no WebP conversion, no
presigned PUT, no re-upload. The optimistic local entry is added directly (as with `sendText`), since there is no
upload to await.

The alternative — fetching the Sticker image back to a `File` and re-running `sendImages` — would re-derive the same
sha256, hit the storage dedup, and produce the identical key, but at the cost of a redundant WebP conversion, a
flash of the upload spinner, and extra latency on what should be an instant tap. Not worth the single-code-path
simplicity, especially since `sendImages`'s `localFiles` overlay assumes a fresh upload in flight.
