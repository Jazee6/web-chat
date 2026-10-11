# 09 · 路线图、假设与开放问题

## 分阶段

### 第一阶段 · 核心聊天（MVP）

- 仓库结构：bun workspaces（`web` / `server` / `shared`），单 Worker 部署并托管静态资源
- better-auth 1.7.x Generic OAuth 对接自建 IdP（环境变量配置）、登出、设备管理
- `UserDO` / `ChatDO` 骨架：Hibernation WebSocket、帧协议、Valibot 校验
- 私聊、群组（上限 20 人，写扩散）：发送、回复、编辑、删除、已读、输入中、在线状态
- 同步：`sync.user` / `sync.chat`、缺口检测、outbox 重发、多设备同步
- 客户端：Leader 标签页 + SQLite WASM（OPFS）+ `useLiveQuery`、对话列表、消息列表、输入框
- 图片与文件：预签名上传、客户端缩略图、ThumbHash、R2 自定义域名分发（**已完成**，2026-09-29）
- PWA（离线外壳、媒体缓存、Share Target）、Web Push（自实现 VAPID）、角标与 favicon（**已完成**，2026-09-30）
- 本地全文搜索：全局搜索、会话内搜索、定位消息（**已完成**，2026-09-30）
- 测试：`rowsWritten` 断言覆盖所有热路径，只读路径断言零写入（**已完成**，2026-09-30）
- 联系人（备注名）、拉黑（[ADR-0007](../adr/0007-block-rejects-explicitly.md)）、资料页、会话画中画（**已完成**，2026-10-01）

### 第二阶段 · Telegram 化

