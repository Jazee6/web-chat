# ADR-0005：身份由 better-auth Generic OAuth 对接自建 IdP

- 状态：已接受（取代原先的"Passkey + 无状态令牌"方案）
- 日期：2026-09-28

## 背景

- 用户已有**自建的可信身份源**，本应用不需要、也不应该自己管理凭据。
- 身份源的发现地址、客户端 ID / 密钥会因部署环境而不同，必须通过环境变量配置。
- 限制条件：
  - KV 免费额度只有 1,000 次写/天，不能用来存会话；
  - Worker 每次调用只有 10ms CPU。

## 决策

- 使用 better-auth **1.7.x** 的 `genericOAuth` 插件，只配置一个身份源，开启 PKCE 与 `requireIdTokenVerification`；退出登录时一并完成 IdP 的 OIDC 登出。环境变量只保留 5 个必要值（`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`OAUTH_DISCOVERY_URL`、`OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`），机密值用 `wrangler secret` 注入；provider ID、scope、用户名 claim 等使用固定常量，端点从 OIDC 发现文档获取。
- IdP 是可信来源：
  - 允许隐式注册（首次登录即自动建号）；
  - `overrideUserInfo` 让每次登录都同步 IdP 资料；
  - 用户名取自标准 claim `preferred_username`，本地不可修改。
- better-auth 的数据（`user`、`session`、`account`、`verification`）直接存放在 D1。
- 开启 cookie 缓存（5 分钟），让绝大多数会话校验不读 D1；`updateAge` 设为 1 天，控制续期写入。
- 设备 = better-auth session。`UserDO.devices` 以 `session.id` 为键，存推送订阅和吊销标记，并在接受 WebSocket 时检查吊销状态。
- 只把会话 cookie 设为 `SameSite=Strict`，OAuth state cookie 保持 `Lax`，以免 IdP 回调失败。
- 不使用 KV，也不使用 better-auth 内置的限流器。

## 后果

- 不再需要原方案中的 Passkey、Turnstile、自研令牌与刷新轮换。
- 新增依赖 `better-auth`，Worker 需要开启 `nodejs_compat`。
- 吊销 session 后，cookie 缓存最多还能通过 Worker 校验 5 分钟；由于 `UserDO` 在接受连接时拒绝已吊销的设备，所以不影响实时通道。
- 账号找回、注销账号、禁用账号都交给 IdP 处理；本应用只需要处理"IdP 已删除该用户"时的本地清理（开放问题）。
- 需要实测 better-auth 在 Free 套餐 10ms CPU 下的冷启动耗时，超限时的降级方案见 [06](../architecture/06-auth-and-security.md#worker-cpu-风险)。

## 考虑过的其他方案

- **Passkey + 自研 HMAC 令牌**：用户已经有统一身份源，自建凭据体系既多余，也会割裂账号。
- **自己实现 OIDC 客户端**：可行（WebCrypto + fetch），但 better-auth 已经覆盖了会话管理、cookie 缓存和 D1 存储，而且是项目指定的方案。
