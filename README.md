# Web Chat

English ｜ [中文](./README.zh.md)

A Telegram-style chat app that runs entirely on the Cloudflare developer platform and is designed to fit the Workers Free plan.

![Web Chat](./docs/screenshot.png)

Example: https://chat.jaze.top

## Features

- Private chats and groups (up to 20 members): replies, edits, recall, reactions, pins, forwarding, mentions, read receipts, typing and online status
- Secret chats with end-to-end encryption (MLS), across multiple devices, including encrypted media
- Photos, videos (transcoded in the browser), files, voice messages, stickers and link previews
- One-to-one voice and video calls with screen sharing (P2P + TURN), and group calls (Realtime SFU)
- Local-first: messages live in SQLite (WASM, OPFS) in the browser, work offline and sync across devices and tabs; full-text search runs on the device
- PWA: installable, Web Push notifications, share target, picture-in-picture chat
- Contacts, blocking, invite links, device management
- Sign in with your own OpenID Connect provider

## Architecture

- One Worker serves the static web app, the API (Hono + better-auth) and the WebSocket
- Durable Objects with SQLite: one `UserDO` per user (dialogs, devices, connections) and one `ChatDO` per chat (message log, members)
- D1 holds better-auth's users, sessions and accounts
- R2 stores media; uploads use presigned URLs and reads go straight to the bucket's custom domain, without invoking the Worker
- Web: React 19, TanStack Router, shadcn/ui, Vite; a sync worker in the leader tab owns the local database and the connection

## Deployment

### Prerequisites

- A Cloudflare account with a domain (zone) on it
- An OpenID Connect provider that you can register a client with
- [Bun](https://bun.sh)

### 1. Configure

Values tied to a deployment are written in the code. Change them for your own domain:

| File | What |
| --- | --- |
| `server/wrangler.jsonc` | `routes` (app domain), `vars` (see [Environment variables](#environment-variables)), `d1_databases[0].database_id` |
| `web/src/features/media/origin.ts` | `MEDIA_ORIGIN`: the R2 bucket's custom domain |
| `server/src/push/notify.ts` | `PUSH_SUBJECT`: the VAPID contact URL |
| `shared/src/protocol/index.ts` | `VAPID_PUBLIC_KEY`: must pair with the `VAPID_PRIVATE_KEY` secret |

Generate a VAPID key pair with `bunx web-push generate-vapid-keys`.

### 2. D1

```sh
cd server
bunx wrangler login
bunx wrangler d1 create web-chat-directory     # put the database_id into wrangler.jsonc
bunx wrangler d1 migrations apply web-chat-directory --remote
```

### 3. Identity provider

Register a client with your provider:

| Setting | Value |
| --- | --- |
| Redirect URI | `https://<app domain>/api/auth/callback/idp` |
| Post-logout redirect URI | `https://<app domain>/` |
| Client authentication | `client_secret_basic` |
| Scopes | `openid profile email` (PKCE is on) |

### 4. R2

Create a bucket (`web-chat` by default, set by `R2_BUCKET` and `r2_buckets` in `wrangler.jsonc`), then in its settings:

- **Custom domain**: connect one (for example `r2.<app domain>`) and make it the `MEDIA_ORIGIN` above. Media is publicly readable by unguessable URLs.
- **CORS**: allow `GET` and `PUT` from `https://<app domain>` (and `http://localhost:5173` for development), with the headers `content-type`, `content-disposition` and `cache-control`.
- **Lifecycle rules**: delete objects under `p/` after 7 days (uploads that were never sent), delete objects under `dev/` after 30 days if you share the bucket with development, and abort incomplete multipart uploads after 1 day.
- **API token**: R2 → Manage API tokens, create one with Object Read & Write on this bucket. It signs uploads.

### 5. Deploy

From the repository root:

```sh
bun install
bun run deploy
```

The first deploy creates the DNS record and certificate for the app domain. Remove any existing DNS record for that name first. `workers.dev` and preview URLs are turned off.

### 6. Secrets

```sh
cd server
bunx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
bunx wrangler secret put OAUTH_CLIENT_SECRET
bunx wrangler secret put R2_ACCESS_KEY_ID
bunx wrangler secret put R2_SECRET_ACCESS_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
bunx wrangler secret put TURN_KEY_ID            # optional, see below
bunx wrangler secret put TURN_KEY_API_TOKEN
bunx wrangler secret put SFU_KEY_ID
bunx wrangler secret put SFU_KEY_API_TOKEN
```

Each secret takes effect immediately.

### Environment variables

| Name | Type | Description | Required |
| --- | --- | --- | --- |
| BETTER_AUTH_URL | var | The app's public URL | ✅ |
| OAUTH_DISCOVERY_URL | var | The provider's `/.well-known/openid-configuration` | ✅ |
| OAUTH_CLIENT_ID | var | Client ID registered with the provider | ✅ |
| R2_ACCOUNT_ID | var | Cloudflare account ID (for the R2 S3 endpoint) | ✅ |
| R2_BUCKET | var | Media bucket name | ✅ |
| MEDIA_KEY_PREFIX | var | Object key prefix: empty in production, `dev/` in development | |
| BETTER_AUTH_SECRET | secret | Cookie signing key, at least 32 random bytes | ✅ |
| OAUTH_CLIENT_SECRET | secret | Client secret | ✅ |
| R2_ACCESS_KEY_ID | secret | R2 API token access key ID | ✅ |
| R2_SECRET_ACCESS_KEY | secret | R2 API token secret | ✅ |
| VAPID_PRIVATE_KEY | secret | Web Push private key (base64url, 32 bytes) | ✅ |
| TURN_KEY_ID | secret | Realtime TURN key ID | For calls |
| TURN_KEY_API_TOKEN | secret | Realtime TURN key API token | For calls |
| SFU_KEY_ID | secret | Realtime SFU app ID | For group calls |
| SFU_KEY_API_TOKEN | secret | Realtime SFU app secret | For group calls |

#### TURN_KEY_ID / SFU_KEY_ID

- Create them in the dashboard under Realtime → TURN and Realtime → SFU
- Without TURN, calls only use STUN and fail between networks that cannot connect directly. Without the SFU, group calls are unavailable.

### Upgrading

Data only migrates forward, and clients on an old version reload themselves:

- **D1**: when better-auth's schema changes, generate a migration with `bun run --cwd server gen-auth-schema > server/migrations/000N_<name>.sql` and apply it with `--remote` before deploying.
- **Durable Objects** and the **local database**: append a step to `MIGRATIONS` in `server/src/user-do.ts`, `server/src/chat-do.ts` or `web/src/sync/store.ts`. Never edit existing steps.
- **Protocol**: bump `PROTOCOL_VERSION` in `shared` when messages change incompatibly.

> **Note:** A release that changes a schema cannot be rolled back. Objects that the new version has touched are newer than the old code, which refuses to open them. Fix forward instead.

## Development

```sh
bun install
cp server/.dev.vars.example server/.dev.vars    # fill in the secrets
bun run --cwd web db:migrate
bun run dev                                     # http://localhost:5173
bun run test
```

`server/wrangler.jsonc` holds the production values; `server/.dev.vars` overrides them locally. Development uses the real R2 bucket under the `dev/` prefix.

## Sponsor

[Click Me](https://jaze.top/sponsor)