- 回应、置顶消息、转发、@提及（**已完成**，2026-10-07）
- 回复链跳转（复用定位消息，可逐级返回）（**已完成**，2026-10-01）
- 链接预览（iMessage 样式的卡片，正文里的链接可点击）（**已完成**，2026-10-08）
- 语音消息（**已完成**，2026-10-08；手机上的打断与播放**待真机实测**，见 [05 § 语音消息](./05-media.md#语音消息)）
- 视频（WebCodecs 转码，可以与图片混排进相册）（**已完成**，2026-10-08）
- 邀请链接（**已完成**，2026-10-08）
- 置顶对话、草稿同步、静音（**已完成**，2026-10-01）
- 孤儿媒体清理（**已完成**，2026-10-08；改用待发区加桶的生命周期规则，不用 Workflow，见 [ADR-0008](../adr/0008-pending-media-prefix.md)）
- 贴纸：我的贴纸（最多 200 张，从会话里的图片、贴纸消息或本机图片添加）与贴纸消息，贴纸对象被所有消息共用（[ADR-0012](../adr/0012-shared-sticker-objects.md)）（**已完成**，2026-10-09；服务端与本地库由测试覆盖，经真实 R2 的添加与秘密聊天里的发送**待实测**）
- 额度监控告警（2026-10-08 决定暂不做：控制台没有免费额度的预警，人工查看，见 [08 § 守则](./08-free-tier-budget.md#守则防止悄悄超额)）

### 第三阶段 · 高级能力

- 一对一语音 / 视频通话与屏幕共享（P2P + TURN，信令复用 WS，见 [ADR-0009](../adr/0009-p2p-private-calls-sfu-group-calls.md)）（**已完成**，2026-10-08；无头 Chrome 端到端已验证，包括只走 TURN 中继；真机**待实测**）
- 群组通话（Realtime SFU，房间式，simulcast）（**已完成**，2026-10-08；三个账号经真实的 SFU 在无头 Chrome 里端到端验证；真机**待实测**）
- 最近通话（**已完成**，2026-10-08；包括自己加入过的群组通话）
- 秘密聊天（MLS 端到端加密，多设备，见 [ADR-0010](../adr/0010-secret-chats-multi-device-mls.md)）（文字消息、编辑、回应、撤回、安全码、删除、加密媒体**已完成**，2026-10-09；文字部分在三个无头 Chrome（双方共三台设备）里端到端验证过，包括追加设备、清空本地数据后重新加入、删除后重开；加密媒体由单元与服务端测试覆盖，经真实 R2 的端到端**待实测**）

### 暂不做

- 频道、超级群、大群（> 20 人）。将来要做时，参考 [ADR-0002](../adr/0002-write-fanout-small-groups.md) 中记录的读扩散方案
- 服务端全文搜索
- 文件夹（2026-10-08 决定暂不做）
- 定时消息、自毁消息（2026-10-09 决定暂不做；将来用 `ChatDO` 的 DO Alarm 实现）
- Workers AI：消息翻译、长对话摘要（2026-10-09 决定暂不做）
- Bot API（2026-10-09 决定暂不做；设计见 [ADR-0011](../adr/0011-bots-telegram-compatible-api.md)；做了一半的代码已经删除）

## 假设

- 目标用户使用最新版 Chromium、Safari 或 Firefox，不支持旧版浏览器。
- 身份完全来自自建的可信 IdP；账号找回、禁用、注销都由 IdP 负责。
- 规模目标：免费额度下支撑 100–200 名日活（见 [08](./08-free-tier-budget.md#容量估算)）；超出时升级到 Paid，架构不需要调整。
- 单个会话的消息全部存放在一个 `ChatDO` 中，免费账号单对象上限 1 GB，对文本消息足够。
- 媒体通过不可猜测的 URL 公开访问（capability URL），需要保密的内容走秘密聊天。

## 开放问题

| # | 问题 | 当前倾向 |
| --- | --- | --- |
| 1 | IdP 删除或禁用用户后，本地如何清理？ | 登录时 IdP 拒绝即可阻止访问；本地数据清理由管理员触发 `PurgeWorkflow` |
| 2 | better-auth 在 Free 套餐 10ms CPU 下的冷启动耗时是否超限？ | **已实测**（2026-09-29）：`/ws` 经 `getSession` 需 31–51ms，已改为先校验 cookie 缓存，热路径降到 5–11ms；登录、回调与冷启动仍超限但频率低。详见 [06 § Worker CPU 风险](./06-auth-and-security.md#worker-cpu-风险) |
| 3 | 私聊是否允许陌生人直接发起？ | **已定**（2026-10-01 修订）：服务端不限制，陌生人发来的私聊可以直接回复；但界面上新建私聊、拉人进群只能从联系人中选，按邮箱查找改为"添加联系人"。不想被打扰靠拉黑；"仅联系人"隐私选项以后再加 |
| 4 | 是否需要消息编辑历史？ | 不需要，与 Telegram 一致 |
| 5 | 帧编码是否换成二进制（CBOR / MessagePack）？ | 先用 JSON；如果 Workers 支持 permessage-deflate 就启用压缩（待验证） |
| 6 | 媒体子域名需要一个托管在 Cloudflare 的域名 | **已定**（2026-09-29）：`r2.chat.jaze.top`，已绑定到桶 `web-chat-media`；应用域名为 `chat.jaze.top` |
| 7 | 离线时被移除的设备，超过 cookie 缓存时长后重连，是否也显示"本设备已被移除"？ | **已定**（2026-09-29）：接受现状，以 IdP 为准。本地数据照样清空，IdP 仍登录时作为新设备重新登录；止损靠 IdP。备选方案（D1 为被移除的 session 留墓碑，Worker 在 `getSession` 为空时查一次）暂不做 |
| 8 | 链接预览的抓取（HTMLRewriter 解析最多 256 KB 的 `<head>`）在 Free 套餐 10ms CPU 下是否超限？本地抓不到 github.com 等网站是否只是本地网络的问题？ | **待实测**：部署后用控制台看 `/api/link-preview` 的 CPU 时间，并抓几个大站验证；超限时缩小读取上限 |
| 9 | 语音消息在手机上的表现：切到后台、锁屏、来电时能否保留已录部分；Safari 能否播放 Chrome / Firefox 录的 WebM；iOS 连播是否被自动播放策略拦下 | **待真机实测**（iPhone Safari 与一台安卓手机）：录一段后切走再回来，看录音条是否停在"Recording stopped"并能发出；收到 WebM 语音时在 Safari 里播放并连播两条 |
| 10 | 视频在 Safari、Firefox 与手机上的转码与播放：Firefox 的 WASM AAC 编码器、iPhone 拍的 HEVC / HDR 视频、手机转一段 3 分钟视频的耗时、iOS 上以 CORS 方式边下边播 | **待真机实测**（无头 Chrome 已验证，见 [05 § 视频](./05-media.md#视频)）：各发一段手机拍的视频并在另一端播放 |
| 11 | Free 账号能否创建 Realtime TURN key（是否要绑定付款方式）？ | **已解决**（2026-10-08）：TURN key 与 SFU App 都已在本账号创建，本地验证能签发凭据、创建 SFU session；生产环境仍要按下面的待办（配置）注入 |
| 12 | 一对一与群组通话在 Safari、Firefox 与手机上的表现：TURN 中继能否连通、切到后台与锁屏时通话是否继续、iOS 上来电推送与铃声 | **待真机实测**（无头 Chrome 的假摄像头 / 麦克风已验证：接通、开摄像头、同时共享屏幕、收起、挂断与未接来电的记录；双方都只走 TURN 中继（relay/udp）时音视频与屏幕共享正常。群组通话三个账号经真实的 SFU 验证：静音加入、第一次开麦、摄像头 simulcast 与放大时换层、先拉取后发布的屏幕共享、静音 40 秒后再开麦、收起与结束记录）。另外要看 Safari 的 VP8 simulcast，以及手机在群组通话里切到后台时 SFU 的连接能否保住 |

## 待办（配置）

不涉及代码、需要在 Cloudflare 控制台完成的配置。

| 事项 | 做法 | 作用 |
| --- | --- | --- |
| 首次部署 | 按 [README](../../README.zh.md#部署)：建 D1 并填 `database_id`、在 IdP 登记生产回调地址、发布、注入机密（含 `VAPID_PRIVATE_KEY`、`TURN_KEY_*`、`SFU_KEY_*`，值取本地 `server/.dev.vars`） | 缺 VAPID 私钥时推送全部失败；缺 TURN key 时只有 STUN，非联系人之间的通话失败；缺 SFU App 时群组通话不可用 |
| 媒体域名加 `X-Content-Type-Options: nosniff` | jaze.top → Rules → Response Header Transform Rule：条件 `(http.host eq "r2.chat.jaze.top")`，Set static `X-Content-Type-Options: nosniff`；加好后 `curl -sI` 任一对象确认 | 纵深防御：内容与声明类型不符的对象不会被浏览器当成别的类型执行。已有域名隔离与文件强制下载，不紧急。见 [05 § 分发](./05-media.md#分发) |

## 新依赖

以下依赖**已确认可以安装**（2026-09-28），实现相应功能时再引入。

| 依赖 | 用途 | 位置 | 能否自实现 / 替代 |
| --- | --- | --- | --- |
| `better-auth`（1.7.x） | 身份（Generic OAuth）与会话 | server + web（client） | **用户已指定**，需开启 `nodejs_compat` |
| `valibot` | 协议与表单 schema 校验 | shared / web / server | UI 规则已指定使用，建议引入 |
| `@tanstack/react-form` | 表单 | web | UI 规则已指定使用 |
| `@tanstack/react-table` | 成员、设备管理表格 | web | UI 规则已指定使用 |
| `@tanstack/react-router` | 类型安全路由 | web | 可以用 Navigation API 自写一个简易路由，但类型安全较弱 |
| `@sqlite.org/sqlite-wasm` | 客户端 SQLite + OPFS | web | 无法替代（IndexedDB 没有 SQL / FTS） |
| `thumbhash` | 图片占位 | web + 渲染 | 可以移植（约 300 行） |
| `aws4fetch` | R2 预签名（SigV4） | server | 可以用 WebCrypto 自实现（约 80 行） |
| `mediabunny` | WebCodecs 视频转码 / 封装 MP4 | web | **已引入**（2026-10-08）。封装 MP4 容器的工作量大 |
| `@mediabunny/aac-encoder` | 没有原生 AAC 编码器的浏览器（例如 Firefox）转码视频的音轨，WASM，用到时才加载 | web | **已确认**（2026-10-08）。不引入的话这些浏览器只能把视频按文件发送 |
| `@cloudflare/vite-plugin` | Vite 开发时在 workerd 里运行 Worker，实现前后端一体开发 | web | 替代方案是分别运行 `vite` 与 `wrangler dev` 并配置代理 |
| `@cloudflare/vitest-pool-workers` + `vitest` | 在真实 workerd 环境中测试 DO | server | 无法替代 |
| `ts-mls` | MLS 端到端加密（秘密聊天，套件 1，只依赖 `@hpke/core`；未经正式审计） | web | **已确认**（2026-10-09）。自实现 X3DH + Double Ratchet 只能一对一，且是几千行安全敏感代码，见 [ADR-0010](../adr/0010-secret-chats-multi-device-mls.md) |
| `cmdk` | shadcn Command 的底层（会话内搜索）；连带引入它依赖的若干 `@radix-ui/*` | web | **已确认**（2026-09-30）。可以用 InputGroup + Item 自己拼键盘选择，但 UI 规则要求组合 shadcn 组件 |

**不安装**：`sonner`。Toast 使用 shadcn 自带的 `toast` 组件（基于 Base UI Toast）。
