# Web Chat

中文 ｜ [English](./README.en.md)

<img width="3588" height="1867" alt="Image" src="https://github.com/user-attachments/assets/8190ed14-0d52-40b7-a721-f19d6fd42a54" />

基于 Cloudflare 生态构建的实时 Web 聊天与通话应用。采用 Monorepo 架构，集成 WebRTC 通话、Durable Objects 状态管理与
D1 数据库，提供低延迟、高可用的 Serverless 聊天体验。

Live Demo: https://chat.jaze.top

## 特性

- **Monorepo 架构**：包含 `client`（前端）、`server`（后端）、`share`（共享类型与工具）三个工作区
- **Serverless 后端**：基于 Cloudflare Workers + Hono 框架构建
- **实时通信**：基于 `Realtime SFU/TURN` 实现 WebRTC 通话
- **Durable Objects**：使用 Cloudflare Durable Objects（Durable SQLite）管理房间状态
- **D1 数据库**：使用 Cloudflare D1 存储用户与聊天记录，搭配 Drizzle ORM 进行数据建模与迁移
- **现代前端体验**：React 19 + Vite + TypeScript + Tailwind CSS 4 + Shadcn UI
- **安全与认证**：集成 `better-auth` 提供身份验证
- **对象存储**：支持 Cloudflare R2 / S3 兼容存储，实现图片与文件的上传与预览

## 部署

### 创建 Cloudflare 资源

在 [Cloudflare Dashboard](https://dash.cloudflare.com) 中创建以下资源：

- **D1 数据库**：Workers & Pages > D1 > Create database
- **R2 存储桶**：R2 > Create bucket > 名称为 `web-chat`
- **Durable Objects**：部署时由 Wrangler 自动创建
- **RealtimeKit (SFU/TURN)**：Realtime > Create SFU App / Create TURN Key

### 数据库迁移

```bash
cd server

# 生成 Room Durable SQLite 迁移
bun run db:generate:do

# 生成 Better Auth 迁移
bun run db:generate:auth

# 推送 D1 数据库迁移
bun run db:push:d1
```

### 部署到 Cloudflare Workers

```bash
cd server
bunx wrangler secret put OPENROUTER_API_KEY
bun run deploy
```

## 环境变量列表

### 服务端 (`server/.env`)

| 名称                            | 描述                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| SITE_URL                        | 前端站点地址                                                |
| BETTER_AUTH_URL                 | 认证服务地址（后端地址）                                    |
| BETTER_AUTH_SECRET              | better-auth 密钥（随机字符串）                              |
| EASY_AUTH_URL                   | [Easy Auth](https://github.com/Jazee6/easy-auth) URL        |
| EASY_AUTH_CLIENT_ID             | [Easy Auth](https://github.com/Jazee6/easy-auth) 客户端 ID  |
| EASY_AUTH_CLIENT_SECRET         | [Easy Auth](https://github.com/Jazee6/easy-auth) 客户端密钥 |
| OPENROUTER_API_KEY              | OpenRouter API 密钥                                         |
| CLOUDFLARE_ACCOUNT_ID           | Cloudflare 账户 ID                                          |
| CLOUDFLARE_DATABASE_ID          | D1 数据库 ID                                                |
| CLOUDFLARE_D1_TOKEN             | D1 HTTP API 令牌                                            |
| CLOUDFLARE_SFU_ID               | Cloudflare RealtimeKit SFU ID                               |
| CLOUDFLARE_SFU_SECRET           | Cloudflare RealtimeKit SFU Secret                           |
| CLOUDFLARE_TURN_ID              | Cloudflare TURN Key ID                                      |
| CLOUDFLARE_TURN_SECRET          | Cloudflare TURN Secret                                      |
| CLOUDFLARE_R2_ACCESS_KEY_ID     | R2 存储 Access Key ID                                       |
| CLOUDFLARE_R2_SECRET_ACCESS_KEY | R2 存储 Secret Access Key                                   |

### 客户端 (`client/.env`)

| 名称         | 描述          |
| ------------ | ------------- |
| VITE_API_URL | 后端 API 地址 |

## 赞助

[Click Me](https://jaze.top/sponsor)
