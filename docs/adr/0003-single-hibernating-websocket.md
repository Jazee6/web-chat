# ADR-0003：每设备一条 Hibernation WebSocket 连到 UserDO

- 状态：已接受
- 日期：2026-09-28

## 背景

DO 免费时长额度是 13,000 GB-s/天，按 128MB 计算，约等于**全账号每天 29 个 DO·小时**。保持连接但不能休眠的 DO，会持续计费。

另外两条计费规则：
- 入站 WS 消息按 20:1 折算为请求；
- `setWebSocketAutoResponse` 自动回复不计费。

## 决策

- 每台设备（准确地说，是每个浏览器源里的 Leader 标签页）只建立一条 WebSocket，连到自己的 `UserDO`，并使用 `ctx.acceptWebSocket()` 的 Hibernation API。
- 心跳使用自动回复（`ping` → `pong`），不唤醒 DO。
- 连接上的临时状态放在 `serializeAttachment` 中，这样休眠后不会丢失。
- 除登录、上传签名、链接预览外，所有业务调用都走这条连接，由 `UserDO` 用 RPC 代理到 `ChatDO`。
- DO 内禁止使用 `setTimeout` / `setInterval`，定时任务一律用 Alarm。

## 后果

- 空闲连接的成本接近零；每个业务调用约计 1/20 个请求，另加被代理的 `ChatDO` 请求。
- `UserDO` 成为该用户所有请求的串行点。对单个用户来说足够，同时天然实现了按用户限流。
- 内存中的临时状态（输入中的查看者、在线状态观察者、令牌桶）可能随休眠丢失，因此设计上必须允许丢失。

## 考虑过的其他方案

- **Cap'n Web 长会话 RPC**：会话状态保存在内存中，与休眠冲突，会持续计入时长。
- **客户端每打开一个会话就额外连接一次 `ChatDO`**：连接数与请求数成倍增加，而且对话列表的实时刷新仍然需要一条用户级连接。
- **SSE + HTTP POST**：每次上行都是一个 Worker 请求，消耗 10 万/天的 Worker 额度。
