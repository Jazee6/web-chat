# Changelog

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
