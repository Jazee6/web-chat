# Web Chat

[中文](./README.md) ｜ English

<img width="3588" height="1867" alt="Image" src="https://github.com/user-attachments/assets/8190ed14-0d52-40b7-a721-f19d6fd42a54" />

A real-time web chat and calling application built on the Cloudflare ecosystem. Using a Monorepo architecture, it
integrates WebRTC calling, Durable Objects for state management, and D1 database to deliver a low-latency, highly
available serverless chat experience.

Live Demo: https://chat.jaze.top

## Features

- **Monorepo Architecture**: Includes three workspaces — `client` (frontend), `server` (backend), and `share` (shared
  types and utilities)
- **Serverless Backend**: Built with Cloudflare Workers + Hono framework
- **Real-time Communication**: WebRTC calling powered by `Realtime SFU/TURN`
- **Durable Objects**: Room state management using Cloudflare Durable Objects (Durable SQLite)
- **D1 Database**: User and chat history storage via Cloudflare D1, with Drizzle ORM for data modeling and migrations
- **Modern Frontend Experience**: React 19 + Vite + TypeScript + Tailwind CSS 4 + Shadcn UI
- **Security & Authentication**: Integrated `better-auth` for authentication
- **Object Storage**: Cloudflare R2 / S3-compatible storage for image and file uploads with preview support

## Deployment

### Create Cloudflare Resources

Create the following resources in the [Cloudflare Dashboard](https://dash.cloudflare.com):

- **D1 Database**: Workers & Pages > D1 > Create database
- **R2 Bucket**: R2 > Create bucket > Name it `web-chat`
- **Durable Objects**: Automatically created by Wrangler during deployment
- **RealtimeKit (SFU/TURN)**: Realtime > Create SFU App / Create TURN Key

### Database Migrations

```bash
cd server

# Generate Room Durable SQLite migration
bun run db:generate:do

# Generate Better Auth migration
bun run db:generate:auth

# Push D1 database migrations
bun run db:push:d1
```

### Deploy to Cloudflare Workers

```bash
cd server
bunx wrangler secret put OPENROUTER_API_KEY
bun run deploy
```

## Environment Variables

### Server (`server/.env`)

| Name                            | Description                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| SITE_URL                        | Frontend site URL                                              |
| BETTER_AUTH_URL                 | Authentication service URL (backend URL)                       |
| BETTER_AUTH_SECRET              | `better-auth` secret (random string)                           |
| EASY_AUTH_URL                   | [Easy Auth](https://github.com/Jazee6/easy-auth) URL           |
| EASY_AUTH_CLIENT_ID             | [Easy Auth](https://github.com/Jazee6/easy-auth) Client ID     |
| EASY_AUTH_CLIENT_SECRET         | [Easy Auth](https://github.com/Jazee6/easy-auth) Client Secret |
| OPENROUTER_API_KEY              | OpenRouter API key                                             |
| CLOUDFLARE_ACCOUNT_ID           | Cloudflare Account ID                                          |
| CLOUDFLARE_DATABASE_ID          | D1 Database ID                                                 |
| CLOUDFLARE_D1_TOKEN             | D1 HTTP API Token                                              |
| CLOUDFLARE_SFU_ID               | Cloudflare RealtimeKit SFU ID                                  |
| CLOUDFLARE_SFU_SECRET           | Cloudflare RealtimeKit SFU Secret                              |
| CLOUDFLARE_TURN_ID              | Cloudflare TURN Key ID                                         |
| CLOUDFLARE_TURN_SECRET          | Cloudflare TURN Secret                                         |
| CLOUDFLARE_R2_ACCESS_KEY_ID     | R2 Storage Access Key ID                                       |
| CLOUDFLARE_R2_SECRET_ACCESS_KEY | R2 Storage Secret Access Key                                   |

### Client (`client/.env`)

| Name         | Description     |
| ------------ | --------------- |
| VITE_API_URL | Backend API URL |

## Sponsor

[Click Me](https://jaze.top/sponsor)
