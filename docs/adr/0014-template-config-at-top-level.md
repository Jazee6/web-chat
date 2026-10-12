# ADR-0014：wrangler.jsonc 顶层是模板，chat.jaze.top 的配置在 env.production

- 状态：已接受
- 日期：2026-10-12

## 背景

README 要加 Deploy to Cloudflare 按钮。按钮从仓库根目录读取 wrangler 配置与 `.dev.vars.example`，用顶层配置部署到别人的账号，并把示例文件里的每个条目都当作要填的机密。之前的 `server/wrangler.jsonc` 顶层就是 chat.jaze.top 的生产配置（自定义域名、D1 的 ID、IdP 与 R2 的值），别人点按钮一定失败。另外有几个部署值直接写在代码里：前端的 `MEDIA_ORIGIN`、`shared` 里的 `VAPID_PUBLIC_KEY`、服务端的 `PUSH_SUBJECT`。

## 决策

- **配置移到仓库根目录**。按钮只能指向仓库根目录：带子目录的地址要求子目录完全独立，而 web 依赖 `shared` 与 `../server`。
- **顶层是模板**：Worker 名 `web-chat-app`，用 `*.workers.dev`，D1 与 R2 用模板自己的名字（不写 `database_id`，部署时自动创建），vars 留空，部署后再填。名字都和线上不同，所以误跑一次不带环境的发布，最多在 workers.dev 上多出一个无害的 Worker，不会碰到线上的 Worker、库与桶。
- **chat.jaze.top 的配置在 `env.production`**，显式写 `name: "web-chat"`，否则 Worker 会变成 `web-chat-production`，Durable Object 的数据就对不上了。绑定与 vars 不从顶层继承，逐项写全。发布用 `bun run deploy:production`，本地开发用 `bun run dev:production`，两者都靠 `CLOUDFLARE_ENV=production` 选择环境。
- **部署值都放进 vars**。前端也要用的 `MEDIA_ORIGIN` 与 `VAPID_PUBLIC_KEY` 由 vite.config.ts 在构建时从选中环境的 vars 读出，以虚拟模块注入。VAPID 的 `sub` 改用 `BETTER_AUTH_URL`。
- **deploy 脚本先跑 D1 迁移**（按绑定名），再构建、发布。

## 后果

- `bun run deploy` 发布的是模板，**不会**发布到 chat.jaze.top。
- 改 `MEDIA_ORIGIN` 或 `VAPID_PUBLIC_KEY` 必须改仓库里的 `wrangler.jsonc` 并重新构建，在控制台改不会生效。
- 加绑定或 var 时，顶层与 `env.production` 两处都要改。
- 推送变成可选：没有 VAPID 公钥时前端不订阅；其余必填配置缺了时，`/api/*` 与 `/ws` 返回 500 并列出缺了哪些。

## 考虑过的方案

- **生产配置放在不提交的本地文件**：仓库只剩模板，最干净，但线上配置没有了版本管理。
- **生产配置放在控制台**（`keep_vars`）：仓库同样只剩模板，但前端常量在构建时读不到控制台里的值。
- **前端常量在运行时从服务端取**（`/api/config`）：改配置不用重新构建，但离线秒开和 Service Worker 同步判断媒体来源都得先等这份配置。
- **模板与线上同名、只靠脚本区分**：改动最少，但误跑一次 `deploy` 就会覆盖线上。
