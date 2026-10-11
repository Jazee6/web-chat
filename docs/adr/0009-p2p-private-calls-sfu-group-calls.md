# ADR-0009：一对一通话走 P2P，群组通话走 SFU

- 状态：已接受
- 日期：2026-10-08

## 背景

第三阶段加入语音、视频通话与屏幕共享。Cloudflare Realtime 提供 SFU 与 TURN，两者共用每月 1,000 GB 免费出站流量（入站不计费），超出后 $0.05/GB。SFU 没有房间的概念，由后端持有 App Secret 调用它的 HTTPS 接口，并把 `sessionId + trackName` 分发给订阅者。一对一视频每路约 1.5 Mbps，经 SFU 时每小时约 1.35 GB 出站。

## 决策

- **一对一通话走 P2P**，信令经现有的 WebSocket 与 `UserDO` 转发，ICE 用 Cloudflare STUN / TURN，TURN 凭据由 Worker 签发短期的。能直连时不经过 Cloudflare，不占流量额度。
- **对方不在我的联系人中时，我这一侧强制只用 TURN 中继**（`iceTransportPolicy: 'relay'`），陌生人拿不到我的网络地址。联系人是单向的，双方各自按自己的联系人列表决定。
- **群组通话走 Realtime SFU**，房间状态（谁在、发布了哪些 track）放在群组的 `ChatDO`，视频用 simulcast：宫格只拉低清层，放大的那一路与屏幕共享拉高清层。

## 考虑过的方案

- **一对一也走 SFU**：只需要一套代码，天然不暴露 IP；但每分钟通话都要计入出站额度，并且多一跳延迟。
- **群组用 P2P mesh**：20 人上限时每人要上传 19 路，浏览器和上行带宽都撑不住。

## 后果

- 一对一与群组是两套媒体链路：一对一处理 SDP / ICE 的协商、ICE restart 与中继策略，群组处理 SFU 的 session、track 与 simulcast。共用的只有通话界面、通话记录与忙线判断。
- 不做端到端加密：P2P 本身是 DTLS-SRTP 端到端的，但群组的媒体在 SFU 上解密；与普通消息一样信任 Cloudflare，需要保密的等秘密聊天。
- 部署前要在控制台创建 TURN key 与 Realtime SFU App，并以 secret 注入。
