# Changelog

## [1.8.0] - 2026-09-03

### Added

- Added Web Push notifications for room messages (`Room Message Notification`). Users can subscribe to specific
  rooms and receive browser system notifications for new user-authored messages. Self-authored messages, Room AI
  responses, and system messages are excluded.
- Added background notification fanout powered by Cloudflare Queues (ADR 0017). Accepted messages enqueue delivery
  tasks asynchronously without blocking chat latency, using batching to stay within Workers subrequest limits, a 5-minute
  message TTL, and automatic cleanup of stale push subscriptions (HTTP 404/410).
- Added intelligent notification suppression based on internal Room Visibility (ADR 0016): notifications are suppressed
  if the recipient has the room open and visible in any browser tab, without exposing or depending on public user status.
- Added PWA capabilities including web app manifest (`manifest.webmanifest`), Apple touch icon, PWA icons, and service
  worker registration (`sw.js`) for background push handling and notification click navigation.
- Added notification settings and push device management in user settings, enabling users to manage registered browser
  destinations, toggle notifications for the current device, and unbind inactive devices.
- Added room notification subscription controls in room settings.

### Upgrade notes

- Deployments must apply the new D1 migrations (`0005_parallel_ares.sql`) with `cd server && bun run db:push:d1`.
- Ensure Cloudflare Queues bindings (`ROOM_NOTIFICATIONS_QUEUE`) and VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`) are configured in Wrangler environment settings.

### Added

- Added a public marketing landing page at `/`, prerendered into the SPA shell at build time so
  search engines and AI answer engines receive full content without executing JavaScript. The
  page introduces the product and its edge-native stack (features, tech overview, FAQ, screenshot)
  with sign-in and GitHub CTAs. See ADR 0014.
- Added SEO/GEO assets: `robots.txt`, build-generated `sitemap.xml`, Open Graph/Twitter meta,
  JSON-LD structured data (`WebApplication`, `FAQPage`), and `llms.txt`/`llms-full.txt` for
  generative engines. Canonical and sitemap URLs are rewritten from the `SITE_URL` env var at
  build time when set.

### Changed

- Public Room Discovery moved from `/` to `/rooms`; the legacy `/room` path redirects there and
  `/room/:id` room links are unchanged. Signed-in visitors hitting `/` are bounced straight to
  the room catalogue - first by an inline cookie check in the built `index.html`, then by the
  landing route as fallback.

## [1.6.1] - 2026-08-16

### Changed

- A message in the Sending state now reveals a side spinner (`Loader2Icon`) next to
  it only after a 500ms debounce, so quickly-acknowledged messages never flash it.
  The prior `opacity-60` fade during Sending is removed; the 0–500ms blind window is
  accepted. Waiting for Connection keeps its `Clock3` with cancel affordance — the
  spinner is Sending-only, matching the two distinct states in `CONTEXT.md`.
- All per-message status icons (failed, waiting, rejected, retry-send) moved from
  `self-center` to `self-end` to align with the hover timestamp.

### Fixed

- Fixed a spinner flash on fast accepts: the spinner timer is armed only on entering
  Sending and is cleared on every transition and on unmount; the delayed reveal
  callback re-checks `sendState`, so a late fire after acceptance is a harmless no-op.

## [1.6.0] - 2026-08-12

### Added

- Added Room History Search for the complete retained text history of the current room, with a Command entry point,
  stable result snapshots, and context windows around older messages.
- Added explicit search index `Preparing` and `Search Unavailable` states. Existing rooms remain usable for chat while
  their search index is prepared in background batches, and an unavailable index can be rebuilt.
- Added Tab Visibility as a fourth User Status axis (`tab: "visible" | "hidden"`) sourced from the Page Visibility API.
  The avatar badge enlarges when a member's tab is visible, encoded as a separate visual dimension from device state.
  See ADR 0012.
- Added IME composition gating to the search dialog so typing pinyin no longer fires intermediate Latin-letter searches
  or consumes the search rate budget. See ADR 0013.

### Changed

- Room History Search now checks readiness before consuming the per-user search rate budget, and the search dialog no
  longer issues a redundant `status` probe before `search`. Only an action that runs the FTS query consumes the budget.
  See ADR 0013.
- Multi-tab members are now merged field-level rather than whole-object last-wins: Tab Visibility is `visible` if any
  session is visible, and `typing` is true if any session is typing.
- The Historical context bar moved into the room header, and the flash-to-message scroll now aligns to the top with a
  fixed scroll margin so the target is not hidden under the sticky header.

### Fixed

- Fixed compound-cursor pagination for ordinary room history, search results, and historical context so pages do not omit
  messages created in the same millisecond.
- Fixed `cmdk` selection styling (`data-selected` -> `data-[selected=true]`) so highlighted rows and shortcuts render
  correctly under the current cmdk data attribute scheme.

### Upgrade notes

- Under the existing design, the Room Durable Object SQLite migration is applied automatically when the room object wakes;
  no per-room manual migration is expected.
- Existing rooms can continue to chat during preparation, but their complete history search is not Ready until background
  batches finish. Search reports its preparation or unavailable state rather than returning partial results.
- This release requires no new manual migration for Cron or D1.
- The server-side readiness reorder is backward compatible: previously deployed clients that still probe `status` before
  `search` continue to work, since they already handle `rateLimited` on either call.

## [1.5.0] - 2026-08-10

### Added

- Added automatic expiration for public and unlisted rooms after 30 consecutive days without an accepted user-authored
  message. Room deletion is resumable and removes room data before image reclamation proceeds asynchronously.
- Added tracked image assets, references, and temporary reservations, with unreferenced source images reclaimed after a
  24-hour safety delay.
- Added room creation and settings notices explaining the 30-day inactivity policy.

### Changed

- Image submissions now reserve every referenced asset before message acceptance. Idempotent retries can recreate a
  missing asset from the page's local file without creating a duplicate message.

### Upgrade notes

- Existing deployments must apply the D1 migrations with `cd server && bun run db:push:d1` before deploying v1.5.0 and
  keep the configured hourly Cron trigger enabled.
- The first v1.5.0 maintenance runs backfill historical message image references and the R2 image asset inventory.
  Existing Sticker records continue to protect their images during this process.
- Physical image reclamation remains disabled until both backfills finish and an additional 24 hours have passed.
