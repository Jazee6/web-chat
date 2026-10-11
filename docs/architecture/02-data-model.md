# 02 · 数据模型

数据存在四个地方，每处只存自己拥有的数据：

| 存储 | 拥有的数据 | 访问方 |
| --- | --- | --- |
| D1 `DIRECTORY` | better-auth 的身份数据（用户、会话、IdP 账号关联），以及用户名唯一索引 | Worker（better-auth）、UserDO |
| `UserDO` SQLite | 一个用户的设备、对话列表、设置、联系人与拉黑 | 自身 |
| `ChatDO` SQLite | 一个会话的消息、成员 | 自身 |
| 客户端 SQLite（OPFS） | 已同步数据的本地副本、发件箱、本地全文索引 | 同步 Worker |

## 写入成本约定

免费额度里最紧的是**行写入**（DO 与 D1 各 10 万/天，见 [08](./08-free-tier-budget.md)）。建表时遵守以下约定：

1. **索引会增加写入**：写入包含被索引列时，每个索引多算 1 行（D1 文档明确说明；DO SQLite 的计费口径与 D1 一致）。能不建的二级索引就不建，读取便宜得多（DO 每天 500 万行读）。
2. **主键用 `INTEGER PRIMARY KEY` 或 `WITHOUT ROWID`**：普通 rowid 表如果用 TEXT 做主键，SQLite 会额外建一个自动索引，每次写入变成 2 行。
3. **计数器不单独落行**：序号在唤醒时由 `max()` 恢复（见 [01](./01-topology.md#利用平台特性获得的正确性)）。
4. **未读数不存计数器**：`unread = top_seq − last_read_seq`，每条新消息不需要给每个成员再写一行计数。
5. **以实测为准**：`sql.exec()` 返回的游标带有 `rowsWritten`，测试里对每个热路径操作断言其写入行数（见 [08 § 每操作成本](./08-free-tier-budget.md#每操作成本)）。

## 表结构迁移

从 1.0 起，所有数据只做前向迁移，不再重置（见 [ADR-0013](../adr/0013-forward-only-migrations-after-1-0.md)）。1.0 发布之前，v1 基线仍然可以直接修改。

- **D1**：`wrangler d1 migrations`。升级 better-auth 后运行 `bun run gen-auth-schema`：它先在内存库上执行已有的迁移，再只输出还缺的 SQL；有输出时存为下一个编号的迁移文件。
- **DO**：`UserDO` 与 `ChatDO` 各有一个 `MIGRATIONS` 数组，第 i 项把表结构从版本 i 升到 i + 1。版本号存在 DO 的 KV 里（DO SQLite 不允许 `PRAGMA user_version`）。唤醒时 `migrate()` 只执行比版本号新的步骤，并且全部放在一个事务里，版本号一致时什么都不做。迁移的写入不计入测试里的 `rowsWritten`。版本号比代码新时拒绝启动。
- **客户端本地库**：`store.ts` 的 `MIGRATIONS`，版本号记在 `PRAGMA user_version`，同样只执行比版本号新的步骤。版本号为 0 是新库（首次登录、换了账号、OPFS 被浏览器清掉）。不再因为版本不一致而整库重建：秘密聊天的明文与密钥只在本地库里，重建就永久丢失。版本号比代码新，说明更新的标签页已经迁移过，同步 Worker 不碰本地库，请标签页重载（见 [07 § 新版本](./07-client.md#新版本)）。

## D1 · 目录库（better-auth）

表结构由 `server/scripts/gen-auth-schema.ts` 根据 better-auth 1.7.x 的配置生成，作为 `wrangler d1 migrations` 的迁移文件纳入仓库。核心表如下：

| 表 | 用途 | 本应用关心的字段 |
| --- | --- | --- |
| `user` | 用户资料，以 IdP 为准，每次登录时覆盖 | `id`（也是 `UserDO` 的名字）、`name`、`email`、`image`（IdP 头像 URL），以及扩展字段 `username`（取自 IdP claim，唯一，`input: false`）和 `bio`（本地可编辑，`input: true`） |
| `session` | 登录会话，对应本应用的**设备** | `id`（即 `device_id`）、`userId`、`expiresAt`、`userAgent` |
| `account` | 与 IdP 账号的关联 | `providerId`、`accountId`（IdP 的 `sub`） |
| `verification` | OAuth `state` / PKCE 等临时数据 | — |

- 用户资料需要被任何人按 ID 或用户名查到，因此以 D1 为准；`UserDO` 可以缓存自己的资料。
- `users.get` 等读取路径使用 D1 Sessions API 走读副本，写后读由 bookmark 保证一致。
- **不放进 D1 的数据**：消息、对话列表、推送订阅、邀请码（邀请码自带 chat_id，令牌由 `ChatDO` 保存并校验，见下文）。

## UserDO

```sql
CREATE TABLE devices (                         -- 本应用附加的设备状态；设备本身（UA、登录时间）是 D1 的 session
  id             TEXT PRIMARY KEY,             -- = better-auth session.id
  last_active_at INTEGER NOT NULL,             -- 设备最后活跃：最后一次在前台的时间；断开连接时有变化才写
  ip             TEXT,                         -- 最近一次连接的位置，取自 CF-Connecting-IP 与 request.cf
  country        TEXT,
  city           TEXT,
  revoked_at     INTEGER,                      -- 移除时间；保留 2 倍 cookie 缓存时长，期间拒绝该设备连接
  push           TEXT                          -- 推送订阅 JSON {endpoint, p256dh, auth}；没有订阅为 NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE dialogs (
  chat_id        TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,                -- private | group
  title          TEXT,                         -- 群名（随扇出的会话资料更新）；私聊为 NULL
  status         TEXT NOT NULL,                -- member | left（只读对话）| deleted（删除对话的墓碑，供其他设备同步删除）
  pts            INTEGER NOT NULL,             -- 本行最后变化时的 user_pts
  top_seq        INTEGER NOT NULL,
  top_preview    TEXT,                         -- JSON：发送者、摘要、日期（写扩散维护）
  chat_pts       INTEGER NOT NULL,
  last_read_seq  INTEGER NOT NULL DEFAULT 0,   -- 我读到哪
  peer_read_seq  INTEGER NOT NULL DEFAULT 0,   -- 私聊中对方读到哪（已读回执）；群组暂不展示，恒为 0
  pinned_rank    INTEGER,                      -- 置顶对话的顺序，越大越靠前；最多 5 个非 NULL
  muted_until    INTEGER NOT NULL DEFAULT 0,   -- 静音到期的毫秒时间戳；MUTE_FOREVER 为永久。到期不写库，读的时候与当前时间比较
  draft          TEXT,                         -- 草稿 JSON {text, reply_to}；自己发出消息、变成只读对话时清空
  mentions       TEXT                          -- 未读提及的 seq（JSON 数组，升序）；读到、撤回后移除，没有为 NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE settings (                        -- 账号级 KV：设置、隐私、资料缓存（与 D1 的 better-auth account 表无关）
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  pts   INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE meta (                            -- 账号级零散状态，不参与同步：last_seen（最后上线时间）、call（当前的通话）、ring_pushed（推过来电通知的通话）
  key   TEXT PRIMARY KEY,
  value ANY
) STRICT, WITHOUT ROWID;

CREATE TABLE calls (                           -- 最近通话：来自通话记录，只增不改；只留最近 MAX_RECENT_CALLS（100）条，更早的删掉、不留墓碑
  call_id   TEXT PRIMARY KEY,
  chat_id   TEXT NOT NULL,
  seq       INTEGER NOT NULL,                  -- 会话里那条通话记录
  peer_id   TEXT NOT NULL,                     -- 对方
  caller_id TEXT NOT NULL,                     -- 主叫方
  result    TEXT NOT NULL,                     -- ended | declined | canceled | missed | busy
  duration  INTEGER NOT NULL,                  -- 接通的秒数，没接通为 0
  date      INTEGER NOT NULL,                  -- 通话记录的时间（结束时）
  pts       INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE relations (                       -- 与其他用户的关系：联系人（及备注名）、拉黑，两者互相独立
  user_id TEXT PRIMARY KEY,
  contact INTEGER NOT NULL,                    -- 0 / 1
  alias   TEXT,                                -- 备注名，只有联系人才有
  blocked INTEGER NOT NULL,                    -- 0 / 1
  pts     INTEGER NOT NULL                     -- 本行最后变化时的 user_pts
) STRICT, WITHOUT ROWID;

CREATE TABLE stickers (                        -- 我的贴纸：最多 MAX_STICKERS（200）张未移除的
  key       TEXT PRIMARY KEY,                  -- 贴纸在 s/ 下的键（从贴纸消息添加的可能是别人添加的那个对象）
  mime      TEXT NOT NULL,                     -- image/webp | image/png | image/gif
  w         INTEGER NOT NULL,
  h         INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  thumbhash TEXT NOT NULL,
  added_at  INTEGER NOT NULL,                  -- 越大越靠前；再次添加时更新
  removed   INTEGER NOT NULL,                  -- 1 为墓碑（对象不删除，见 ADR-0012）
  pts       INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
```

- **联系人与拉黑合在一张表**：每个对方一行，加联系人、改备注名、拉黑、解除都是 1 行写入。两者都取消后保留为墓碑（`contact = 0 AND blocked = 0`），供其他设备经 `sync.user` 同步删除。
- **我的贴纸**：每张 1 行，添加、移除都是 1 行写入；移除后保留墓碑供其他设备同步删除，再次添加时复活。发送贴纸只读这张表，不写。
- 拉黑的状态另在私聊的 `ChatDO` 里记一份（见下文 `info`），发送时就地判断，不必每条消息都去问对方的 `UserDO`。

- **`dialogs` 刻意不建二级索引**：一个用户通常只有几十到几百个对话，`WHERE pts > ?` 全表扫描只消耗读额度，不消耗写额度。排序交给客户端。
- `user_pts` 在唤醒时由 `dialogs`、`settings`、`relations`、`calls`、`stickers` 五张表的 `max(pts)` 恢复。
- **最近通话**在通话记录扇出到 `UserDO` 时记下（每条 1 行，扇出重试时已经记过就跳过），与对话行在同一批更新里各占一个 `user_pts`。超过 100 条时删掉最早的；删除不留墓碑，客户端写入时按同样的规则删，结果一致。
- 每条新消息，只在每个成员的 `UserDO` 里 upsert 一行 `dialogs`，**恰好 1 行写入**。置顶、静音照搬原行；发送者自己的草稿在同一次写入里清空，被提及的人的未读提及在同一次写入里记下，都不多花写入。已读前移时在同一行里移除读到的提及；提及我的消息被撤回时多写 1 行把它移除。
- 置顶、静音、草稿由 `dialogs.update` 修改，一次修改 1 行写入，没有变化不写；删除对话时三者一并清空。

## ChatDO

```sql
CREATE TABLE info (                            -- 会话元数据，低频更新
  key   TEXT PRIMARY KEY,                      -- chat_id, kind, title, invite（邀请链接的令牌）, block:{user_id}, call（进行中的一对一通话）, group_call（进行中的群组通话），
                                               -- 秘密聊天的 secret（当前纪元、组里的设备、要重新加入的设备）、devices:{user_id}（双方现有的设备）、deleted…
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE members (                         -- 当前成员与前成员
  user_id       TEXT PRIMARY KEY,
  role          TEXT NOT NULL,                 -- owner | member（admin 以后再加）
  rights        TEXT,                          -- JSON，管理员权限位（以后）
  joined_at     INTEGER NOT NULL,
  left_seq      INTEGER,                       -- 非 NULL 即前成员：可读到这条（自己离开的服务消息）为止
  last_read_seq INTEGER NOT NULL DEFAULT 0     -- 已读回执来源；只在私聊中维护
) STRICT, WITHOUT ROWID;

CREATE TABLE messages (
  seq        INTEGER PRIMARY KEY,              -- rowid 别名，会话内单调递增，决定顺序
  pts        INTEGER NOT NULL,                 -- 最近一次变更的 chat_pts（新建/编辑/撤回/回应）
  sender_id  TEXT NOT NULL,
  random_id  INTEGER NOT NULL,                 -- 客户端随机整数（JS 安全整数范围），用于发送幂等
  date       INTEGER NOT NULL,
  edit_date  INTEGER,
  kind       TEXT NOT NULL,                    -- text | media | service | recalled（撤回的墓碑，内容已清空，保留 pts 供同步）| cipher（秘密聊天）
  text       TEXT,                             -- 秘密聊天的消息为密文
  action     TEXT,                             -- JSON：服务消息的动作（建群、加人、移除、退出、凭链接加入、改名、置顶）
  entities   TEXT,                             -- JSON：MessageEntity[]，目前只有提及 {type, offset, length, user_id}（不存 HTML）
  media      TEXT,                             -- JSON：相册的 (Photo | Video)[]、一个 MediaFile 或一个 Voice，见 05
  reply_to   INTEGER,
  fwd_from   TEXT,                             -- JSON：转发来源 {user_id, date}，最初的发送者与时间，多次转发也不变
  preview    TEXT,                             -- JSON：链接预览 LinkPreview，只有纯链接的文本消息可能有，见 05 § 链接预览
  reactions  TEXT,                             -- JSON：{emoji: [user_id…]}，按 REACTIONS 的顺序；没有回应为 NULL。秘密聊天为 {user_id: 密文}
  pinned_at  INTEGER                           -- 置顶的时间；没有置顶为 NULL
) STRICT;

CREATE INDEX messages_by_pts ON messages(pts);
CREATE INDEX messages_pinned ON messages(pinned_at) WHERE pinned_at IS NOT NULL;  -- 部分索引：只含置顶着的消息

CREATE TABLE commits (                         -- 秘密聊天的 MLS 提交：每个纪元一行（纪元 1 为创建，只有 Welcome）
  epoch     INTEGER PRIMARY KEY,
  sender_id TEXT NOT NULL, device_id TEXT NOT NULL, date INTEGER NOT NULL,
  data      TEXT,                              -- 提交（base64）；创建时为 NULL
  welcome   TEXT,                              -- 加入了设备时的 Welcome，只发给被加入的设备
  adds      TEXT NOT NULL, removes TEXT NOT NULL  -- JSON：加入的 {user_id, device_id}、移除的 device_id
) STRICT;

CREATE TABLE fanout_outbox (                   -- 扇出重试队列：仅在扇出 RPC 失败时写入
  id        INTEGER PRIMARY KEY,
  user_id   TEXT NOT NULL,
  events    TEXT NOT NULL,                     -- JSON 批
  attempts  INTEGER NOT NULL,
  next_at   INTEGER NOT NULL
) STRICT;
```

- **新消息 = 2 行写入**：`messages` 本身 1 行，加 `messages_by_pts` 索引 1 行。
- **幂等不建唯一索引**：服务端去重只覆盖**最近 10 分钟**。先查内存里的 LRU，冷启动时按 `date > now − 10min` 扫描尾部消息，只消耗读额度。
  - 更久之前的重发由客户端负责对账（见 [03 § 发送消息](./03-sync-protocol.md#发送消息)）。
  - 服务端返回给**发送者本人**的消息会带上 `random_id`，供客户端对账使用；返回给其他成员的消息不包含该字段。
- **服务消息**（入群、改名、置顶……）就是普通消息（`kind = service`），天然进入同一个同步流。动作存成结构化 JSON（`action`），文案由客户端渲染。
- **群组**：ID 为 `g:{16 字节随机数的 base64url}`，由建群的客户端生成，重放建群请求不会建出第二个群。群组没有单独的"创建"表，`info` + `members` + 一条 `chat_create` 服务消息即全部状态。
- **前成员**不删除 `members` 行，只写 `left_seq`：`history` / `diff` 对前成员只返回 `seq ≤ left_seq` 的消息（`diff` 的同步位置仍推进到最新，见 [03 § 前成员与重新加入](./03-sync-protocol.md#前成员与重新加入)）。成员人数上限只统计 `left_seq IS NULL` 的行。
- **回应**直接存在 `messages.reactions` 的 JSON 里（`{emoji: [user_id…]}`）。群组最多 20 人，所以不需要单独建表。回应改写消息行并更新 `pts`（2 行写入），与编辑相同；撤回时一并清空。
- **提及**存在 `entities` 里，只在群组里有效：`ChatDO` 去掉对象不是当前成员（或是发送者自己）、越界、重叠的实体，文字照样保留。扇出新消息时附带被提及的人（`mentioned`，含被回复消息的发送者），成员的 `UserDO` 据此记未读提及。
- **转发**来的消息是转发者自己的新消息（新的 `seq`、`random_id`），带 `fwd_from`，不带回复引用；不能编辑，可以撤回。文本的提及原样保留但不算提及；媒体是服务端复制的副本（见 [05 § 消息模型](./05-media.md#消息模型)）。
- **置顶消息**是消息行上的 `pinned_at`，置顶与取消置顶都像编辑一样改写消息并更新 `pts`，经 `update_message` 扇出，离线设备由 `sync.chat` 补齐；成员的 `UserDO` 不写对话行（摘要不变）。部分索引只含置顶着的消息（每个会话最多 `MAX_PINNED_MESSAGES` = 10 条），其他写入不受影响；`sync.chat` 用它返回当前置顶列表，客户端据此拉取本地没有的置顶消息。置顶时另追加一条 `message_pin` 服务消息，记下被置顶消息的摘要；取消置顶不产生服务消息，撤回的消息自动取消置顶。
- **一对一通话**的状态（响铃或已接听、两端的设备、响铃超时或断线认领的期限）存在私聊 `ChatDO` 的 `info.call` 里，结束时删除并留下一条 `call` 服务消息作为通话记录；双方 `UserDO` 的 `meta.call` 记下自己当前的通话与它所在的设备。见 [04 § 通话](./04-realtime-and-fanout.md#通话)。
- **群组通话**的房间状态（发起者、通话记录的 `seq`、加入过的人、每个参与者的设备、SFU session、已发布的媒体、静音与掉线时间）存在群组 `ChatDO` 的 `info.group_call` 里，每次变化 1 行；最后一人离开时删除，并把发起时写的 `group_call` 服务消息改写为带时长的记录。参与者的 `meta.call` 与一对一通话共用。见 [04 § 群组通话](./04-realtime-and-fanout.md#群组通话)。
- **不做服务端全文搜索**：搜索完全在客户端本地完成（见下文）。
- **秘密聊天**：ID 为 `s:{小 uid}:{大 uid}:{16 字节随机数的 base64url}`，双方同时最多一个。消息、编辑与回应都是密文，存法与普通消息相同（新消息 2 行写入），同步、分页、`too_long` 照旧；提交另存 `commits`，每次 1 行，外加 `info.secret` 1 行与一条 `secret_devices` 服务消息（有设备加入时）。删除对双方生效：删掉消息、提交与加密的媒体，留下成员与 `deleted` 标记。见 [ADR-0010](../adr/0010-secret-chats-multi-device-mls.md) 与 [06 § 端到端加密](./06-auth-and-security.md#端到端加密)。

## 客户端 SQLite（OPFS）

```sql
CREATE TABLE kv (key TEXT PRIMARY KEY, value ANY) STRICT;       -- user_pts、settings、created_at（本地库建立的时间）
CREATE TABLE dialogs (… 与服务端 dialogs 同构，预览拆成列（top_text / top_count / top_videos / top_duration …），另存 peer_id；deleted 直接删行；草稿另存 drafts …);
CREATE TABLE drafts (                          -- 草稿：先写本地，离开会话或页面转入后台时同步
  chat_id TEXT PRIMARY KEY, text TEXT, reply_to INTEGER,
  dirty INTEGER                                -- 1：本地修改还没被服务端确认，不被服务端的旧值覆盖；
);                                             -- 还没有对话行的会话（没有消息的私聊）也可以有，对话行出现后再同步
CREATE TABLE chat_members (chat_id, user_id, role, joined_at);  -- 群组当前成员，打开群组时由 chats.get 刷新
CREATE TABLE chats (                           -- 会话的本地同步状态（打开过的会话才有）
  chat_id TEXT PRIMARY KEY,
  pts     INTEGER,                             -- local_chat_pts：本地已同步到的 chat_pts
  min_seq INTEGER                              -- 从 min_seq 到最新一条，本地消息连续；1 表示已到开头。
                                               -- 更早的行只是回复引用或被编辑过的旧消息，消息列表不显示
);
CREATE TABLE messages (
  chat_id TEXT, seq INTEGER, pts INTEGER, …,
  search_body TEXT GENERATED ALWAYS AS (…) VIRTUAL,  -- 可搜索的内容：文本正文（连同链接预览的标题）、文件消息的文件名，其余为 NULL
  PRIMARY KEY (chat_id, seq)
) WITHOUT ROWID;
CREATE TABLE outbox (                          -- 待发送：离线可写；同一会话按 created_at（本地单调递增）逐条发送
  random_id INTEGER PRIMARY KEY, chat_id TEXT, kind TEXT,  -- text | media
  text TEXT, media TEXT,                       -- media：OPFS 里暂存的文件名，上传成功后记下对象键
  link TEXT,                                   -- 纯链接的文本消息的卡片：pending（发送时再抓）或 ready（卡片图片同样暂存在 OPFS）
  reply_to INTEGER, state TEXT, error TEXT,               -- state：pending | failed；error：服务端拒绝的原因（blocked）
  created_at INTEGER
);
CREATE TABLE played (chat_id TEXT, seq INTEGER, PRIMARY KEY (chat_id, seq));  -- 本设备播放过的语音消息；别人发来、
                                               -- kv.created_at 之后发来、又不在这里的就是未听（只在本地，不同步）
CREATE TABLE users (…);                        -- 资料缓存（对方自己的名字）
CREATE TABLE relations (user_id, contact, alias, blocked);  -- 与服务端同构；墓碑直接删行
CREATE VIEW people AS …;                       -- users + relations：name 为备注名或对方的名字，显示名字都读它
CREATE TABLE stickers (key, mime, w, h, size, thumbhash, added_at);  -- 我的贴纸，与服务端同构；墓碑直接删行
CREATE TABLE search (                          -- 可搜索的消息，由 messages 上的触发器维护
  id INTEGER PRIMARY KEY, chat_id TEXT, seq INTEGER, body TEXT,
  UNIQUE (chat_id, seq)
);
CREATE VIRTUAL TABLE search_fts USING fts5(body, content='search', content_rowid='id', tokenize='trigram');
CREATE TABLE media_cache (key TEXT PRIMARY KEY, bytes INTEGER, last_used INTEGER);
CREATE TABLE secret_keys (ref TEXT PRIMARY KEY, private BLOB, last_resort INTEGER);  -- 本设备 KeyPackage 的私钥（包了一层）
CREATE TABLE secret_groups (chat_id TEXT PRIMARY KEY, epoch INTEGER, join_epoch INTEGER, state BLOB);  -- MLS 状态（包了一层）
CREATE TABLE secret_epochs (chat_id TEXT, epoch INTEGER, key BLOB, leaves TEXT, PRIMARY KEY (chat_id, epoch));  -- 各纪元的消息密钥（包了一层）与组里的设备
```

- 本地写入不计费，所以客户端可以随意建索引和 FTS。
- **秘密聊天的消息**先按服务端的样子存：还没解开的内容在 `messages.cipher`（消息密文与每人的回应密文），新消息解开前 `kind = cipher`；解开后换成明文的 `text` / `media`，本设备加入之前的为 `sealed`（不显示，会话里在分界之后读得到的第一条上方说明一句，全都读不了时作为空状态的说明），验证失败的为 `broken`。`cipher` 超过 10 秒还没解开时，占位文字从 "Decrypting…" 换成在等本设备拿到密钥的说明。已经解开的消息被编辑或有新回应时，解开之前照旧显示原来的明文。
- 本地库文件按用户命名（`/u-{user_id}.sqlite3`），打开时删除池中其他用户的文件；表结构版本记在 `PRAGMA user_version`，按 [§ 表结构迁移](#表结构迁移) 增量升级。
- 从未打开过的会话不保存消息：推送来的新消息只更新对话列表摘要，打开时再 `sync.chat`。
- **搜索索引**：`messages` 是 `WITHOUT ROWID` 表，FTS5 不能直接以它为外部内容表，所以中间隔一张有 rowid 的 `search`。`messages` 的插入、删除，以及可搜索内容变化（编辑、撤回）时，触发器同步 `search`；`search` 的触发器再同步 `search_fts`。同步时原样覆盖的消息不会重建索引。
- `trigram` 分词器支持中文子串搜索（≥3 个码点）；更短的关键词退化为 `LIKE`。

## 数据生命周期

| 事件 | 处理 |
| --- | --- |
| 撤回消息 | `kind = recalled`，清空内容，更新 `pts`；媒体对象由 `ChatDO` 立即删除（失败的只记日志） |
| 退出 / 被移除 | `ChatDO.members.left_seq` 记下离开的服务消息；`UserDO.dialogs.status = left`（只读对话）。群主退出时群主身份转给最早入群的成员 |
| 删除对话 | 只适用于只读对话：`UserDO.dialogs.status = deleted`（墓碑行保留，供其他设备同步删除），客户端删除本地消息 |
| 解散会话 / 删除账号 | 启动 `PurgeWorkflow`：逐个成员移除对话、删除 R2 对象、最后调用 `ctx.storage.deleteAll()`。每一步都是可重试的 Workflow step |
| 自毁消息（第三阶段） | `ChatDO` 设置 Alarm 到期删除 |
