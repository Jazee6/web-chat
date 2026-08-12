# Changelog

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
