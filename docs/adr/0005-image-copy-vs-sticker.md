# Per-image Copy coexists with Sticker favorite on the image context menu

The image context menu offers both **Copy** (writes the image's WebP bytes to the system clipboard via
`navigator.clipboard.write([ClipboardItem])`) and **Save to stickers** (favorites the image's storage key into the
user's Sticker Library). This reverses an earlier decision that removed per-image Copy in favor of Sticker favorite as
the single "reuse this image" affordance.

## Why both

They answer different intents that the Sticker path alone cannot cover:

- **Sticker favorite** is in-app reuse: the bytes already live in object storage keyed by sha256, and sending a Sticker
  reuses that key without re-uploading (ADR 0004). It only helps you send the image *back into a Web Chat room*.
- **Image Copy** takes the bytes *out* of the app - pasting into a drawing tool, another chat app, a document, etc.
  The Sticker mechanism cannot do this; a storage key is meaningless outside Web Chat, and re-fetching the image just
  to drop it into an `<img>` is exactly what `clipboard.write` exists to avoid.

The earlier removal conflated "reuse the image" into a single Sticker affordance, which left external reuse with no
path. Keeping both on the same menu is the cheapest fix: each is one menu item, and the two are visually distinct
(Copy / Save to stickers) so users pick the one matching their intent.

## Implementation

`copyImage(storageKey)` fetches `room/images/{key}` via the shared `api` ky instance (which carries `credentials:
"include"`, so cookie-authed image fetches work), reads the response as a blob, and writes it as a single
`ClipboardItem` keyed by the blob's own MIME type (the server stores WebP; animated originals - GIF/PNG - are
passed through unchanged by `convertImageToWebP`, so their original type is preserved here too). Silent on failure,
matching the text `copyMessage` behavior (Q2: no toast).

Only images with a `storageKey` get the menu - local/uploading/failed files (no key) are not wrapped by
`ImageWithFavorite` and thus have no Copy or Reply affordance, same as before.

## Considered options

- **Copy as a Sticker reference (storage key to clipboard).** Rejected: a storage key is opaque outside Web Chat and
  duplicates the Sticker-send fast path with a worse UX (paste does nothing useful).
- **Copy the image URL (direct link).** Rejected: exposes the internal storage path and bypasses the Sticker model
  without adding real value - a URL is not pasteable as an image into other apps.
- **canvas redraw + `toBlob`.** Avoids CORS by working off the already-loaded `<img>`, but re-encodes (quality loss)
  and needs the image to be fully loaded. `fetch` of the same-origin, cookie-authed endpoint is simpler and copies
  the original bytes verbatim.

## Wire impact

None. This is client-only; `room/images/{key}` already exists and is cookie-authed. No share-package or server
changes.
