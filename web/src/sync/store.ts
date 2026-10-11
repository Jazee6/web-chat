// 本地库：表结构与读写。只在同步 Worker 中使用，UI 通过 query 操作只读访问。
// 见 docs/architecture/02-data-model.md § 客户端 SQLite
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  MAX_RECENT_CALLS,
  MUTE_FOREVER,
  chatPair,
  messageUserIds,
  type CallLog,
  type ChatInfo,
  type Dialog,
  type DialogPreview,
  type Draft,
  type LinkPreview,
  type Media,
  type Message,
  type MessageEntity,
  type PHOTO_MIME_TYPES,
  type PREVIEW_MIME_TYPES,
  type Relation,
  type SealedMedia,
  type Settings,
  type STICKER_MIME_TYPES,
  type StickerChange,
  type UserProfile,
  type VOICE_MIME_TYPES,
} from 'shared/protocol'
import { topics, type PreparedPreview, type Row } from './bridge'

/** 还没解开的秘密聊天消息：cipher 为消息的密文，reactions 为每人加密的回应 */
export type CipherRow = {
  chat_id: string
  seq: number
  pts: number
  sender_id: string
  edit_date: number | null
  cipher: string
  reactions: Record<string, string> | null
}

/** v1 的表结构：1.0 发布之前仍可直接修改，之后只能在 MIGRATIONS 末尾追加新的步骤（见 docs/adr/0013） */
const V1 = [
  `CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value ANY
  ) STRICT, WITHOUT ROWID`,
  // peer_id 只有私聊与秘密聊天有；status 为 member 或 left（只读对话），删除对话直接删行。
  // 秘密聊天的摘要在解开之前 top_kind 为 cipher、top_text 为密文，解开后换成明文的摘要
  // pinned_rank 越大越靠前；muted_until 为静音到期的毫秒时间戳，与当前时间比较（见 MUTE_FOREVER）。
  // unread_mentions 为服务端记下的未读提及（seq 的 JSON 数组），查询时再与本地的 last_read_seq 比较
  `CREATE TABLE dialogs (
    chat_id       TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    title         TEXT,
    status        TEXT NOT NULL,
    peer_id       TEXT,
    pts           INTEGER NOT NULL,
    top_seq       INTEGER NOT NULL,
    top_sender_id TEXT,
    top_kind      TEXT,
    top_text      TEXT,
    top_count     INTEGER,
    top_videos    INTEGER,
    top_duration  INTEGER,
    top_action    TEXT,
    top_date      INTEGER,
    chat_pts      INTEGER NOT NULL,
    last_read_seq INTEGER NOT NULL,
    peer_read_seq INTEGER NOT NULL,
    pinned_rank   INTEGER,
    muted_until   INTEGER NOT NULL,
    unread_mentions TEXT
  ) STRICT, WITHOUT ROWID`,
  // 草稿：先写本地，再同步给服务端。dirty 为 1 表示本地的修改还没被服务端确认，此时不被服务端的旧值覆盖；
  // 清除草稿而尚未确认时，行保留为空草稿（text 为空、reply_to 为 NULL）。
  // 没有对话行的会话（例如还没有消息的私聊）也可以有草稿，等对话行出现后再同步
  `CREATE TABLE drafts (
    chat_id  TEXT PRIMARY KEY,
    text     TEXT NOT NULL,
    reply_to INTEGER,
    dirty    INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 会话的本地同步状态：pts 为本地已同步到的 chat_pts；min_seq 起到最新一条的消息在本地连续
  `CREATE TABLE chats (
    chat_id TEXT PRIMARY KEY,
    pts     INTEGER NOT NULL,
    min_seq INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 秘密聊天的消息：还没解开的内容放在 cipher，新消息解开之前 kind 为 cipher；解开后换成明文的 text / media，
  // 解不开的：本设备加入之前的为 sealed（不显示），验证失败的为 broken。
  // 已经解开的消息被编辑或有了新的回应时，解开之前照旧显示原来的明文
  `CREATE TABLE messages (
    chat_id   TEXT NOT NULL,
    seq       INTEGER NOT NULL,
    pts       INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    date      INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    text      TEXT,
    -- 提及（MessageEntity[] 的 JSON）；没有为 NULL
    entities  TEXT,
    media     TEXT,
    action    TEXT,
    reply_to  INTEGER,
    edit_date INTEGER,
    random_id INTEGER,
    -- 回应（Reactions 的 JSON）；没有回应为 NULL
    reactions TEXT,
    -- 置顶的时间；没有置顶为 NULL
    pinned_at INTEGER,
    -- 转发来源（ForwardFrom 的 JSON）；不是转发来的为 NULL
    fwd_from  TEXT,
    -- 链接预览（LinkPreview 的 JSON）；没有为 NULL
    preview   TEXT,
    -- 秘密聊天里还没解开的内容：{ cipher, reactions }（消息的密文与每人加密的回应）的 JSON；解开后为 NULL
    cipher    TEXT,
    -- 可被搜索的内容：文本消息的正文（连同链接预览的标题）、文件消息的文件名；其余为 NULL。
    -- 秘密聊天的明文不进搜索索引
    search_body TEXT GENERATED ALWAYS AS (
      CASE
        WHEN chat_id GLOB 's:*' THEN NULL
        WHEN kind = 'text' THEN text || coalesce(' ' || json_extract(preview, '$.title'), '')
        WHEN kind = 'media' AND json_extract(media, '$[0].type') = 'file' THEN json_extract(media, '$[0].name')
      END
    ) VIRTUAL,
    PRIMARY KEY (chat_id, seq)
  ) STRICT, WITHOUT ROWID`,
  'CREATE INDEX messages_by_random_id ON messages (random_id) WHERE random_id IS NOT NULL',
  'CREATE INDEX messages_pinned ON messages (chat_id, pinned_at) WHERE pinned_at IS NOT NULL',
  'CREATE INDEX messages_cipher ON messages (chat_id, seq) WHERE cipher IS NOT NULL',
  // 本地全文搜索：messages 没有 rowid，FTS 不能直接以它为外部内容表，
  // 由触发器把可搜索的消息同步到 search，再由 search 同步到 FTS 索引（trigram：支持中文子串，≥3 个字符）
  `CREATE TABLE search (
    id      INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    body    TEXT NOT NULL,
    UNIQUE (chat_id, seq)
  ) STRICT`,
  "CREATE VIRTUAL TABLE search_fts USING fts5(body, content='search', content_rowid='id', tokenize='trigram')",
  `CREATE TRIGGER search_ai AFTER INSERT ON search BEGIN
    INSERT INTO search_fts (rowid, body) VALUES (new.id, new.body);
  END`,
  `CREATE TRIGGER search_ad AFTER DELETE ON search BEGIN
    INSERT INTO search_fts (search_fts, rowid, body) VALUES ('delete', old.id, old.body);
  END`,
  `CREATE TRIGGER messages_search_ai AFTER INSERT ON messages WHEN new.search_body IS NOT NULL BEGIN
    INSERT INTO search (chat_id, seq, body) VALUES (new.chat_id, new.seq, new.search_body);
  END`,
  // 同步时同一条消息常被原样覆盖，只在可搜索内容变化（编辑、撤回）时重建索引
  `CREATE TRIGGER messages_search_au AFTER UPDATE OF kind, text, media, preview ON messages
    WHEN old.search_body IS NOT new.search_body BEGIN
    DELETE FROM search WHERE chat_id = old.chat_id AND seq = old.seq;
    INSERT INTO search (chat_id, seq, body) SELECT new.chat_id, new.seq, new.search_body WHERE new.search_body IS NOT NULL;
  END`,
  `CREATE TRIGGER messages_search_ad AFTER DELETE ON messages WHEN old.search_body IS NOT NULL BEGIN
    DELETE FROM search WHERE chat_id = old.chat_id AND seq = old.seq;
  END`,
  // 发件箱：state 为 pending（等待发送或发送中）或 failed（发送失败，等待手动重试）。
  // 同一会话按 created_at 逐条发送，created_at 在本地单调递增。
  // 媒体消息的 media 为 OutboxMedia[]（JSON）：文件暂存在 OPFS，上传成功后记下对象键。
  // 纯链接的文本消息的 link 为 OutboxLink（JSON），没有卡片为 NULL。
  // error 为服务端拒绝的原因（目前只有 blocked），其他失败为 NULL
  `CREATE TABLE outbox (
    random_id  INTEGER PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    text       TEXT,
    entities   TEXT,
    media      TEXT,
    link       TEXT,
    reply_to   INTEGER,
    state      TEXT NOT NULL,
    error      TEXT,
    created_at INTEGER NOT NULL
  ) STRICT`,
  'CREATE INDEX outbox_by_chat ON outbox (chat_id, created_at)',
  // 本设备上播放过的语音消息；别人发来、本地库建立之后（kv.created_at）发来、又不在这里的就是未听
  `CREATE TABLE played (
    chat_id TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    PRIMARY KEY (chat_id, seq)
  ) STRICT, WITHOUT ROWID`,
  // 群组的当前成员，打开群组时由 chats.get 刷新
  `CREATE TABLE chat_members (
    chat_id   TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    role      TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE users (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    image TEXT
  ) STRICT, WITHOUT ROWID`,
  // 与其他用户的关系：联系人（及备注名）、拉黑。服务端的墓碑行在本地直接删除
  `CREATE TABLE relations (
    user_id TEXT PRIMARY KEY,
    contact INTEGER NOT NULL,
    alias   TEXT,
    blocked INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 最近通话：只增不改，超过 MAX_RECENT_CALLS 的删掉（服务端按同样的规则删，不发墓碑）
  `CREATE TABLE calls (
    call_id   TEXT PRIMARY KEY,
    chat_id   TEXT NOT NULL,
    seq       INTEGER NOT NULL,
    peer_id   TEXT NOT NULL,
    caller_id TEXT NOT NULL,
    result    TEXT NOT NULL,
    duration  INTEGER NOT NULL,
    date      INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 我的贴纸：key 为贴纸在 s/ 下的键，added_at 越大越靠前。服务端的墓碑在本地直接删除
  `CREATE TABLE stickers (
    key       TEXT PRIMARY KEY,
    mime      TEXT NOT NULL,
    w         INTEGER NOT NULL,
    h         INTEGER NOT NULL,
    size      INTEGER NOT NULL,
    thumbhash TEXT NOT NULL,
    added_at  INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 秘密聊天本设备的 KeyPackage 私钥：ref 与服务端的对应，private 为包了一层的 PrivateKeyPackage 与公开部分。
  // 一次性的被用来加入后删掉；最后备用的一直留着
  `CREATE TABLE secret_keys (
    ref         TEXT PRIMARY KEY,
    private     BLOB NOT NULL,
    last_resort INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 秘密聊天在本设备上的 MLS 状态（包了一层）：epoch 为当前纪元，join_epoch 为本设备加入时的纪元
  `CREATE TABLE secret_groups (
    chat_id    TEXT PRIMARY KEY,
    epoch      INTEGER NOT NULL,
    join_epoch INTEGER NOT NULL,
    state      BLOB NOT NULL
  ) STRICT, WITHOUT ROWID`,
  // 秘密聊天每个纪元的消息密钥（包了一层）与组里的设备（验证签名用：叶子序号 → user_id、device_id、签名公钥）
  `CREATE TABLE secret_epochs (
    chat_id TEXT NOT NULL,
    epoch   INTEGER NOT NULL,
    key     BLOB NOT NULL,
    leaves  TEXT NOT NULL,
    PRIMARY KEY (chat_id, epoch)
  ) STRICT, WITHOUT ROWID`,
  // 显示用的用户资料：name 为备注名（有的话）或对方自己的名字，own_name 总是对方自己的名字。
  // 界面上凡是显示别人名字的地方都读这个视图
  `CREATE VIEW people AS
    SELECT u.id, coalesce(r.alias, u.name) AS name, u.name AS own_name, u.image,
      coalesce(r.contact, 0) AS contact, coalesce(r.blocked, 0) AS blocked
    FROM users u LEFT JOIN relations r ON r.user_id = u.id`,
]

/** 表结构迁移：第 i 项把版本 i 升到 i + 1 */
const MIGRATIONS: readonly (readonly string[])[] = [V1]
const SCHEMA_VERSION = MIGRATIONS.length

export type ChatState = { pts: number; min_seq: number }

/**
 * 发件箱里的一个媒体：file / preview 为 OPFS 中暂存的文件名（视频的 preview 为封面），key / preview_key 在上传成功后写入。
 * 秘密聊天的 secret 为加密上传用的密钥，上传之前生成并存下，重启后续传的部分用同一把。
 * 贴纸的 source 为我的贴纸里的键：普通会话直接发它，不上传；秘密聊天把它取回暂存为 file，加密后上传。
 * 其余字段与发送时的 Media 相同
 */
export type OutboxMedia = { secret?: string } & (
  | {
      type: 'photo'
      file: string
      mime: (typeof PHOTO_MIME_TYPES)[number]
      size: number
      preview: string
      preview_mime: (typeof PREVIEW_MIME_TYPES)[number]
      preview_size: number
      w: number
      h: number
      thumbhash: string
      key?: string
      preview_key?: string
    }
  | {
      type: 'video'
      file: string
      size: number
      preview: string
      preview_mime: (typeof PREVIEW_MIME_TYPES)[number]
      preview_size: number
      w: number
      h: number
      duration: number
      thumbhash: string
      key?: string
      preview_key?: string
    }
  | { type: 'file'; file: string; name: string; mime: string; size: number; key?: string }
  | {
      type: 'voice'
      file: string
      mime: (typeof VOICE_MIME_TYPES)[number]
      size: number
      duration: number
      waveform: string
      key?: string
    }
  | {
      type: 'sticker'
      source: string
      file?: string
      mime: (typeof STICKER_MIME_TYPES)[number]
      w: number
      h: number
      size: number
      thumbhash: string
      key?: string
    }
)

export type OutboxVoice = Extract<OutboxMedia, { type: 'voice' }>

/** 发件箱里链接预览卡片的图片：暂存在 OPFS（文件名 file），上传成功后写入 key */
export type OutboxLinkPhoto = {
  file: string
  mime: (typeof PREVIEW_MIME_TYPES)[number]
  size: number
  w: number
  h: number
  thumbhash: string
  key?: string
}

/**
 * 发件箱里的链接预览：pending 表示输入时还没抓到，发送时由同步 Worker 抓取（有时限，抓不到就发成只有域名的卡片）；
 * ready 为已经准备好的卡片
 */
export type OutboxLink = { state: 'pending' } | { state: 'ready'; preview: PreparedPreview; photo?: OutboxLinkPhoto }

type OutboxBase = {
  random_id: number
  chat_id: string
  reply_to: number | null
  state: 'pending' | 'failed'
  created_at: number
}
type OutboxContent =
  | { kind: 'text'; text: string; entities: MessageEntity[] | null; link: OutboxLink | null }
  | { kind: 'media'; media: OutboxMedia[] }
export type OutboxRow = OutboxBase & OutboxContent
export type NewOutboxRow = Omit<OutboxBase, 'state' | 'created_at'> & OutboxContent

function isEmptyDraft(d: Draft) {
  return d.text === '' && d.reply_to === null
}

function sameDraft(a: Draft | null, b: Draft | null) {
  return a === b || (a !== null && b !== null && a.text === b.text && a.reply_to === b.reply_to)
}

/** 本地库存的 media 是 JSON 字符串 */
function toOutboxRow(row: Row): OutboxRow {
  const base = row as unknown as OutboxBase & {
    kind: string
    text: string | null
    entities: string | null
    media: string | null
    link: string | null
  }
  return base.kind === 'media'
    ? { ...base, kind: 'media', media: JSON.parse(base.media!) as OutboxMedia[] }
    : {
        ...base,
        kind: 'text',
        text: base.text!,
        entities: base.entities ? (JSON.parse(base.entities) as MessageEntity[]) : null,
        link: base.link ? (JSON.parse(base.link) as OutboxLink) : null,
      }
}

/** 秘密聊天里已加密上传的媒体，连同密钥（图片还有格式：加密对象的键名看不出来）；有未上传的返回 null */
export function sealedMedia(items: OutboxMedia[]): SealedMedia[] | null {
  const media = uploadedMedia(items)
  if (!media || items.some((m) => !m.secret)) return null
  return media.map((m, i) => {
    const item = items[i]!
    return { ...m, secret: item.secret!, ...(item.type === 'photo' ? { mime: item.mime } : {}) } as SealedMedia
  })
}

/** 已上传的媒体转换为发送用的 Media；有未上传的返回 null */
export function uploadedMedia(items: OutboxMedia[]): Media[] | null {
  const media: Media[] = []
  for (const m of items) {
    if (!m.key) return null
    switch (m.type) {
      case 'file':
        media.push({ type: 'file', key: m.key, name: m.name, mime: m.mime, size: m.size })
        break
      case 'voice':
        media.push({ type: 'voice', key: m.key, mime: m.mime, size: m.size, duration: m.duration, waveform: m.waveform })
        break
      case 'sticker':
        media.push({ type: 'sticker', key: m.key, mime: m.mime, w: m.w, h: m.h, size: m.size, thumbhash: m.thumbhash })
        break
      case 'photo':
        if (!m.preview_key) return null
        media.push({ type: 'photo', key: m.key, preview_key: m.preview_key, w: m.w, h: m.h, size: m.size, thumbhash: m.thumbhash })
        break
      case 'video': {
        if (!m.preview_key) return null
        const { key, preview_key, w, h, size, duration, thumbhash } = m
        media.push({ type: 'video', key, preview_key, w, h, size, duration, thumbhash })
      }
    }
  }
  return media
}

/**
 * 把本地库迁移到当前版本，只执行比版本号新的步骤。版本号为 0 是新建的库（首次登录、换了账号、OPFS 被浏览器清掉）。
 * 版本号比代码新，说明更新的标签页已经迁移过：不碰本地库，返回 false，由调用方重载页面
 */
export function migrate(db: Database): boolean {
  const version = db.selectValue('PRAGMA user_version') as number
  if (version > SCHEMA_VERSION) return false
  if (version === SCHEMA_VERSION) return true
  db.transaction(() => {
    for (const step of MIGRATIONS.slice(version)) for (const sql of step) db.exec(sql)
    // 本地库建立的时间：在这之前发来的语音不算未听
    if (version === 0) db.exec({ sql: "INSERT INTO kv (key, value) VALUES ('created_at', ?)", bind: [Date.now()] })
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
  return true
}

/** 本地库是否完好：浏览器可能在运行中清掉 OPFS，之后的读写都会报 no such table */
export function intact(db: Database): boolean {
  try {
    return db.selectValue('PRAGMA user_version') === SCHEMA_VERSION
  } catch {
    return false
  }
}

/** 定时器的最大延迟（约 24.8 天），更久的会立即触发 */
const MAX_TIMER_MS = 2 ** 31 - 1

export class Store {
  private changed = new Set<string>()
  private depth = 0
  /** 最近一次静音到期时刷新对话列表：静音是否生效由查询时的当前时间决定，到期本身不改动本地库 */
  private muteTimer: ReturnType<typeof setTimeout> | undefined

  private readonly db: Database
  private readonly me: string
  private readonly onChange: (topics: string[]) => void

  constructor(db: Database, me: string, onChange: (topics: string[]) => void) {
    this.db = db
    this.me = me
    this.onChange = onChange
  }

  /** 事务结束后一次性广播受影响的主题 */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.depth++
    try {
      return this.db.transaction(() => fn())
    } finally {
      this.depth--
      if (this.changed.size > 0) {
        const list = [...this.changed]
        this.changed.clear()
        if (list.includes(topics.dialogs)) this.scheduleMuteExpiry()
        this.onChange(list)
      }
    }
  }

  /** 永久静音不会到期；定时器触发后再找下一个 */
  scheduleMuteExpiry() {
    clearTimeout(this.muteTimer)
    const now = Date.now()
    const next = this.db.selectValue('SELECT min(muted_until) FROM dialogs WHERE muted_until > ? AND muted_until < ?', [
      now,
      MUTE_FOREVER,
    ])
    if (next === undefined || next === null) return
    this.muteTimer = setTimeout(
      () => {
        this.scheduleMuteExpiry()
        this.onChange([topics.dialogs])
      },
      Math.min(Number(next) - now, MAX_TIMER_MS),
    )
  }

  private touch(...list: string[]) {
    for (const topic of list) {
      this.changed.add(topic)
      // 任一会话的消息变化都可能影响全局搜索的结果
      if (topic.startsWith('chat:')) this.changed.add(topics.messages)
    }
  }

  query(sql: string, params: unknown[]): Row[] {
    return this.db.selectObjects(sql, params as SqlValue[])
  }

  // ---------- user_pts ----------

  get userPts(): number {
    return Number(this.db.selectValue("SELECT value FROM kv WHERE key = 'user_pts'") ?? 0)
  }

  setUserPts(pts: number) {
    this.db.exec({
      sql: "INSERT INTO kv (key, value) VALUES ('user_pts', ?) ON CONFLICT (key) DO UPDATE SET value = max(value, excluded.value)",
      bind: [pts],
    })
  }

  // ---------- 账号设置 ----------

  /** 完整设置存成 kv 里的一个 JSON，UI 用 json_extract 读取 */
  putSettings(settings: Settings) {
    this.db.exec({
      sql: "INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      bind: [JSON.stringify(settings)],
    })
    this.touch(topics.settings)
  }

  // ---------- 对话 ----------

  /**
   * 合并服务端的对话行。返回 true 表示前成员被重新加入：本地窗口已丢弃，
   * 因为只读期间同步到的 chat_pts 越过了离开期间的消息，需要从头同步
   */
  upsertDialog(d: Dialog): boolean {
    if (d.status === 'deleted') {
      this.deleteChat(d.chat_id)
      return false
    }
    const before = this.db.selectObjects('SELECT status, pts FROM dialogs WHERE chat_id = ?', [d.chat_id])[0]
    const applied = before === undefined || d.pts > Number(before.pts)
    const peer = d.kind !== 'group' ? (chatPair(d.chat_id)?.find((id) => id !== this.me) ?? null) : null
    const p = d.top_preview
    this.db.exec({
      // 已读位置在服务端只前移，本地又会乐观地先前移：取较大值，避免旧的对话行把它拉回去
      sql: `INSERT INTO dialogs (chat_id, kind, title, status, peer_id, pts, top_seq, top_sender_id, top_kind, top_text, top_count, top_videos, top_duration, top_action, top_date, chat_pts, last_read_seq, peer_read_seq, pinned_rank, muted_until, unread_mentions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (chat_id) DO UPDATE SET
              kind = excluded.kind, title = excluded.title, status = excluded.status, pts = excluded.pts,
              top_seq = excluded.top_seq, top_sender_id = excluded.top_sender_id, top_kind = excluded.top_kind, top_text = excluded.top_text,
              top_count = excluded.top_count, top_videos = excluded.top_videos, top_duration = excluded.top_duration, top_action = excluded.top_action, top_date = excluded.top_date, chat_pts = excluded.chat_pts,
              last_read_seq = max(dialogs.last_read_seq, excluded.last_read_seq),
              peer_read_seq = max(dialogs.peer_read_seq, excluded.peer_read_seq),
              pinned_rank = excluded.pinned_rank, muted_until = excluded.muted_until, unread_mentions = excluded.unread_mentions
            WHERE excluded.pts > dialogs.pts`,
      bind: [
        d.chat_id, d.kind, d.title, d.status, peer, d.pts, d.top_seq,
        p?.sender_id ?? null,
        p?.kind ?? null,
        p?.kind === 'text' ? p.text : p?.kind === 'file' ? p.name : p?.kind === 'cipher' ? p.cipher : null,
        p?.kind === 'album' ? p.count : null,
        p?.kind === 'album' ? (p.videos ?? null) : null,
        p?.kind === 'voice' ? p.duration : p?.kind === 'album' ? (p.duration ?? null) : null,
        p?.kind === 'service' ? JSON.stringify(p.action) : null,
        p?.date ?? null,
        d.chat_pts, d.last_read_seq, d.peer_read_seq, d.pinned_rank, d.muted_until,
        d.unread_mentions.length > 0 ? JSON.stringify(d.unread_mentions) : null,
      ],
    })
    this.touch(topics.dialogs)
    // 只读对话没有输入框，也就没有草稿
    if (applied && d.status === 'member') this.putServerDraft(d.chat_id, d.draft)
    else if (applied) this.discardDraft(d.chat_id)
    if (!applied || before?.status !== 'left' || d.status !== 'member') return false
    for (const table of ['chats', 'messages']) this.db.exec({ sql: `DELETE FROM ${table} WHERE chat_id = ?`, bind: [d.chat_id] })
    this.touch(topics.chat(d.chat_id))
    return true
  }

  /** 删除对话：连同本地消息、同步状态与成员一起删除 */
  private deleteChat(chatId: string) {
    for (const table of ['dialogs', 'messages', 'chats', 'chat_members', 'outbox', 'drafts', 'played', 'secret_groups', 'secret_epochs']) {
      this.db.exec({ sql: `DELETE FROM ${table} WHERE chat_id = ?`, bind: [chatId] })
    }
    this.touch(topics.dialogs, topics.outbox, topics.drafts, topics.chat(chatId), topics.members(chatId))
  }

  // ---------- 草稿 ----------

  /** 服务端的草稿：本地有未确认的修改时以本地为准 */
  private putServerDraft(chatId: string, draft: Draft | null) {
    if (this.db.selectValue('SELECT dirty FROM drafts WHERE chat_id = ?', [chatId]) === 1) return
    if (draft) {
      this.db.exec({
        sql: `INSERT INTO drafts (chat_id, text, reply_to, dirty) VALUES (?, ?, ?, 0)
              ON CONFLICT (chat_id) DO UPDATE SET text = excluded.text, reply_to = excluded.reply_to`,
        bind: [chatId, draft.text, draft.reply_to],
      })
    } else {
      this.db.exec({ sql: 'DELETE FROM drafts WHERE chat_id = ?', bind: [chatId] })
    }
    this.touch(topics.drafts)
  }

  /** 当前草稿；空草稿视为没有 */
  draft(chatId: string): { draft: Draft | null; dirty: boolean } | null {
    const row = this.db.selectObjects('SELECT text, reply_to, dirty FROM drafts WHERE chat_id = ?', [chatId])[0]
    if (!row) return null
    const draft = { text: row.text as string, reply_to: (row.reply_to as number | null) ?? null }
    return { draft: isEmptyDraft(draft) ? null : draft, dirty: row.dirty === 1 }
  }

  /** 本机改了草稿：内容有变化时记为未确认，返回 true */
  setDraft(chatId: string, draft: Draft | null): boolean {
    const next = draft && !isEmptyDraft(draft) ? draft : null
    if (sameDraft(this.draft(chatId)?.draft ?? null, next)) return false
    this.db.exec({
      sql: `INSERT INTO drafts (chat_id, text, reply_to, dirty) VALUES (?, ?, ?, 1)
            ON CONFLICT (chat_id) DO UPDATE SET text = excluded.text, reply_to = excluded.reply_to, dirty = 1`,
      bind: [chatId, next?.text ?? '', next?.reply_to ?? null],
    })
    this.touch(topics.drafts)
    return true
  }

  /** 服务端确认了 sent：期间没有再改过，就不再是未确认的修改 */
  ackDraft(chatId: string, sent: Draft | null) {
    const cur = this.draft(chatId)
    if (!cur?.dirty || !sameDraft(cur.draft, sent)) return
    if (sent) this.db.exec({ sql: 'UPDATE drafts SET dirty = 0 WHERE chat_id = ?', bind: [chatId] })
    else this.db.exec({ sql: 'DELETE FROM drafts WHERE chat_id = ?', bind: [chatId] })
    this.touch(topics.drafts)
  }

  /** 发出消息：草稿随之清空，服务端在发送时也会清空，不必另行同步 */
  discardDraft(chatId: string) {
    const deleted = this.db.selectValue('DELETE FROM drafts WHERE chat_id = ? RETURNING 1', [chatId])
    if (deleted !== undefined) this.touch(topics.drafts)
  }

  /** 有未确认草稿的会话 */
  dirtyDrafts(): string[] {
    return this.db.selectValues('SELECT chat_id FROM drafts WHERE dirty = 1').map(String)
  }

  /** 乐观地前移已读位置（不超过最新一条）；返回是否前移 */
  advanceRead(chatId: string, seq: number): boolean {
    const changed = this.db.selectValue(
      'UPDATE dialogs SET last_read_seq = min(?1, top_seq) WHERE chat_id = ?2 AND last_read_seq < min(?1, top_seq) RETURNING 1',
      [seq, chatId],
    )
    if (changed === undefined) return false
    this.touch(topics.dialogs)
    return true
  }

  dialogStatus(chatId: string): Dialog['status'] | null {
    return (this.db.selectValue('SELECT status FROM dialogs WHERE chat_id = ?', [chatId]) as Dialog['status'] | undefined) ?? null
  }

  // ---------- 群组成员 ----------

  putMembers(chat: ChatInfo) {
    this.db.exec({ sql: 'DELETE FROM chat_members WHERE chat_id = ?', bind: [chat.chat_id] })
    for (const m of chat.members) {
      this.db.exec({
        sql: 'INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        bind: [chat.chat_id, m.user_id, m.role, m.joined_at],
      })
    }
    this.touch(topics.members(chat.chat_id))
  }

  // ---------- 会话同步状态 ----------

  chatState(chatId: string): ChatState | null {
    const row = this.db.selectObjects('SELECT pts, min_seq FROM chats WHERE chat_id = ?', [chatId])[0]
    return row ? { pts: Number(row.pts), min_seq: Number(row.min_seq) } : null
  }

  setChatState(chatId: string, state: ChatState) {
    this.db.exec({
      sql: `INSERT INTO chats (chat_id, pts, min_seq) VALUES (?, ?, ?)
            ON CONFLICT (chat_id) DO UPDATE SET pts = excluded.pts, min_seq = excluded.min_seq`,
      bind: [chatId, state.pts, state.min_seq],
    })
    this.touch(topics.chat(chatId))
  }

  // ---------- 消息 ----------

  /**
   * 写入或覆盖消息；自己发的消息按 random_id 与发件箱对账。
   * 秘密聊天的密文以同样的 pts 再来一遍时（重新同步）不覆盖已经解开的明文
   */
  putMessages(chatId: string, messages: Message[]) {
    if (messages.length === 0) return
    for (const m of messages) {
      if (m.kind === 'cipher') {
        this.putCipher(chatId, m)
        continue
      }
      this.db.exec({
        sql: `INSERT INTO messages (chat_id, seq, pts, sender_id, date, kind, text, entities, media, action, reply_to, edit_date, random_id, reactions, pinned_at, fwd_from, preview)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (chat_id, seq) DO UPDATE SET
                pts = excluded.pts, kind = excluded.kind, text = excluded.text, entities = excluded.entities, media = excluded.media,
                action = excluded.action,
                reply_to = excluded.reply_to, edit_date = excluded.edit_date, reactions = excluded.reactions, pinned_at = excluded.pinned_at,
                fwd_from = excluded.fwd_from, preview = excluded.preview, cipher = NULL,
                random_id = coalesce(excluded.random_id, messages.random_id)
              WHERE excluded.pts >= messages.pts`,
        bind: [
          chatId, m.seq, m.pts, m.sender_id, m.date, m.kind,
          m.kind === 'text' ? m.text : null,
          m.kind === 'text' && m.entities ? JSON.stringify(m.entities) : null,
          m.kind === 'media' ? JSON.stringify(m.media) : null,
          m.kind === 'service' ? JSON.stringify(m.action) : null,
          ((m.kind === 'text' || m.kind === 'media') && m.reply_to) || null,
          (m.kind === 'text' && m.edit_date) || null,
          m.random_id ?? null,
          (m.kind === 'text' || m.kind === 'media') && m.reactions ? JSON.stringify(m.reactions) : null,
          ((m.kind === 'text' || m.kind === 'media') && m.pinned_at) || null,
          (m.kind === 'text' || m.kind === 'media') && m.fwd_from ? JSON.stringify(m.fwd_from) : null,
          m.kind === 'text' && m.preview ? JSON.stringify(m.preview) : null,
        ],
      })
      if (m.random_id !== undefined && m.sender_id === this.me) this.deleteOutbox(m.random_id)
    }
    this.touch(topics.chat(chatId))
  }

  /**
   * 秘密聊天的密文：同样的 pts 再来一遍（重新同步、自己发的消息推回来）时不动已经解开的；
   * 已经解开的消息有了新版本时保留明文，解开后再换
   */
  private putCipher(chatId: string, m: Extract<Message, { kind: 'cipher' }>) {
    const cipher = JSON.stringify({ cipher: m.cipher, ...(m.reactions ? { reactions: m.reactions } : {}) })
    this.db.exec({
      sql: `INSERT INTO messages (chat_id, seq, pts, sender_id, date, kind, edit_date, random_id, cipher)
            VALUES (?, ?, ?, ?, ?, 'cipher', ?, ?, ?)
            ON CONFLICT (chat_id, seq) DO UPDATE SET
              pts = excluded.pts, edit_date = excluded.edit_date, cipher = excluded.cipher,
              kind = CASE WHEN messages.kind IN ('text', 'media') THEN messages.kind ELSE 'cipher' END,
              random_id = coalesce(excluded.random_id, messages.random_id)
            WHERE excluded.pts > messages.pts OR (excluded.pts = messages.pts AND messages.cipher IS NOT NULL)`,
      bind: [chatId, m.seq, m.pts, m.sender_id, m.date, m.edit_date ?? null, m.random_id ?? null, cipher],
    })
    if (m.random_id !== undefined && m.sender_id === this.me) this.deleteOutbox(m.random_id)
  }

  // ---------- 秘密聊天 ----------

  /** 还没解开的消息（每次最多 limit 条） */
  cipherRows(limit: number): CipherRow[] {
    const rows = this.db.selectObjects(
      'SELECT chat_id, seq, pts, sender_id, edit_date, cipher FROM messages WHERE cipher IS NOT NULL ORDER BY chat_id, seq LIMIT ?',
      [limit],
    )
    return rows.map((r) => {
      const c = JSON.parse(r.cipher as string) as { cipher: string; reactions?: Record<string, string> }
      return {
        chat_id: r.chat_id as string,
        seq: Number(r.seq),
        pts: Number(r.pts),
        sender_id: r.sender_id as string,
        edit_date: r.edit_date === null ? null : Number(r.edit_date),
        cipher: c.cipher,
        reactions: c.reactions ?? null,
      }
    })
  }

  /** 还没解开的对话摘要 */
  cipherPreviews(): { chat_id: string; top_seq: number; pts: number; top_sender_id: string; top_text: string }[] {
    return this.db.selectObjects(
      "SELECT chat_id, top_seq, pts, top_sender_id, top_text FROM dialogs WHERE top_kind = 'cipher'",
    ) as never
  }

  /**
   * 解开的消息写回（只在行没有再变过时）：body 为明文的消息体，sealed / broken 为解不开的
   */
  putPlain(
    chatId: string,
    seq: number,
    pts: number,
    body: Extract<Message, { kind: 'text' | 'media' }> | { kind: 'sealed' | 'broken' },
    randomId: number | null,
  ) {
    const plain = body.kind === 'text' || body.kind === 'media' ? body : null
    this.db.exec({
      sql: `UPDATE messages SET kind = ?, text = ?, media = ?, reply_to = ?, reactions = ?, random_id = coalesce(random_id, ?), cipher = NULL
            WHERE chat_id = ? AND seq = ? AND pts = ? AND cipher IS NOT NULL`,
      bind: [
        body.kind,
        plain?.kind === 'text' ? plain.text : null,
        plain?.kind === 'media' ? JSON.stringify(plain.media) : null,
        plain?.reply_to ?? null,
        plain?.reactions ? JSON.stringify(plain.reactions) : null,
        randomId,
        chatId, seq, pts,
      ],
    })
    if (this.db.changes() > 0) this.touch(topics.chat(chatId))
  }

  /** 解开的对话摘要写回（只在对话行没有再变过时） */
  putPlainPreview(chatId: string, pts: number, preview: DialogPreview | null) {
    const p = preview
    this.db.exec({
      sql: `UPDATE dialogs SET top_kind = ?, top_text = ?, top_count = ?, top_videos = ?, top_duration = ?
            WHERE chat_id = ? AND pts = ? AND top_kind = 'cipher'`,
      bind: [
        p?.kind ?? 'sealed',
        p?.kind === 'text' ? p.text : p?.kind === 'file' ? p.name : null,
        p?.kind === 'album' ? p.count : null,
        p?.kind === 'album' ? (p.videos ?? null) : null,
        p?.kind === 'voice' ? p.duration : p?.kind === 'album' ? (p.duration ?? null) : null,
        chatId, pts,
      ],
    })
    if (this.db.changes() > 0) this.touch(topics.dialogs)
  }

  /** 同一发送者的 random_id 已经出现在另一条消息上：服务端把同一条密文复制成了两条 */
  duplicateRandomId(chatId: string, seq: number, senderId: string, randomId: number): boolean {
    return (
      this.db.selectValue('SELECT 1 FROM messages WHERE chat_id = ? AND sender_id = ? AND random_id = ? AND seq != ?', [
        chatId, senderId, randomId, seq,
      ]) !== undefined
    )
  }

  secretKeys(): { ref: string; private: Uint8Array; last_resort: number }[] {
    return this.db.selectObjects('SELECT ref, private, last_resort FROM secret_keys') as never
  }

  putSecretKeys(keys: { ref: string; private: Uint8Array; last_resort: boolean }[], replace: boolean) {
    if (replace) this.db.exec('DELETE FROM secret_keys')
    for (const k of keys) {
      if (k.last_resort) this.db.exec('DELETE FROM secret_keys WHERE last_resort = 1')
      this.db.exec({ sql: 'INSERT OR REPLACE INTO secret_keys (ref, private, last_resort) VALUES (?, ?, ?)', bind: [k.ref, k.private, Number(k.last_resort)] })
    }
  }

  deleteSecretKey(ref: string) {
    this.db.exec({ sql: 'DELETE FROM secret_keys WHERE ref = ? AND last_resort = 0', bind: [ref] })
  }

  secretGroup(chatId: string): { epoch: number; join_epoch: number; state: Uint8Array } | null {
    const row = this.db.selectObjects('SELECT epoch, join_epoch, state FROM secret_groups WHERE chat_id = ?', [chatId])[0]
    return row ? { epoch: Number(row.epoch), join_epoch: Number(row.join_epoch), state: row.state as Uint8Array } : null
  }

  /** 进入一个新纪元：写 MLS 状态与这个纪元的密钥；还没解开的消息随之可能解得开了 */
  putSecretEpoch(chatId: string, epoch: number, joinEpoch: number, state: Uint8Array, key: Uint8Array, leaves: string) {
    this.db.exec({
      sql: `INSERT INTO secret_groups (chat_id, epoch, join_epoch, state) VALUES (?, ?, ?, ?)
            ON CONFLICT (chat_id) DO UPDATE SET epoch = excluded.epoch, join_epoch = excluded.join_epoch, state = excluded.state`,
      bind: [chatId, epoch, joinEpoch, state],
    })
    this.db.exec({ sql: 'INSERT OR REPLACE INTO secret_epochs (chat_id, epoch, key, leaves) VALUES (?, ?, ?, ?)', bind: [chatId, epoch, key, leaves] })
    this.touch(topics.secret(chatId))
  }

  /** 本设备被移出了组，或要重新加入：忘掉 MLS 状态，旧纪元的密钥留着（之前的消息照样解得开） */
  dropSecretGroup(chatId: string) {
    this.db.exec({ sql: 'DELETE FROM secret_groups WHERE chat_id = ?', bind: [chatId] })
    this.touch(topics.secret(chatId))
  }

  /** 包装密钥丢了：本地的密钥材料都解不开了，全部忘掉（已经解开的消息还在） */
  forgetSecrets() {
    const chats = this.db.selectValues('SELECT chat_id FROM secret_groups').map(String)
    this.db.exec('DELETE FROM secret_keys')
    this.db.exec('DELETE FROM secret_groups')
    this.db.exec('DELETE FROM secret_epochs')
    for (const chatId of chats) this.touch(topics.secret(chatId))
  }

  secretEpoch(chatId: string, epoch: number): { key: Uint8Array; leaves: string } | null {
    const row = this.db.selectObjects('SELECT key, leaves FROM secret_epochs WHERE chat_id = ? AND epoch = ?', [chatId, epoch])[0]
    return row ? { key: row.key as Uint8Array, leaves: row.leaves as string } : null
  }

  /** 秘密聊天的对话（还在的） */
  secretChats(): string[] {
    return this.db.selectValues("SELECT chat_id FROM dialogs WHERE kind = 'secret' AND status = 'member'").map(String)
  }

  /** 与这个人的秘密聊天（同时最多一个） */
  secretChatWith(peerId: string): string | null {
    const id = this.db.selectValue("SELECT chat_id FROM dialogs WHERE kind = 'secret' AND peer_id = ? AND status = 'member'", [peerId])
    return (id as string | undefined) ?? null
  }

  /** 已经解开的文本消息里编辑时要保留的部分 */
  plainText(chatId: string, seq: number): { random_id: number; reply_to: number | null } | null {
    const row = this.db.selectObjects("SELECT random_id, reply_to FROM messages WHERE chat_id = ? AND seq = ? AND kind = 'text'", [chatId, seq])[0]
    if (!row || row.random_id === null) return null
    return { random_id: Number(row.random_id), reply_to: row.reply_to === null ? null : Number(row.reply_to) }
  }

  dialogKind(chatId: string): Dialog['kind'] | null {
    return (this.db.selectValue('SELECT kind FROM dialogs WHERE chat_id = ?', [chatId]) as Dialog['kind'] | undefined) ?? null
  }

  /** 本设备播放过这条语音消息；已经记过时不广播 */
  markPlayed(chatId: string, seq: number) {
    this.db.exec({ sql: 'INSERT OR IGNORE INTO played (chat_id, seq) VALUES (?, ?)', bind: [chatId, seq] })
    if (this.db.changes() > 0) this.touch(topics.chat(chatId))
  }

  dropMessages(chatId: string) {
    this.db.exec({ sql: 'DELETE FROM messages WHERE chat_id = ?', bind: [chatId] })
    this.touch(topics.chat(chatId))
  }

  /** 本地没有的消息 seq */
  missingSeqs(chatId: string, seqs: number[]): number[] {
    const unique = [...new Set(seqs)]
    if (unique.length === 0) return []
    const known = new Set(
      this.db
        .selectValues(`SELECT seq FROM messages WHERE chat_id = ? AND seq IN (${unique.map(() => '?').join(', ')})`, [
          chatId,
          ...unique,
        ])
        .map(Number),
    )
    return unique.filter((seq) => !known.has(seq))
  }

  /** 本地已存在的、属于自己的 random_id */
  sentRandomIds(chatId: string, randomIds: number[]): Set<number> {
    if (randomIds.length === 0) return new Set()
    const rows = this.db.selectValues(
      `SELECT random_id FROM messages WHERE chat_id = ? AND random_id IN (${randomIds.map(() => '?').join(', ')})`,
      [chatId, ...randomIds],
    )
    return new Set(rows.map(Number))
  }

  // ---------- 发件箱 ----------

  /**
   * 一次发送的多条消息按顺序入队（同一事务，created_at 在本地单调递增）。
   * 同一 random_id 重复提交（Leader 交接时重放）不会重复入队
   */
  addOutbox(rows: NewOutboxRow[]) {
    const last = Number(this.db.selectValue('SELECT max(created_at) FROM outbox') ?? 0)
    let at = Math.max(Date.now(), last + 1)
    for (const row of rows) {
      this.db.exec({
        sql: `INSERT OR IGNORE INTO outbox (random_id, chat_id, kind, text, entities, media, link, reply_to, state, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        bind: [
          row.random_id, row.chat_id, row.kind,
          row.kind === 'text' ? row.text : null,
          row.kind === 'text' && row.entities ? JSON.stringify(row.entities) : null,
          row.kind === 'media' ? JSON.stringify(row.media) : null,
          row.kind === 'text' && row.link ? JSON.stringify(row.link) : null,
          row.reply_to, at++,
        ],
      })
      this.touch(topics.outbox, topics.chat(row.chat_id))
    }
  }

  outboxRow(randomId: number): OutboxRow | null {
    const row = this.db.selectObjects('SELECT * FROM outbox WHERE random_id = ?', [randomId])[0]
    return row ? toOutboxRow(row) : null
  }

  /** 该会话下一条待发送的消息 */
  nextOutbox(chatId: string): OutboxRow | null {
    const row = this.db.selectObjects(
      "SELECT * FROM outbox WHERE chat_id = ? AND state = 'pending' ORDER BY created_at LIMIT 1",
      [chatId],
    )[0]
    return row ? toOutboxRow(row) : null
  }

  /** 有待发送消息的会话 */
  outboxChats(): string[] {
    return this.db.selectValues("SELECT DISTINCT chat_id FROM outbox WHERE state = 'pending'").map(String)
  }

  allOutbox(): OutboxRow[] {
    return this.db.selectObjects('SELECT * FROM outbox').map(toOutboxRow)
  }

  /** error：服务端拒绝的原因；重试时清除 */
  setOutboxState(row: OutboxRow, state: OutboxRow['state'], error: string | null = null) {
    this.db.exec({ sql: 'UPDATE outbox SET state = ?, error = ? WHERE random_id = ?', bind: [state, error, row.random_id] })
    this.touch(topics.outbox, topics.chat(row.chat_id))
  }

  /** 记下已上传的对象键；消息列表不因此刷新 */
  setOutboxMedia(randomId: number, media: OutboxMedia[]) {
    this.db.exec({ sql: 'UPDATE outbox SET media = ? WHERE random_id = ?', bind: [JSON.stringify(media), randomId] })
  }

  /** 链接预览抓到或卡片图片上传后写回；消息列表随之刷新（卡片内容变了） */
  setOutboxLink(row: OutboxRow, link: OutboxLink) {
    this.db.exec({ sql: 'UPDATE outbox SET link = ? WHERE random_id = ?', bind: [JSON.stringify(link), row.random_id] })
    this.touch(topics.outbox, topics.chat(row.chat_id))
  }

  deleteOutbox(randomId: number) {
    const chatId = this.db.selectValue('DELETE FROM outbox WHERE random_id = ? RETURNING chat_id', [randomId])
    if (chatId !== undefined) this.touch(topics.outbox, topics.chat(chatId as string))
  }

  /** 忘掉已经上传的对象键（待发对象已过期被删），下次发送时重新上传 */
  clearUploaded(randomId: number) {
    const row = this.outboxRow(randomId)
    if (row?.kind === 'media') {
      this.setOutboxMedia(randomId, row.media.map((m) => ('preview' in m ? { ...m, key: undefined, preview_key: undefined } : { ...m, key: undefined })))
    } else if (row?.link?.state === 'ready' && row.link.photo) {
      this.setOutboxLink(row, { ...row.link, photo: { ...row.link.photo, key: undefined } })
    }
  }

  /** 发送成功：用服务端分配的序号落库消息，并移出发件箱 */
  confirmOutbox(row: OutboxRow, r: { seq: number; pts: number; date: number }, media: Media[] | null, preview?: LinkPreview) {
    this.db.exec({
      sql: `INSERT OR IGNORE INTO messages (chat_id, seq, pts, sender_id, date, kind, text, entities, media, preview, reply_to, random_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        row.chat_id, r.seq, r.pts, this.me, r.date, row.kind,
        row.kind === 'text' ? row.text : null,
        row.kind === 'text' && row.entities ? JSON.stringify(row.entities) : null,
        media ? JSON.stringify(media) : null,
        preview ? JSON.stringify(preview) : null,
        row.reply_to, row.random_id,
      ],
    })
    this.deleteOutbox(row.random_id)
    this.touch(topics.chat(row.chat_id))
  }

  // ---------- 用户资料 ----------

  putUsers(users: UserProfile[]) {
    if (users.length === 0) return
    for (const u of users) {
      this.db.exec({
        sql: `INSERT INTO users (id, name, image) VALUES (?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET name = excluded.name, image = excluded.image`,
        bind: [u.id, u.name, u.image],
      })
    }
    this.touch(topics.users)
  }

  // ---------- 关系 ----------

  /** 联系人与拉黑都没有了就删行；备注名影响所有显示名字的地方，所以广播 users */
  putRelation(rel: Relation) {
    if (!rel.contact && !rel.blocked) {
      this.db.exec({ sql: 'DELETE FROM relations WHERE user_id = ?', bind: [rel.user_id] })
    } else {
      this.db.exec({
        sql: `INSERT INTO relations (user_id, contact, alias, blocked) VALUES (?, ?, ?, ?)
              ON CONFLICT (user_id) DO UPDATE SET contact = excluded.contact, alias = excluded.alias, blocked = excluded.blocked`,
        bind: [rel.user_id, Number(rel.contact), rel.alias, Number(rel.blocked)],
      })
    }
    this.touch(topics.users)
  }

  // ---------- 我的贴纸 ----------

  putSticker({ key, sticker }: StickerChange) {
    if (!sticker) {
      this.db.exec({ sql: 'DELETE FROM stickers WHERE key = ?', bind: [key] })
    } else {
      this.db.exec({
        sql: `INSERT INTO stickers (key, mime, w, h, size, thumbhash, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET added_at = excluded.added_at`,
        bind: [key, sticker.mime, sticker.w, sticker.h, sticker.size, sticker.thumbhash, sticker.added_at],
      })
    }
    this.touch(topics.stickers)
  }

  // ---------- 最近通话 ----------

  putCall(call: CallLog) {
    this.db.exec({
      sql: `INSERT OR IGNORE INTO calls (call_id, chat_id, seq, peer_id, caller_id, result, duration, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [call.call_id, call.chat_id, call.seq, call.peer_id, call.caller_id, call.result, call.duration, call.date],
    })
    this.db.exec({
      sql: 'DELETE FROM calls WHERE call_id IN (SELECT call_id FROM calls ORDER BY date DESC, call_id LIMIT -1 OFFSET ?)',
      bind: [MAX_RECENT_CALLS],
    })
    this.touch(topics.calls)
  }

  /** 对话列表、群成员与关系涉及的用户 ID；missingOnly 时只返回本地没有资料的 */
  knownUserIds(missingOnly: boolean): string[] {
    const ids = new Set(
      this.db
        .selectValues(
          `SELECT peer_id FROM dialogs UNION SELECT top_sender_id FROM dialogs UNION SELECT user_id FROM chat_members
           UNION SELECT user_id FROM relations UNION SELECT peer_id FROM calls`,
        )
        .filter((id) => id !== null)
        .map(String),
    )
    for (const action of this.db.selectValues('SELECT top_action FROM dialogs WHERE top_action IS NOT NULL')) {
      for (const id of messageUserIds({ sender_id: '', kind: 'service', action: JSON.parse(action as string) })) {
        if (id) ids.add(id)
      }
    }
    return missingOnly ? this.missingUserIds([...ids]) : [...ids]
  }

  missingUserIds(ids: string[]): string[] {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const known = new Set(
      this.db.selectValues(`SELECT id FROM users WHERE id IN (${unique.map(() => '?').join(', ')})`, unique).map(String),
    )
    return unique.filter((id) => !known.has(id))
  }

  hasUser(id: string): boolean {
    return this.db.selectValue('SELECT 1 FROM users WHERE id = ?', [id]) !== undefined
  }
}
