# Web Chat

English ｜ [中文](./README.zh.md)

A Telegram-style chat app that runs entirely on the Cloudflare developer platform and is designed to fit the Workers Free plan.

![Web Chat](./docs/screenshot.png)

Example: https://chat.jaze.top

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Jazee6/web-chat)

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

- A Cloudflare account
- An OpenID Connect provider that you can register a client with
- A domain on Cloudflare (a zone) for the media bucket's custom domain
- [Bun](https://bun.sh)

The top level of `wrangler.jsonc` is a template for your own deployment: the Worker `web-chat-app` on `workers.dev`, with empty vars that you fill in after deploying. `env.production` holds the configuration of the example instance; `bun run deploy` and the button never use it.

### Option 1: Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Jazee6/web-chat)

Cloudflare copies this repository into your GitHub or GitLab account, creates the D1 database, the R2 bucket and the Durable Objects, runs the D1 migrations and deploys the app to `https://web-chat-app.<subdomain>.workers.dev`. Every push to the new repository deploys again.

The form asks for four secrets. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`. You can't have the OAuth client secret or the R2 token yet, so enter placeholders for them and replace them later. Then continue with [After deploying](#after-deploying).

### Option 2: Deploy manually

```sh
bun install
bunx wrangler login
bunx wrangler d1 create web-chat-app-directory
bunx wrangler r2 bucket create web-chat-app-media
bun run deploy                                  # applies D1 migrations, builds and deploys
```

Then continue with [After deploying](#after-deploying), and deploy again with `bun run deploy` after changing `wrangler.jsonc`.

### After deploying

#### 1. Identity provider

Register a client with your provider:

| Setting | Value |
| --- | --- |
| Redirect URI | `https://<app domain>/api/auth/callback/idp` |
| Post-logout redirect URI | `https://<app domain>/` |
| Client authentication | `client_secret_basic` |
| Scopes | `openid profile email` (PKCE is on) |

#### 2. R2

In the media bucket's settings (`web-chat-app-media` by default):

- **Custom domain**: connect one, for example `r2.<your domain>`. Media is publicly readable by unguessable URLs.
- **CORS**: allow `GET` and `PUT` from `https://<app domain>` (and `http://localhost:5173` for development), with the headers `content-type`, `content-disposition` and `cache-control`.
- **Lifecycle rules**: delete objects under `p/` after 7 days (uploads that were never sent), delete objects under `dev/` after 30 days if you share the bucket with development, and abort incomplete multipart uploads after 1 day.
- **API token**: R2 → Manage API tokens, create one with Object Read & Write on this bucket. It signs uploads.

#### 3. Configure

Fill in the top-level `vars` in `wrangler.jsonc` (see [Environment variables](#environment-variables)) and commit them, or run `bun run deploy` if you deployed manually. `MEDIA_ORIGIN` and `VAPID_PUBLIC_KEY` are read at build time, and every deploy replaces the vars set in the dashboard, so always edit `wrangler.jsonc`.

Optionally, generate a Web Push key pair with `bunx web-push generate-vapid-keys`: the public key goes into `VAPID_PUBLIC_KEY` and the private key into the `VAPID_PRIVATE_KEY` secret. Without it, notifications are off.

To use your own domain for the app instead of `workers.dev`, add `"routes": [{ "pattern": "<app domain>", "custom_domain": true }]` and set `"workers_dev": false`.

#### 4. Secrets

Replace the placeholders and add the optional secrets, either from the repository root or in the dashboard (Worker → Settings → Variables and Secrets):

```sh
bunx wrangler secret put OAUTH_CLIENT_SECRET
bunx wrangler secret put R2_ACCESS_KEY_ID
bunx wrangler secret put R2_SECRET_ACCESS_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY      # optional, for notifications
bunx wrangler secret put TURN_KEY_ID            # optional, see below
bunx wrangler secret put TURN_KEY_API_TOKEN
bunx wrangler secret put SFU_KEY_ID
bunx wrangler secret put SFU_KEY_API_TOKEN
```

Each secret takes effect immediately.

#### 5. Check

Open `https://<app domain>/api/auth/ok`. It returns `{"ok":true}` when everything required is set, and otherwise lists what is missing.

### Environment variables

| Name | Type | Description | Required |
| --- | --- | --- | --- |
| BETTER_AUTH_URL | var | The app's public URL | ✅ |
| OAUTH_DISCOVERY_URL | var | The provider's `/.well-known/openid-configuration` | ✅ |
| OAUTH_CLIENT_ID | var | Client ID registered with the provider | ✅ |
| R2_ACCOUNT_ID | var | Cloudflare account ID (for the R2 S3 endpoint) | ✅ |
| R2_BUCKET | var | Media bucket name, the same as `r2_buckets` | ✅ |
| MEDIA_ORIGIN | var | The media bucket's custom domain, read at build time | ✅ |
| MEDIA_KEY_PREFIX | var | Object key prefix: empty in production, `dev/` in development | |
| VAPID_PUBLIC_KEY | var | Web Push public key, read at build time | For notifications |
| BETTER_AUTH_SECRET | secret | Cookie signing key, at least 32 random bytes | ✅ |
| OAUTH_CLIENT_SECRET | secret | Client secret | ✅ |
| R2_ACCESS_KEY_ID | secret | R2 API token access key ID | ✅ |
| R2_SECRET_ACCESS_KEY | secret | R2 API token secret | ✅ |
| VAPID_PRIVATE_KEY | secret | Web Push private key (base64url, 32 bytes) | For notifications |
| TURN_KEY_ID | secret | Realtime TURN key ID | For calls |
| TURN_KEY_API_TOKEN | secret | Realtime TURN key API token | For calls |
| SFU_KEY_ID | secret | Realtime SFU app ID | For group calls |
| SFU_KEY_API_TOKEN | secret | Realtime SFU app secret | For group calls |

#### TURN_KEY_ID / SFU_KEY_ID

- Create them in the dashboard under Realtime → TURN and Realtime → SFU
- Without TURN, calls only use STUN and fail between networks that cannot connect directly. Without the SFU, group calls are unavailable.

### Upgrading

Data only migrates forward, and clients on an old version reload themselves:

- **D1**: when better-auth's schema changes, generate a migration with `bun run --cwd server gen-auth-schema > server/migrations/000N_<name>.sql`. Deploying applies it first.
- **Durable Objects** and the **local database**: append a step to `MIGRATIONS` in `server/src/user-do.ts`, `server/src/chat-do.ts` or `web/src/sync/store.ts`. Never edit existing steps.
- **Protocol**: bump `PROTOCOL_VERSION` in `shared` when messages change incompatibly.

> **Note:** A release that changes a schema cannot be rolled back. Objects that the new version has touched are newer than the old code, which refuses to open them. Fix forward instead.

## Development

```sh
bun install
cp .dev.vars.example .dev.vars                  # fill in the secrets and uncomment the development lines
bun run --cwd web db:migrate
bun run dev                                     # http://localhost:5173
bun run test
```

Development uses the top-level `vars` of `wrangler.jsonc`, overridden by `.dev.vars`, and the real R2 bucket under the `dev/` prefix. With another environment, prefix the commands with `CLOUDFLARE_ENV=<name>`; `bun run dev:production` and `bun run deploy:production` do that for the example instance.

## Sponsor

[Click Me](https://jaze.top/sponsor)
