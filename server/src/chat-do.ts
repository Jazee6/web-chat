// ChatDO：每个会话一个。消息日志、seq / chat_pts 分配、成员、扇出与重试。
// 见 docs/architecture/02-data-model.md § ChatDO、04-realtime-and-fanout.md
import { DurableObject } from 'cloudflare:workers'
import {
  CALL_GRACE_MS,
  DEDUP_WINDOW_MS,
  EDIT_WINDOW_MS,
  MAX_GROUP_MEMBERS,
  MAX_PINNED_MESSAGES,
  PRESENCE_RENEW_MS,
  PRESENCE_TTL_MS,
  RECALL_WINDOW_MS,
  RING_TIMEOUT_MS,
  chatPair,
  isGroupChatId,
  parsePrivateChatId,
  parseSecretChatId,
  randomToken,
  summarizeMedia,
  type Call,
  type CallResult,
  type CallSlot,
  type GroupCall,
  type SimulcastRid,
  type ChatDiff,
  type ChatEvent,
  type ChatInfo,
  type ChatKind,
  type ForwardFrom,
  type InvitePreview,
  type LinkPreview,
  type Media,
  type MemberRole,
  type Message,
  type MessageBody,
  type MessageEntity,
  type PinExcerpt,
  REACTIONS,
  type ReactionEmoji,
  type Reactions,
  type SecretCommit,
  type SecretDevice,
  type SecretState,
  type ServiceAction,
  type TypingAction,
} from 'shared/protocol'
import { mediaKeys, previewKeys } from './media'
import { err, ok, pool, type Result } from './result'
import { Sfu, SfuError, unpackSdp } from './sfu'
import { Sql, migrate } from './sql'

const FANOUT_CONCURRENCY = 6
const BLOCK_KEY = 'block:'
/** info 里邀请链接令牌的键 */
const INVITE_KEY = 'invite'
/** info 里进行中的一对一通话的键 */
const CALL_KEY = 'call'
/** info 里进行中的群组通话的键 */
const GROUP_CALL_KEY = 'group_call'
/** info 里秘密聊天的成员状态（纪元、组里的设备、要重新加入的设备）的键 */
const SECRET_KEY = 'secret'
/** info 里秘密聊天一方现有设备的键前缀：devices:{user_id} */
const DEVICES_KEY = 'devices:'
/** info 里秘密聊天已被删除的标记：消息与提交都已删掉，只留成员用于扇出删除 */
const DELETED_KEY = 'deleted'
/** 一次最多返回多少个提交 */
const COMMITS_PAGE = 100
const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 60 * 60 * 1000
/** 置顶服务消息里记下的被置顶文本最多多少个字符 */
const EXCERPT_LENGTH = 100

/**
 * 消息行。秘密聊天的消息（kind = cipher）：text 为密文，media 为加密后上传的对象键（string[] 的 JSON，撤回与删除时据此删除），
 * reactions 为 user_id → 加密的回应
 */
type MessageRow = {
  seq: number
  pts: number
  sender_id: string
  random_id: number
  date: number
  kind: string
  text: string | null
  /** 文本消息的提及（MessageEntity[] 的 JSON）；没有为 NULL */
  entities: string | null
  /** 媒体消息的 media（JSON） */
  media: string | null
  action: string | null
  reply_to: number | null
  edit_date: number | null
  /** 回应（Reactions 的 JSON）；没有回应为 NULL */
  reactions: string | null
  /** 置顶的时间；没有置顶为 NULL */
  pinned_at: number | null
  /** 转发来源（ForwardFrom 的 JSON）；不是转发来的为 NULL */
  fwd_from: string | null
  /** 链接预览（LinkPreview 的 JSON），只有纯链接的文本消息可能有；没有为 NULL */
  preview: string | null
}

/** left_seq 不为 null 表示前成员：可以读到这条（自己离开的服务消息）为止；last_read_seq 只在私聊中维护 */
type Member = { role: MemberRole; joined_at: number; left_seq: number | null; last_read_seq: number }
type MemberRow = Member & { user_id: string }

type OutboxRow = { id: number; user_id: string; events: string; attempts: number; next_at: number }

/**
 * 进行中（响铃或已接听）的一对一通话，存在 info 的 call 键里：ChatDO 没有长连接，空闲后会被逐出。
 * caller_device / callee_device 为通话所在的设备（被叫方接听前为 null）。
 * deadline 为响铃超时，或通话所在设备断开后的认领期限，由 Alarm 处理；lost_at 为设备断开的时间，超时结束时时长算到这里
 */
type CallState = {
  call_id: string
  caller_id: string
  callee_id: string
  caller_device: string
  callee_device: string | null
  started_at: number
  accepted_at: number | null
  deadline: number | null
  lost_at: number | null
}

/**
 * 群组通话的一个参与者。session_id 为他在 SFU 上的 session（第一次发布或拉取时才建），
 * tracks 为已发布的媒体（SFU 上的 track 名与他那端收发器的 mid）。lost_at 为所在设备断开的时间，CALL_GRACE_MS 内没认领回来即离开
 */
type GroupParticipant = {
  device_id: string
  session_id: string | null
  tracks: Partial<Record<CallSlot, { name: string; mid: string }>>
  muted: boolean
  joined_at: number
  lost_at: number | null
}

/** 进行中的群组通话，存在 info 的 group_call 键里（每次变化 1 行写入）。seq 为通话记录，joined 为加入过的人 */
type GroupCallState = {
  call_id: string
  started_by: string
  started_at: number
  seq: number
  joined: string[]
  participants: Record<string, GroupParticipant>
}

/** 秘密聊天的成员状态，存在 info 的 secret 键里：当前纪元、组里的设备、要先移除再重新加入的设备 */
type SecretMeta = { epoch: number; leaves: SecretDevice[]; resets: string[] }

type CommitRow = {
  epoch: number
  sender_id: string
  device_id: string
  date: number
  data: string | null
  welcome: string | null
  /** SecretDevice[] 的 JSON */
  adds: string
  /** device_id[] 的 JSON */
  removes: string
}

/**
 * 扇出给成员 UserDO 的事件：会话事件，私聊中对方的已读位置（不占 chat_pts），
 * 以及秘密聊天被删除（双方的对话一并删除）
 */
export type FanoutEvent = ChatEvent | { type: 'peer_read'; max_seq: number } | { type: 'chat_deleted' }

/** 扇出时随事件一起带给成员 UserDO 的会话资料，用于维护对话行 */
export type ChatSnapshot = { kind: ChatKind; title: string | null }

/**
 * 发送的内容：文本（可带提及与链接预览，链接预览由 UserDO 校验），或已上传的媒体（相册或一个文件）。
 * 转发来的带 fwd_from：提及原样保留（指向别的会话的人），但不算提及
 */
export type Content = ({ text: string; entities?: MessageEntity[]; preview?: LinkPreview } | { media: Media[] }) & { fwd_from?: ForwardFrom }

/** 产生一条消息的写操作的结果；发起者的 UserDO 据此更新自己的对话行 */
export type Wrote = { message: Message; chat: ChatSnapshot }

function retryDelay(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS)
}

/** 表结构迁移：第 i 项把版本 i 升到 i + 1，见 sql.ts 的 migrate */
const MIGRATIONS = [
  // v1
  [
    `CREATE TABLE info (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE members (
      user_id       TEXT PRIMARY KEY,
      role          TEXT NOT NULL,
      joined_at     INTEGER NOT NULL,
      left_seq      INTEGER,
      last_read_seq INTEGER NOT NULL DEFAULT 0
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE messages (
      seq       INTEGER PRIMARY KEY,
      pts       INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      random_id INTEGER NOT NULL,
      date      INTEGER NOT NULL,
      kind      TEXT NOT NULL,
      text      TEXT,
      entities  TEXT,
      media     TEXT,
      action    TEXT,
      reply_to  INTEGER,
      edit_date INTEGER,
      reactions TEXT,
      pinned_at INTEGER,
      fwd_from  TEXT,
      preview   TEXT
    ) STRICT`,
    'CREATE INDEX messages_by_pts ON messages(pts)',
    // 部分索引：只有置顶着的消息进索引，置顶与取消置顶各多写 1 行，其余写入不受影响
    'CREATE INDEX messages_pinned ON messages(pinned_at) WHERE pinned_at IS NOT NULL',
    // 秘密聊天的提交：每个纪元一行，按纪元取
    `CREATE TABLE commits (
      epoch     INTEGER PRIMARY KEY,
      sender_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      date      INTEGER NOT NULL,
      data      TEXT,
      welcome   TEXT,
      adds      TEXT NOT NULL,
      removes   TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE fanout_outbox (
      id       INTEGER PRIMARY KEY,
      user_id  TEXT NOT NULL,
      events   TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      next_at  INTEGER NOT NULL
    ) STRICT`,
  ],
]

export class ChatDO extends DurableObject<Env> {
  readonly sql: Sql
  private chatId: string | null
  private kind: ChatKind | null
  private title: string | null
  /** 邀请链接的令牌；还没有人要过链接时为 null */
  private invite: string | null
  /** 进行中的一对一通话 */
  private call: CallState | null
  /** 进行中的群组通话 */
  private groupCall: GroupCallState | null
  /** 群组通话用的 SFU（测试里替换掉） */
  sfu: Sfu
  /** 当前成员与前成员 */
  private members: Map<string, Member>
  /** 私聊中拉黑了对方的人（存在 info 的 block:{user_id} 键里，会话初始化之前也可以有） */
  private blockers: Set<string>
  /** 秘密聊天的成员状态；其他会话为 null */
  private secret: SecretMeta | null
  /** 秘密聊天双方现有的设备，由各自的 UserDO 告知 */
  private devices: Map<string, string[]>
  /** 秘密聊天已被删除 */
  private deleted: boolean
  private topSeq: number
  private chatPts: number
  /** `${sender_id}:${random_id}` → 首次写入的消息，按时间顺序插入 */
  private recent = new Map<string, { date: number; message: Message }>()
  private initializing: Promise<Result<null>> | null = null
  /** 待扇出的事件，按目标用户合并 */
  private pending = new Map<string, FanoutEvent[]>()
  private flushing: Promise<void> | null = null
  /** 查看者：user_id → 过期时间。只在内存里，实例被逐出后清空，靠客户端续订补齐 */
  private viewers = new Map<string, number>()
  /** 实例启动后的第一个续订周期内，查看者名单可能不全 */
  private readonly viewersCompleteAt = Date.now() + PRESENCE_RENEW_MS

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = new Sql(ctx.storage.sql)
    migrate(ctx.storage, MIGRATIONS)

    const info = new Map(this.sql.all<{ key: string; value: string }>('SELECT key, value FROM info').map((r) => [r.key, r.value]))
    this.chatId = info.get('chat_id') ?? null
    this.kind = (info.get('kind') as ChatKind | undefined) ?? null
    this.title = info.get('title') ?? null
    this.invite = info.get(INVITE_KEY) ?? null
    this.call = info.has(CALL_KEY) ? (JSON.parse(info.get(CALL_KEY)!) as CallState) : null
    this.groupCall = info.has(GROUP_CALL_KEY) ? (JSON.parse(info.get(GROUP_CALL_KEY)!) as GroupCallState) : null
    this.sfu = new Sfu(env)
    this.blockers = new Set([...info.keys()].filter((k) => k.startsWith(BLOCK_KEY)).map((k) => k.slice(BLOCK_KEY.length)))
    this.secret = info.has(SECRET_KEY) ? (JSON.parse(info.get(SECRET_KEY)!) as SecretMeta) : null
    this.devices = new Map(
      [...info].filter(([k]) => k.startsWith(DEVICES_KEY)).map(([k, value]) => [k.slice(DEVICES_KEY.length), JSON.parse(value) as string[]]),
    )
    this.deleted = info.has(DELETED_KEY)
    this.members = new Map(
      this.sql
        .all<MemberRow>('SELECT user_id, role, joined_at, left_seq, last_read_seq FROM members')
        .map(({ user_id, ...m }) => [user_id, m]),
    )
    // 序号不落计数器行，唤醒时由 max() 恢复
    const tops = this.sql.one<{ seq: number | null; pts: number | null }>('SELECT max(seq) AS seq, max(pts) AS pts FROM messages')
    this.topSeq = tops?.seq ?? 0
    this.chatPts = tops?.pts ?? 0
    this.loadRecent()
  }

  // ---------- 状态 ----------

  private get initialized() {
    return this.kind !== null
  }

  /** 已被删除的秘密聊天对谁都不存在 */
  private get gone() {
    return this.deleted
  }

  private get snapshot(): ChatSnapshot {
    return { kind: this.kind!, title: this.title }
  }

  private isMember(userId: string) {
    const m = this.members.get(userId)
    return m !== undefined && m.left_seq === null
  }

  private currentMembers(): string[] {
    return [...this.members].filter(([, m]) => m.left_seq === null).map(([id]) => id)
  }

  /** 能读到的最大 seq：成员不限，前成员到离开为止，其他人 null */
  private readLimit(chatId: string, userId: string): number | null {
    if (this.gone) return null
    if (!this.initialized) return parsePrivateChatId(chatId)?.includes(userId) ? Infinity : null
    const m = this.members.get(userId)
    if (!m) return null
    return m.left_seq ?? Infinity
  }

  // ---------- 去重 ----------

  /** 冷启动时从尾部往回扫描去重窗口内的消息，遇到窗口外的即停止 */
  private loadRecent() {
    const cutoff = Date.now() - DEDUP_WINDOW_MS
    const rows: MessageRow[] = []
    for (const row of this.sql.cursor<MessageRow>('SELECT * FROM messages ORDER BY seq DESC')) {
      if (row.date < cutoff) break
      rows.push(row)
    }
    for (const row of rows.reverse()) this.remember(row, this.toMessage(row, row.sender_id))
  }

  private remember(row: Pick<MessageRow, 'sender_id' | 'random_id' | 'date'>, message: Message) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS
    for (const [key, entry] of this.recent) {
      if (entry.date >= cutoff) break
      this.recent.delete(key)
    }
    this.recent.set(`${row.sender_id}:${row.random_id}`, { date: row.date, message })
  }

  /** 同一 (sender_id, random_id) 在去重窗口内重复提交：返回第一次写入的消息 */
  private dedup(senderId: string, randomId: number): Result<Wrote> | null {
    const dup = this.recent.get(`${senderId}:${randomId}`)
    return dup ? ok({ message: dup.message, chat: this.snapshot }) : null
  }

  private toMessage(row: MessageRow, viewerId: string): Message {
    let body: MessageBody
    if (row.kind === 'service') body = { kind: 'service', action: JSON.parse(row.action!) as ServiceAction }
    else if (row.kind === 'recalled') body = { kind: 'recalled' }
    else if (row.kind === 'cipher') {
      body = { kind: 'cipher', cipher: row.text! }
      if (row.edit_date !== null) body.edit_date = row.edit_date
      if (row.reactions !== null) body.reactions = JSON.parse(row.reactions) as Record<string, string>
    } else if (row.kind === 'media') {
      body = { kind: 'media', media: JSON.parse(row.media!) as Media[] }
      if (row.reply_to !== null) body.reply_to = row.reply_to
      if (row.reactions !== null) body.reactions = JSON.parse(row.reactions) as Reactions
      if (row.pinned_at !== null) body.pinned_at = row.pinned_at
      if (row.fwd_from !== null) body.fwd_from = JSON.parse(row.fwd_from) as ForwardFrom
    } else {
      body = { kind: 'text', text: row.text! }
      if (row.entities !== null) body.entities = JSON.parse(row.entities) as MessageEntity[]
      if (row.reply_to !== null) body.reply_to = row.reply_to
      if (row.edit_date !== null) body.edit_date = row.edit_date
      if (row.reactions !== null) body.reactions = JSON.parse(row.reactions) as Reactions
      if (row.pinned_at !== null) body.pinned_at = row.pinned_at
      if (row.fwd_from !== null) body.fwd_from = JSON.parse(row.fwd_from) as ForwardFrom
      if (row.preview !== null) body.preview = JSON.parse(row.preview) as LinkPreview
    }
    const message: Message = { chat_id: this.chatId!, seq: row.seq, pts: row.pts, sender_id: row.sender_id, date: row.date, ...body }
    if (row.sender_id === viewerId) message.random_id = row.random_id
    return message
  }

  // ---------- 写入 ----------

  /**
   * 追加一条消息（2 行写入：messages + messages_by_pts），并把它扇出给 targets。
   * 从分配序号到写入之间不能有 await，保证序号串行。
   */
  private append(
    senderId: string,
    randomId: number,
    body: MessageBody,
    targets: Iterable<string>,
    toSender = false,
    sealedKeys: string[] = [],
  ): Message {
    const row: MessageRow = {
      seq: ++this.topSeq,
      pts: ++this.chatPts,
      sender_id: senderId,
      random_id: randomId,
      date: Date.now(),
      kind: body.kind,
      text: body.kind === 'text' ? body.text : body.kind === 'cipher' ? body.cipher : null,
      entities: body.kind === 'text' && body.entities?.length ? JSON.stringify(body.entities) : null,
      media: body.kind === 'media' ? JSON.stringify(body.media) : sealedKeys.length > 0 ? JSON.stringify(sealedKeys) : null,
      action: body.kind === 'service' ? JSON.stringify(body.action) : null,
      reply_to: ((body.kind === 'text' || body.kind === 'media') && body.reply_to) || null,
      edit_date: null,
      reactions: null,
      pinned_at: null,
      fwd_from: (body.kind === 'text' || body.kind === 'media') && body.fwd_from ? JSON.stringify(body.fwd_from) : null,
      preview: body.kind === 'text' && body.preview ? JSON.stringify(body.preview) : null,
    }
    this.sql.run(
      `INSERT INTO messages (seq, pts, sender_id, random_id, date, kind, text, entities, media, action, reply_to, fwd_from, preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.seq, row.pts, row.sender_id, row.random_id, row.date, row.kind, row.text, row.entities, row.media, row.action, row.reply_to,
      row.fwd_from, row.preview,
    )
    const message = this.toMessage(row, senderId)
    this.remember(row, message)

    const mentioned = this.mentioned(body, senderId)
    const event: FanoutEvent = {
      type: 'new_message',
      message: this.toMessage(row, ''),
      ...(mentioned.length > 0 ? { mentioned } : {}),
    }
    for (const userId of targets) if (toSender || userId !== senderId) this.enqueue(userId, [event])
    this.scheduleFlush()
    return message
  }

  /**
   * 提及只在群组里有效：对象必须是当前成员、不是发送者；越界或与前一个重叠的丢弃，按位置排序。
   * 提及的文字照样保留
   */
  private validMentions(text: string, entities: MessageEntity[] | undefined, senderId: string): MessageEntity[] {
    if (this.kind !== 'group' || !entities) return []
    const valid: MessageEntity[] = []
    let end = 0
    for (const e of [...entities].sort((a, b) => a.offset - b.offset)) {
      if (e.offset < end || e.offset + e.length > text.length) continue
      if (e.user_id === senderId || !this.isMember(e.user_id)) continue
      valid.push({ type: 'mention', offset: e.offset, length: e.length, user_id: e.user_id })
      end = e.offset + e.length
    }
    return valid
  }

  /** 群组新消息提及的人：提及的对象，加上被回复消息的发送者；不含发送者自己。转发来的不算 */
  private mentioned(body: MessageBody, senderId: string): string[] {
    if (this.kind !== 'group' || (body.kind !== 'text' && body.kind !== 'media') || body.fwd_from) return []
    const ids = new Set(body.kind === 'text' ? (body.entities ?? []).map((e) => e.user_id) : [])
    if (body.reply_to) {
      const replied = this.sql.one<{ sender_id: string }>('SELECT sender_id FROM messages WHERE seq = ?', body.reply_to)
      if (replied) ids.add(replied.sender_id)
    }
    ids.delete(senderId)
    return [...ids]
  }

  private putInfo(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) {
      this.sql.run('INSERT INTO info (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
    }
  }

  private putMember(userId: string, member: Member) {
    this.sql.run(
      `INSERT INTO members (user_id, role, joined_at, left_seq) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at, left_seq = excluded.left_seq`,
      userId, member.role, member.joined_at, member.left_seq,
    )
    this.members.set(userId, member)
  }

  /** 返回不存在的用户 ID */
  private async missingUsers(ids: string[]): Promise<string[]> {
    const { results } = await this.env.DIRECTORY.prepare(`SELECT id FROM "user" WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all<{ id: string }>()
    const found = new Set(results.map((r) => r.id))
    return ids.filter((id) => !found.has(id))
  }

  /** 拉人进群前逐个询问对象的 UserDO：返回拉黑了发起者的人。只在建群、加人时发生，次数很少 */
  private async blockedBy(actorId: string, userIds: string[]): Promise<string[]> {
    const blocked: string[] = []
    await pool(userIds, FANOUT_CONCURRENCY, async (id) => {
      if (await this.env.USER.getByName(id).hasBlocked(actorId)) blocked.push(id)
    })
    return blocked
  }

  // ---------- 拉黑 ----------

  /** 由拉黑者的 UserDO 调用，记下或清除拉黑（1 行写入）。会话初始化之前也可以记 */
  async setBlock(chatId: string, userId: string, blocked: boolean): Promise<Result<null>> {
    if (!chatPair(chatId)?.includes(userId)) return err('forbidden')
    if (blocked === this.blockers.has(userId)) return ok(null)
    if (blocked) {
      this.putInfo({ [BLOCK_KEY + userId]: '1' })
      this.blockers.add(userId)
      // 拉黑时正在进行的通话随之结束，等同于拉黑者挂断
      const call = this.call
      if (call && (call.caller_id === userId || call.callee_id === userId)) this.finishCall(hangUpResult(call, userId))
    } else {
      this.sql.run('DELETE FROM info WHERE key = ?', BLOCK_KEY + userId)
      this.blockers.delete(userId)
    }
    return ok(null)
  }

  /** 私聊的第一条消息落库前初始化：校验对方存在，写入 info 与两名成员 */
  private initPrivate(chatId: string, senderId: string): Promise<Result<null>> {
    this.initializing ??= (async (): Promise<Result<null>> => {
      const pair = parsePrivateChatId(chatId)
      if (!pair || !pair.includes(senderId)) return err('forbidden')
      const peerId = pair[0] === senderId ? pair[1] : pair[0]
      if ((await this.missingUsers([peerId])).length > 0) return err('not_found')
      // await 期间可能已有其他请求完成了初始化
      if (!this.initialized) {
        const now = Date.now()
        this.putInfo({ chat_id: chatId, kind: 'private' })
        for (const id of pair) this.putMember(id, { role: 'member', joined_at: now, left_seq: null, last_read_seq: 0 })
        this.chatId = chatId
        this.kind = 'private'
      }
      return ok(null)
    })().finally(() => {
      this.initializing = null
    })
    return this.initializing
  }

  /** 媒体的格式与归属由 UserDO 校验 */
  async send(chatId: string, senderId: string, randomId: number, content: Content, replyTo?: number): Promise<Result<Wrote>> {
    // 秘密聊天只收密文（sendSecret）
    if (this.kind === 'secret' || parseSecretChatId(chatId)) return err('bad_request')
    if (!this.initialized) {
      if (isGroupChatId(chatId)) return err('not_found')
      // 被拒绝的发送不写任何行，包括初始化
      if (parsePrivateChatId(chatId)?.includes(senderId) && this.blockers.size > 0) return err('blocked')
      const res = await this.initPrivate(chatId, senderId)
      if (!res.ok) return res
    }
    // 拉黑或离开之前已经写入、只是确认丢了的发送，重放时仍返回原来的结果。
    // 因此被拒绝的发送一定没有写入，UserDO 据此删掉为它复制出来的媒体对象
    const dup = this.dedup(senderId, randomId)
    if (dup) return dup
    if (!this.isMember(senderId)) return err('forbidden')
    if (this.blockers.size > 0) return err('blocked')
    // 只能回复已经存在的消息（成员能读到全部历史）
    if (replyTo !== undefined && replyTo > this.topSeq) return err('bad_request')
    const reply = replyTo !== undefined ? { reply_to: replyTo } : {}
    const fwd = content.fwd_from ? { fwd_from: content.fwd_from } : {}
    let body: MessageBody
    if ('text' in content) {
      const entities = content.fwd_from ? (content.entities ?? []) : this.validMentions(content.text, content.entities, senderId)
      const preview = content.preview ? { preview: content.preview } : {}
      body = { kind: 'text', text: content.text, ...(entities.length > 0 ? { entities } : {}), ...reply, ...fwd, ...preview }
    } else {
      body = { kind: 'media', media: content.media, ...reply, ...fwd }
    }
    const message = this.append(senderId, randomId, body, this.currentMembers())
    return ok({ message, chat: this.snapshot })
  }

  // ---------- 编辑与撤回 ----------

  /**
   * 编辑自己的文本消息：原地改写并更新 pts，提及随之替换；内容没变时不写入。
   * 链接预览在链接没变（去掉首尾空白后相同）时保留，否则去掉，卡片图片随之删除
   */
  async edit(chatId: string, userId: string, seq: number, text: string, entities?: MessageEntity[]): Promise<Result<Wrote | null>> {
    if (this.kind === 'secret') return err('bad_request')
    // 编辑会推给对方，拉黑期间等同于发消息；撤回不受影响
    if (this.blockers.size > 0) return err('blocked')
    let dropped: string[] = []
    const res = await this.change(chatId, userId, seq, EDIT_WINDOW_MS, (row) => {
      // 转发来的消息不能编辑
      if (row.kind !== 'text' || row.fwd_from !== null) return err('bad_request')
      const valid = this.validMentions(text, entities, userId)
      const json = valid.length > 0 ? JSON.stringify(valid) : null
      if (row.text === text && row.entities === json) return ok(null)
      const keep = row.preview !== null && row.text!.trim() === text.trim()
      if (!keep && row.preview) dropped = previewKeys(JSON.parse(row.preview) as LinkPreview)
      return ok({ ...row, text, entities: json, edit_date: Date.now(), preview: keep ? row.preview : null })
    })
    if (res.ok && res.r) this.deleteMedia(dropped)
    return res
  }

  /** R2 的删除操作免费；删除失败的只记日志（已发送的对象不在 p/ 下，生命周期规则管不到） */
  private deleteMedia(keys: string[]) {
    if (keys.length === 0) return
    this.ctx.waitUntil(
      this.env.MEDIA.delete(keys).catch((e: unknown) => console.error('media delete failed', { chat_id: this.chatId, error: String(e) })),
    )
  }

  /**
   * 撤回自己的文本或媒体消息：清空内容、保留墓碑行供同步；重复撤回不写入。
   * 媒体对象随之删除（R2 的删除操作免费），已经泄露的地址也就失效了；删除失败的只记日志
   */
  async recall(chatId: string, userId: string, seq: number): Promise<Result<Wrote | null>> {
    let keys: string[] = []
    const res = await this.change(chatId, userId, seq, RECALL_WINDOW_MS, (row) => {
      if (row.kind === 'recalled') return ok(null)
      if (row.kind !== 'text' && row.kind !== 'media' && row.kind !== 'cipher') return err('bad_request')
      keys = [...rowKeys(row), ...(row.preview ? previewKeys(JSON.parse(row.preview) as LinkPreview) : [])]
      // 撤回的消息同时取消置顶
      return ok({
        ...row,
        kind: 'recalled',
        text: null,
        entities: null,
        media: null,
        reply_to: null,
        edit_date: null,
        reactions: null,
        pinned_at: null,
        fwd_from: null,
        preview: null,
      })
    })
    if (res.ok && res.r) this.deleteMedia(keys)
    return res
  }

  /** 编辑与撤回：只能改自己的消息，并且在时限内 */
  private async change(
    _chatId: string,
    userId: string,
    seq: number,
    windowMs: number,
    mutate: (row: MessageRow) => Result<MessageRow | null>,
  ): Promise<Result<Wrote | null>> {
    if (!this.initialized || this.gone) return err('not_found')
    if (!this.isMember(userId)) return err('forbidden')
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', seq)
    if (!row) return err('not_found')
    if (row.sender_id !== userId) return err('forbidden')
    const next = mutate(row)
    if (!next.ok || next.r === null) return next as Result<null>
    if (Date.now() - row.date > windowMs) return err('expired')
    return ok(this.rewrite(next.r, userId))
  }

  /**
   * 回应：每人每条消息最多一个，emoji 为 null 表示取消；没有变化时不写入。
   * 回应会推给对方，私聊拉黑期间等同于发消息
   */
  async react(_chatId: string, userId: string, seq: number, emoji: ReactionEmoji | null): Promise<Result<Wrote | null>> {
    if (!this.initialized) return err('not_found')
    if (this.kind === 'secret') return err('bad_request')
    if (!this.isMember(userId)) return err('forbidden')
    if (this.blockers.size > 0) return err('blocked')
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', seq)
    if (!row) return err('not_found')
    if (row.kind !== 'text' && row.kind !== 'media') return err('bad_request')
    const reactions = setReaction(row.reactions ? (JSON.parse(row.reactions) as Reactions) : {}, userId, emoji)
    if (reactions === row.reactions) return ok(null)
    return ok(this.rewrite({ ...row, reactions }, userId))
  }

  // ---------- 置顶消息 ----------

  /** 置顶着的消息，后置顶的在前 */
  private pinnedSeqs(): number[] {
    return this.sql
      .all<{ seq: number }>('SELECT seq FROM messages WHERE pinned_at IS NOT NULL ORDER BY pinned_at DESC, seq DESC')
      .map((r) => r.seq)
  }

  /** 群组只有群主可以置顶与取消置顶，私聊双方都可以 */
  private canPin(userId: string) {
    return this.kind === 'private' || this.members.get(userId)?.role === 'owner'
  }

  /**
   * 置顶：改写被置顶的消息（2 行 + 部分索引 1 行），再追加一条服务消息（2 行），一起扇出。
   * 已经置顶着时不写入；私聊拉黑期间等同于发消息。pinned 为改写后的消息，重放请求时为 null
   */
  async pin(_chatId: string, actorId: string, randomId: number, seq: number): Promise<Result<(Wrote & { pinned: Message | null }) | null>> {
    if (!this.initialized) return err('not_found')
    if (!this.isMember(actorId)) return err('forbidden')
    const dup = this.dedup(actorId, randomId)
    if (dup?.ok) return ok({ ...dup.r, pinned: null })
    if (!this.canPin(actorId)) return err('forbidden')
    if (this.blockers.size > 0) return err('blocked')
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', seq)
    if (!row) return err('not_found')
    if (row.kind !== 'text' && row.kind !== 'media') return err('bad_request')
    if (row.pinned_at !== null) return ok(null)
    if (this.pinnedSeqs().length >= MAX_PINNED_MESSAGES) return err('pin_limit')

    const pinned = this.rewrite({ ...row, pinned_at: Date.now() }, actorId).message
    const message = this.append(actorId, randomId, service({ type: 'message_pin', seq, excerpt: excerpt(row) }), this.currentMembers())
    return ok({ message, chat: this.snapshot, pinned })
  }

  /** 取消置顶：只改写消息本身（2 行；部分索引里删掉一项不计入写入），不产生服务消息；没有置顶时不写入 */
  async unpin(_chatId: string, actorId: string, seq: number): Promise<Result<Wrote | null>> {
    if (!this.initialized) return err('not_found')
    if (!this.isMember(actorId)) return err('forbidden')
    if (!this.canPin(actorId)) return err('forbidden')
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', seq)
    if (!row) return err('not_found')
    if (row.pinned_at === null) return ok(null)
    return ok(this.rewrite({ ...row, pinned_at: null }, actorId))
  }

  /**
   * 改写一条消息（2 行写入：messages 本身 + messages_by_pts 索引），并扇出给当前成员。
   * 前成员不在扇出范围内，打开只读对话时由 sync.chat 补齐。
   */
  private rewrite(next: MessageRow, actorId: string): Wrote {
    const changed: MessageRow = { ...next, pts: ++this.chatPts }
    this.sql.run(
      `UPDATE messages SET pts = ?, kind = ?, text = ?, entities = ?, media = ?, action = ?, reply_to = ?, edit_date = ?, reactions = ?,
       pinned_at = ?, fwd_from = ?, preview = ? WHERE seq = ?`,
      changed.pts, changed.kind, changed.text, changed.entities, changed.media, changed.action, changed.reply_to, changed.edit_date,
      changed.reactions, changed.pinned_at, changed.fwd_from, changed.preview, changed.seq,
    )
    // 去重窗口内重放原来的发送请求时，返回的也是最新的内容；回应者可能不是发送者，所以按发送者的视角（带 random_id）
    const recent = this.recent.get(`${changed.sender_id}:${changed.random_id}`)
    if (recent) recent.message = this.toMessage(changed, changed.sender_id)

    const event: FanoutEvent = { type: 'update_message', message: this.toMessage(changed, '') }
    for (const id of this.currentMembers()) if (id !== actorId) this.enqueue(id, [event])
    this.scheduleFlush()
    return { message: this.toMessage(changed, actorId), chat: this.snapshot }
  }

  // ---------- 群组 ----------

  async create(chatId: string, creatorId: string, randomId: number, title: string, userIds: string[]): Promise<Result<Wrote>> {
    const others = [...new Set(userIds)].filter((id) => id !== creatorId)
    if (!isGroupChatId(chatId) || others.length === 0 || others.length + 1 > MAX_GROUP_MEMBERS) return err('bad_request')

    const check = (): Result<Wrote> | null => {
      if (!this.initialized) return null
      // 重放建群请求返回第一次的结果；否则 ID 已被占用
      return this.dedup(creatorId, randomId) ?? err('bad_request')
    }
    const early = check()
    if (early) return early
    if ((await this.missingUsers(others)).length > 0) return err('not_found')
    const blocked = await this.blockedBy(creatorId, others)
    if (blocked.length > 0) return err('blocked', blocked)
    const late = check()
    if (late) return late

    const now = Date.now()
    this.putInfo({ chat_id: chatId, kind: 'group', title })
    this.chatId = chatId
    this.kind = 'group'
    this.title = title
    this.putMember(creatorId, { role: 'owner', joined_at: now, left_seq: null, last_read_seq: 0 })
    for (const id of others) this.putMember(id, { role: 'member', joined_at: now, left_seq: null, last_read_seq: 0 })
    const message = this.append(creatorId, randomId, service({ type: 'chat_create', title, user_ids: others }), others)
    return ok({ message, chat: this.snapshot })
  }

  /** 任何成员都能拉人；前成员被重新加入后恢复为成员 */
  async addMembers(_chatId: string, actorId: string, randomId: number, userIds: string[]): Promise<Result<Wrote>> {
    const check = (): Result<Wrote> | null => {
      if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
      if (!this.isMember(actorId)) return err('forbidden')
      return this.dedup(actorId, randomId)
    }
    const early = check()
    if (early) return early
    const candidates = [...new Set(userIds)].filter((id) => !this.isMember(id))
    if (candidates.length > 0 && (await this.missingUsers(candidates)).length > 0) return err('not_found')
    const blocked = await this.blockedBy(actorId, candidates)
    if (blocked.length > 0) return err('blocked', blocked)
    // await 期间成员可能已经变化，重新检查
    const late = check()
    if (late) return late
    const added = candidates.filter((id) => !this.isMember(id))
    if (added.length === 0) return err('bad_request')
    if (this.currentMembers().length + added.length > MAX_GROUP_MEMBERS) return err('chat_full')

    const now = Date.now()
    for (const id of added) {
      this.putMember(id, { role: 'member', joined_at: now, left_seq: null, last_read_seq: this.members.get(id)?.last_read_seq ?? 0 })
    }
    const message = this.append(actorId, randomId, service({ type: 'members_add', user_ids: added }), this.currentMembers())
    return ok({ message, chat: this.snapshot })
  }

  /** 群主移除成员：被移除的人也会收到这条服务消息，他的对话随之变为只读 */
  async removeMember(_chatId: string, actorId: string, randomId: number, userId: string): Promise<Result<Wrote>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    if (!this.isMember(actorId)) return err('forbidden')
    const dup = this.dedup(actorId, randomId)
    if (dup) return dup
    if (this.members.get(actorId)!.role !== 'owner') return err('forbidden')
    if (userId === actorId || !this.isMember(userId)) return err('bad_request')

    const targets = this.currentMembers()
    const message = this.append(actorId, randomId, service({ type: 'member_remove', user_id: userId }), targets)
    this.putMember(userId, { ...this.members.get(userId)!, role: 'member', left_seq: message.seq })
    await this.dropParticipant(userId)
    return ok({ message, chat: this.snapshot })
  }

  /** 主动退出；群主退出时群主身份转给最早入群的成员，最后一人退出后群组无人 */
  async leave(_chatId: string, actorId: string, randomId: number): Promise<Result<Wrote>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    const dup = this.dedup(actorId, randomId)
    if (dup) return dup
    if (!this.isMember(actorId)) return err('forbidden')

    const me = this.members.get(actorId)!
    const heir =
      me.role === 'owner'
        ? ([...this.members]
            .filter(([id, m]) => id !== actorId && m.left_seq === null)
            .sort(([a, x], [b, y]) => x.joined_at - y.joined_at || (a < b ? -1 : 1))[0]?.[0] ?? null)
        : null
    const targets = this.currentMembers()
    const message = this.append(actorId, randomId, service({ type: 'member_leave', new_owner_id: heir }), targets)
    this.putMember(actorId, { ...me, role: 'member', left_seq: message.seq })
    if (heir) this.putMember(heir, { ...this.members.get(heir)!, role: 'owner' })
    await this.dropParticipant(actorId)
    return ok({ message, chat: this.snapshot })
  }

  async editTitle(_chatId: string, actorId: string, randomId: number, title: string): Promise<Result<Wrote>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    if (!this.isMember(actorId)) return err('forbidden')
    const dup = this.dedup(actorId, randomId)
    if (dup) return dup
    if (this.members.get(actorId)!.role !== 'owner') return err('forbidden')

    this.putInfo({ title })
    this.title = title
    const message = this.append(actorId, randomId, service({ type: 'title_edit', title }), this.currentMembers())
    return ok({ message, chat: this.snapshot })
  }

  // ---------- 邀请链接 ----------

  /** 当前成员都能拿到邀请链接的令牌；第一次有人要时生成（1 行写入） */
  async getInvite(_chatId: string, userId: string): Promise<Result<{ token: string }>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    if (!this.isMember(userId)) return err('forbidden')
    if (this.invite === null) this.setInvite()
    return ok({ token: this.invite! })
  }

  /** 群主重置邀请链接：换一个令牌（1 行写入），旧链接随之失效；不产生服务消息 */
  async resetInvite(_chatId: string, userId: string): Promise<Result<{ token: string }>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    if (this.members.get(userId)?.role !== 'owner' || !this.isMember(userId)) return err('forbidden')
    this.setInvite()
    return ok({ token: this.invite! })
  }

  private setInvite() {
    this.invite = randomToken()
    this.putInfo({ [INVITE_KEY]: this.invite })
  }

  /**
   * 令牌不对返回 not_found；被群主移除、还没被拉回来的人返回 forbidden。只读，不写库。
   * 所有人都退出后群组没有群主，链接随之失效，不能凭它让一个没人管理的群组复活
   */
  private checkToken(userId: string, token: string): Result<null> {
    if (this.kind !== 'group' || this.invite === null || !sameToken(this.invite, token)) return err('not_found')
    if (this.currentMembers().length === 0) return err('not_found')
    if (this.removed(userId)) return err('forbidden')
    return ok(null)
  }

  /** 前成员是否是被群主移除的：离开时那条服务消息是不是移除他 */
  private removed(userId: string): boolean {
    const leftSeq = this.members.get(userId)?.left_seq
    if (leftSeq == null) return false
    const row = this.sql.one<{ action: string | null }>('SELECT action FROM messages WHERE seq = ?', leftSeq)
    const action = row?.action ? (JSON.parse(row.action) as ServiceAction) : null
    return action?.type === 'member_remove' && action.user_id === userId
  }

  /** 打开邀请链接时的预览：群名与人数；已经是成员的直接进入会话 */
  async checkInvite(chatId: string, userId: string, token: string): Promise<Result<InvitePreview>> {
    const check = this.checkToken(userId, token)
    if (!check.ok) return check
    return ok({ chat_id: chatId, title: this.title!, member_count: this.currentMembers().length, member: this.isMember(userId) })
  }

  /**
   * 凭邀请链接加入：不受任何人拉黑的影响。前成员加入后恢复为成员。
   * 写入 3 行：成员 1 行 + 服务消息 2 行；服务消息不推送
   */
  async join(_chatId: string, userId: string, randomId: number, token: string): Promise<Result<Wrote>> {
    // 重放加入请求返回第一次的结果，这时已经是成员了
    const dup = this.dedup(userId, randomId)
    if (dup) return dup
    const check = this.checkToken(userId, token)
    if (!check.ok) return check
    if (this.isMember(userId)) return err('bad_request')
    if (this.currentMembers().length >= MAX_GROUP_MEMBERS) return err('chat_full')

    const prev = this.members.get(userId)
    this.putMember(userId, { role: 'member', joined_at: Date.now(), left_seq: null, last_read_seq: prev?.last_read_seq ?? 0 })
    const message = this.append(userId, randomId, service({ type: 'member_join' }), this.currentMembers())
    return ok({ message, chat: this.snapshot })
  }

  /** 会话资料与当前成员；只对当前成员开放 */
  async get(chatId: string, userId: string): Promise<Result<{ chat: ChatInfo }>> {
    if (this.gone) return err('not_found')
    if (!this.initialized) return err(isGroupChatId(chatId) ? 'not_found' : 'forbidden')
    if (!this.isMember(userId)) return err('forbidden')
    const members = [...this.members]
      .filter(([, m]) => m.left_seq === null)
      .map(([user_id, m]) => ({ user_id, role: m.role, joined_at: m.joined_at }))
    return ok({ chat: { chat_id: this.chatId!, kind: this.kind!, title: this.title, members } })
  }

  // ---------- 已读 ----------

  /**
   * 私聊已读回执：记下自己的已读位置（1 行），前移时扇出给对方。
   * 群组暂不展示已读回执，UserDO 不会为群组调用这里。
   */
  async read(_chatId: string, userId: string, maxSeq: number): Promise<Result<null>> {
    if (this.gone) return err('not_found')
    if (this.kind !== 'private' && this.kind !== 'secret') return err(this.initialized ? 'bad_request' : 'not_found')
    if (!this.isMember(userId)) return err('forbidden')
    const me = this.members.get(userId)!
    const seq = Math.min(maxSeq, this.topSeq)
    if (seq <= me.last_read_seq) return ok(null)

    this.sql.run('UPDATE members SET last_read_seq = ? WHERE user_id = ?', seq, userId)
    me.last_read_seq = seq
    // 拉黑期间对方看不到我新的已读；解除后下一次已读会带上最新位置
    if (this.blockers.has(userId)) return ok(null)
    for (const id of this.currentMembers()) if (id !== userId) this.enqueue(id, [{ type: 'peer_read', max_seq: seq }])
    this.scheduleFlush()
    return ok(null)
  }

  // ---------- 通话 ----------
  // 见 docs/architecture/04-realtime-and-fanout.md § 通话

  private toCall(c: CallState): Call {
    return {
      call_id: c.call_id,
      chat_id: this.chatId!,
      caller_id: c.caller_id,
      callee_id: c.callee_id,
      state: c.accepted_at === null ? 'ringing' : 'active',
      started_at: c.started_at,
      ...(c.callee_device ? { device_id: c.callee_device } : {}),
    }
  }

  /** 写通话状态（1 行）；设了期限时排上 Alarm */
  private async putCall(c: CallState) {
    this.call = c
    this.putInfo({ [CALL_KEY]: JSON.stringify(c) })
    if (c.deadline !== null) await this.armAlarm(c.deadline)
  }

  /** 去重窗口内已经结束的通话：由它留下的通话记录还原 */
  private endedCall(callerId: string, callId: string): Call | null {
    const dup = this.recent.get(`${callerId}:${callRandomId(callId)}`)?.message
    if (dup?.kind !== 'service' || dup.action.type !== 'call' || dup.action.call_id !== callId) return null
    const callee = parsePrivateChatId(this.chatId!)!.find((id) => id !== callerId)!
    return {
      call_id: callId,
      chat_id: this.chatId!,
      caller_id: callerId,
      callee_id: callee,
      state: 'ended',
      started_at: dup.date,
      result: dup.action.result,
    }
  }

  /**
   * 发起通话（1 行写入 + Alarm）：对方正好在呼叫我时返回对方的来电；对方的 UserDO 报告忙线时立即结束（busy）。
   * 第一次联系的私聊在这里初始化，与发第一条消息相同
   */
  async startCall(chatId: string, callerId: string, deviceId: string, callId: string): Promise<Result<Call>> {
    if (!this.initialized) {
      if (isGroupChatId(chatId)) return err('not_found')
      if (parsePrivateChatId(chatId)?.includes(callerId) && this.blockers.size > 0) return err('blocked')
      const res = await this.initPrivate(chatId, callerId)
      if (!res.ok) return res
    }
    if (this.kind !== 'private') return err('bad_request')
    if (!this.isMember(callerId)) return err('forbidden')
    const ended = this.endedCall(callerId, callId)
    if (ended) return ok(ended)
    if (this.blockers.size > 0) return err('blocked')
    let cur = this.call
    if (cur && cur.call_id !== callId && cur.lost_at !== null) {
      // 有一方掉线、正等它重连时，任何一方重新呼叫都说明不回去了：结束旧的再呼叫，免得双方都忙线到期满
      this.finishCall('ended')
      cur = null
    }
    if (cur) {
      // 重放发起请求；或者对方正好在呼叫我，返回对方的来电
      if (cur.call_id === callId || (cur.callee_id === callerId && cur.accepted_at === null)) return ok(this.toCall(cur))
      return err('busy')
    }

    const now = Date.now()
    const calleeId = parsePrivateChatId(chatId)!.find((id) => id !== callerId)!
    const state: CallState = {
      call_id: callId,
      caller_id: callerId,
      callee_id: calleeId,
      caller_device: deviceId,
      callee_device: null,
      started_at: now,
      accepted_at: null,
      deadline: now + RING_TIMEOUT_MS,
      lost_at: null,
    }
    await this.putCall(state)
    let busy = false
    try {
      busy = (await this.env.USER.getByName(calleeId).onCall(this.toCall(state))) === 'busy'
    } catch (e) {
      // 对方没响铃也照样等到超时，成为未接来电
      console.error('ring failed', { chat_id: chatId, error: String(e) })
    }
    // await 期间通话可能已经被取消或接听
    if (this.call?.call_id !== callId) return ok(this.endedCall(callerId, callId) ?? this.toCall(state))
    if (busy) return ok(this.finishCall('busy', calleeId))
    return ok(this.toCall(this.call))
  }

  /** 被叫方在一台设备上接听（1 行写入）：通知主叫方开始协商；被叫方自己的设备由他的 UserDO 通知 */
  async acceptCall(_chatId: string, userId: string, deviceId: string, callId: string): Promise<Result<Call>> {
    const cur = this.call
    if (!cur || cur.call_id !== callId || cur.callee_id !== userId || cur.accepted_at !== null) return err('call_ended')
    await this.putCall({ ...cur, callee_device: deviceId, accepted_at: Date.now(), deadline: null })
    const call = this.toCall(this.call!)
    this.notifyCall(call, [cur.caller_id])
    return ok(call)
  }

  /** 挂断：已经结束的不报错，返回 null；否则返回结束后的通话。另一方由这里通知，自己的设备由自己的 UserDO 通知 */
  async endCall(_chatId: string, userId: string, callId: string): Promise<Result<Call | null>> {
    const cur = this.call
    if (!cur || cur.call_id !== callId) return ok(null)
    if (cur.caller_id !== userId && cur.callee_id !== userId) return err('forbidden')
    return ok(this.finishCall(hangUpResult(cur, userId), userId))
  }

  /**
   * 结束通话：删除通话状态（1 行），以主叫方的名义写一条通话记录（2 行），扇出给双方（包括主叫方自己）。
   * 通知双方的 UserDO，except 为发起结束、自己负责通知的那一方
   */
  private finishCall(result: CallResult, except?: string): Call {
    const c = this.call!
    this.call = null
    this.sql.run('DELETE FROM info WHERE key = ?', CALL_KEY)
    const end = c.lost_at ?? Date.now()
    const duration = result === 'ended' ? { duration: Math.max(0, Math.round((end - c.accepted_at!) / 1000)) } : {}
    const action: ServiceAction = { type: 'call', call_id: c.call_id, result, ...duration }
    this.append(c.caller_id, callRandomId(c.call_id), service(action), this.currentMembers(), true)
    const call: Call = { ...this.toCall(c), state: 'ended', result }
    this.notifyCall(call, [c.caller_id, c.callee_id].filter((id) => id !== except))
    return call
  }

  /** 通知 UserDO 通话状态的变化，不等待；丢了的由客户端重连后的 calls.current 补齐 */
  private notifyCall(call: Call, userIds: string[]) {
    this.ctx.waitUntil(
      pool(userIds, FANOUT_CONCURRENCY, async (id) => {
        try {
          await this.env.USER.getByName(id).onCall(call)
        } catch (e) {
          console.error('call notify failed', { chat_id: this.chatId, user_id: id, error: String(e) })
        }
      }),
    )
  }

  /** 进行中、并且 userId 参与的通话；用于 UserDO 核实忙线与重连后的询问 */
  async currentCall(_chatId: string, userId: string, callId: string): Promise<Call | null> {
    const cur = this.call
    if (!cur || cur.call_id !== callId || (cur.caller_id !== userId && cur.callee_id !== userId)) return null
    return this.toCall(cur)
  }

  /**
   * 通话所在的设备断开了连接：响铃中主叫方断开即取消；接通后等 CALL_GRACE_MS，期间认领回来就继续（1 行写入 + Alarm）
   */
  async deviceGone(_chatId: string, userId: string, deviceId: string, callId: string): Promise<void> {
    const cur = this.call
    if (!cur || cur.call_id !== callId || !onDevice(cur, userId, deviceId)) return
    if (cur.accepted_at === null) {
      if (userId === cur.caller_id) this.finishCall('canceled')
      return
    }
    if (cur.lost_at !== null) return
    const now = Date.now()
    await this.putCall({ ...cur, lost_at: now, deadline: now + CALL_GRACE_MS })
  }

  /** 断线的设备重新连上后认领通话：取消认领期限（1 行写入）；通话已经结束返回 call_ended */
  async claimCall(_chatId: string, userId: string, deviceId: string, callId: string): Promise<Result<Call>> {
    const cur = this.call
    if (!cur || cur.call_id !== callId || !onDevice(cur, userId, deviceId)) return err('call_ended')
    if (cur.lost_at !== null) await this.putCall({ ...cur, lost_at: null, deadline: cur.accepted_at === null ? cur.deadline : null })
    return ok(this.toCall(this.call!))
  }

  // ---------- 群组通话 ----------
  // 见 docs/architecture/04-realtime-and-fanout.md § 群组通话。媒体经 Realtime SFU；这里持有房间状态，
  // 并替参与者操作他自己的 SFU session（客户端只说拉谁的哪路媒体，session 与 track 名由这里换算）

  private toGroupCall(g: GroupCallState): GroupCall {
    return {
      call_id: g.call_id,
      chat_id: this.chatId!,
      started_by: g.started_by,
      started_at: g.started_at,
      seq: g.seq,
      participants: Object.entries(g.participants)
        .sort(([a, x], [b, y]) => x.joined_at - y.joined_at || (a < b ? -1 : 1))
        .map(([user_id, p]) => ({
          user_id,
          joined_at: p.joined_at,
          muted: p.muted,
          tracks: Object.fromEntries(Object.entries(p.tracks).map(([slot, t]) => [slot, t.name])),
        })),
    }
  }

  /** 最早到期的掉线认领期限 */
  private groupDeadline(g: GroupCallState | null): number | null {
    const lost = Object.values(g?.participants ?? {}).flatMap((p) => (p.lost_at === null ? [] : [p.lost_at + CALL_GRACE_MS]))
    return lost.length > 0 ? Math.min(...lost) : null
  }

  /** 写群组通话的状态（1 行）；有人掉线时排上 Alarm */
  private async putGroupCall(g: GroupCallState) {
    this.groupCall = g
    this.putInfo({ [GROUP_CALL_KEY]: JSON.stringify(g) })
    const deadline = this.groupDeadline(g)
    if (deadline !== null) await this.armAlarm(deadline)
  }

  /**
   * 通知 UserDO 群组通话的变化，不等待：参与者，加上正在查看这个群组的成员（他们据此显示横条；
   * onlyParticipants 时只有参与者，比如开关麦克风与摄像头）。extra 为刚离开的人。丢了的由客户端重新查看时补齐
   */
  private notifyGroupCall(onlyParticipants: boolean, extra: string[] = []) {
    const g = this.groupCall
    const call = g ? this.toGroupCall(g) : null
    const now = Date.now()
    const targets = new Set([...Object.keys(g?.participants ?? {}), ...extra])
    if (!onlyParticipants) {
      for (const [id, expires] of this.viewers) if (expires > now && this.isMember(id)) targets.add(id)
    }
    const chatId = this.chatId!
    this.ctx.waitUntil(
      pool([...targets], FANOUT_CONCURRENCY, async (id) => {
        try {
          await this.env.USER.getByName(id).onGroupCall(id, chatId, call)
        } catch (e) {
          console.error('group call notify failed', { chat_id: chatId, user_id: id, error: String(e) })
        }
      }),
    )
  }

  /** 关掉一个 SFU session 上的所有 track，不等待；失败只记日志（掉线 30 秒后 SFU 自己也会回收） */
  private closeSession(session: string | null) {
    if (!session) return
    this.ctx.waitUntil(
      this.sfu.closeAll(session).catch((e: unknown) => console.error('sfu close failed', { chat_id: this.chatId, error: String(e) })),
    )
  }

  /** 正在通话里、并且在这台设备上的参与者 */
  private participant(userId: string, deviceId: string, callId: string): GroupParticipant | null {
    const p = this.groupCall?.call_id === callId ? this.groupCall.participants[userId] : undefined
    return p && p.device_id === deviceId ? p : null
  }

  /** 进行中的群组通话；只给当前成员看 */
  currentGroupCall(_chatId: string, userId: string): GroupCall | null {
    return this.groupCall && this.isMember(userId) ? this.toGroupCall(this.groupCall) : null
  }

  /** 这个人还在这次群组通话里（判断忙线用）：返回快照 */
  async groupCallOf(_chatId: string, userId: string, callId: string): Promise<GroupCall | null> {
    const g = this.groupCall
    return g && g.call_id === callId && g.participants[userId] ? this.toGroupCall(g) : null
  }

  /**
   * 在这台设备上加入（1 行写入）；没有进行中的通话时以 callId 发起，同时写通话记录（发起者开着麦克风，其余人加入时静音）。
   * 已经在别的设备上的，转到这台设备，原来那台的 SFU session 随即关掉；同一台设备重新加入也一样（连接坏了，换新 session 重来）
   */
  async joinGroupCall(_chatId: string, userId: string, deviceId: string, callId: string): Promise<Result<GroupCall>> {
    if (this.kind !== 'group') return err(this.initialized ? 'bad_request' : 'not_found')
    if (!this.isMember(userId)) return err('forbidden')
    const now = Date.now()
    let g = this.groupCall
    const starting = g === null
    if (!g) {
      // 去重窗口内重放已经结束的那次发起
      if (this.recent.has(`${userId}:${callRandomId(callId)}`)) return err('call_ended')
      const message = this.append(userId, callRandomId(callId), service({ type: 'group_call', call_id: callId }), this.currentMembers(), true)
      g = { call_id: callId, started_by: userId, started_at: now, seq: message.seq, joined: [], participants: {} }
    }
    const prev = g.participants[userId]
    this.closeSession(prev?.session_id ?? null)
    const next: GroupCallState = {
      ...g,
      joined: g.joined.includes(userId) ? g.joined : [...g.joined, userId],
      participants: {
        ...g.participants,
        [userId]: { device_id: deviceId, session_id: null, tracks: {}, muted: prev?.muted ?? !starting, joined_at: prev?.joined_at ?? now, lost_at: null },
      },
    }
    await this.putGroupCall(next)
    this.notifyGroupCall(false)
    return ok(this.toGroupCall(next))
  }

  /** 离开；已经不在的不报错 */
  async leaveGroupCall(_chatId: string, userId: string, callId: string): Promise<Result<null>> {
    if (this.groupCall?.call_id === callId) await this.dropParticipant(userId)
    return ok(null)
  }

  /**
   * 让一个人离开群组通话（离开、退群、被移除、掉线超时）：关掉他的 SFU session；最后一人离开时通话结束，
   * 通话记录改写为带时长的（按最后那人掉线或离开的时刻）
   */
  private async dropParticipant(userId: string) {
    const g = this.groupCall
    const p = g?.participants[userId]
    if (!g || !p) return
    this.closeSession(p.session_id)
    const { [userId]: _, ...rest } = g.participants
    if (Object.keys(rest).length > 0) {
      await this.putGroupCall({ ...g, participants: rest })
      this.notifyGroupCall(false, [userId])
      return
    }
    this.groupCall = null
    this.sql.run('DELETE FROM info WHERE key = ?', GROUP_CALL_KEY)
    const end = p.lost_at ?? Date.now()
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', g.seq)
    if (row) {
      const action: ServiceAction = {
        type: 'group_call',
        call_id: g.call_id,
        duration: Math.max(0, Math.round((end - g.started_at) / 1000)),
        joined: g.joined,
      }
      // 所有成员（包括发起者）都要收到这条改写，不排除动作者
      this.rewrite({ ...row, action: JSON.stringify(action) }, '')
    }
    this.notifyGroupCall(false, [userId])
  }

  /** 参与者的 SFU session，没有就建一个（不写库，由调用方随后一起写） */
  private async sessionOf(p: GroupParticipant): Promise<string> {
    return p.session_id ?? (await this.sfu.newSession())
  }

  /** SFU 操作期间这个人可能已经离开或换了设备：还在就按 update 改写他的状态（1 行），否则返回 null */
  private async updateParticipant(userId: string, deviceId: string, callId: string, update: (p: GroupParticipant) => GroupParticipant) {
    const p = this.participant(userId, deviceId, callId)
    const g = this.groupCall
    if (!p || !g) return null
    const next = update(p)
    await this.putGroupCall({ ...g, participants: { ...g.participants, [userId]: next } })
    return next
  }

  private async sfuOp<T>(op: () => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await op())
    } catch (e) {
      if (!(e instanceof SfuError)) throw e
      console.error('sfu failed', { chat_id: this.chatId, error: e.message })
      return err('internal')
    }
  }

  /** 发布本端的媒体（1 行写入）：sdp 为压缩的 offer；发布麦克风即开麦。返回 SFU 的 answer */
  async publishGroupCall(
    _chatId: string,
    userId: string,
    deviceId: string,
    callId: string,
    packed: string,
    tracks: { mid: string; slot: CallSlot }[],
  ): Promise<Result<{ sdp: string }>> {
    const p = this.participant(userId, deviceId, callId)
    if (!p) return err('call_ended')
    const sdp = await unpackSdp(packed)
    if (!sdp || new Set(tracks.map((t) => t.slot)).size !== tracks.length) return err('bad_request')
    const named = tracks.map((t) => ({ ...t, name: `${t.slot}-${randomToken().slice(0, 8)}` }))
    const res = await this.sfuOp(async () => {
      const session = await this.sessionOf(p)
      return { session, answer: await this.sfu.publish(session, { type: 'offer', sdp }, named) }
    })
    if (!res.ok) return res
    const { session, answer } = res.r
    const next = await this.updateParticipant(userId, deviceId, callId, (cur) => ({
      ...cur,
      session_id: session,
      tracks: { ...cur.tracks, ...Object.fromEntries(named.map((t) => [t.slot, { name: t.name, mid: t.mid }])) },
      muted: named.some((t) => t.slot === 'mic') ? false : cur.muted,
    }))
    if (!next) {
      this.closeSession(session)
      return err('call_ended')
    }
    this.notifyGroupCall(true)
    return ok({ sdp: answer.sdp })
  }

  /** 停止发布（1 行写入）：sdp 为停掉收发器之后压缩的 offer。返回 SFU 的 answer */
  async unpublishGroupCall(
    _chatId: string,
    userId: string,
    deviceId: string,
    callId: string,
    packed: string,
    slots: CallSlot[],
  ): Promise<Result<{ sdp: string }>> {
    const p = this.participant(userId, deviceId, callId)
    if (!p?.session_id) return err('call_ended')
    const session = p.session_id
    const sdp = await unpackSdp(packed)
    const mids = slots.flatMap((slot) => (p.tracks[slot] ? [p.tracks[slot].mid] : []))
    if (!sdp || mids.length !== slots.length) return err('bad_request')
    const res = await this.sfuOp(() => this.sfu.unpublish(session, { type: 'offer', sdp }, mids))
    if (!res.ok) return res
    const next = await this.updateParticipant(userId, deviceId, callId, (cur) => ({
      ...cur,
      tracks: Object.fromEntries(Object.entries(cur.tracks).filter(([slot]) => !slots.includes(slot as CallSlot))),
    }))
    if (!next) return err('call_ended')
    this.notifyGroupCall(true)
    return ok({ sdp: res.r.sdp })
  }

  /**
   * 拉取别人发布的媒体：按人与媒体换算成 SFU 的 session 与 track，摄像头按 rid 选层（默认 h）。
   * 已经不在发的标为 gone。第一次拉取时建 session（1 行写入），之后不写库
   */
  async pullGroupCall(
    _chatId: string,
    userId: string,
    deviceId: string,
    callId: string,
    wanted: { user_id: string; slot: CallSlot; rid?: SimulcastRid }[],
  ): Promise<Result<{ sdp: string | null; tracks: ({ user_id: string; slot: CallSlot } & ({ track: string; mid: string } | { error: 'gone' }))[] }>> {
    const p = this.participant(userId, deviceId, callId)
    const g = this.groupCall
    if (!p || !g) return err('call_ended')
    const resolved = wanted.map((w) => {
      const owner = w.user_id === userId ? undefined : g.participants[w.user_id]
      const track = owner?.tracks[w.slot]
      return owner?.session_id && track ? { ...w, session: owner.session_id, name: track.name } : null
    })
    const found = resolved.filter((r) => r !== null)
    if (found.length === 0) return ok({ sdp: null, tracks: wanted.map((w) => ({ user_id: w.user_id, slot: w.slot, error: 'gone' as const })) })
    const res = await this.sfuOp(async () => {
      const session = await this.sessionOf(p)
      const pulled = await this.sfu.pull(
        session,
        found.map((f) => ({ session: f.session, name: f.name, ...(f.slot === 'camera' ? { rid: f.rid ?? 'h' } : {}) })),
      )
      return { session, ...pulled }
    })
    if (!res.ok) return res
    const { session, offer, mids } = res.r
    if (p.session_id !== session) {
      const next = await this.updateParticipant(userId, deviceId, callId, (cur) => ({ ...cur, session_id: session }))
      if (!next) {
        this.closeSession(session)
        return err('call_ended')
      }
    }
    let i = 0
    const tracks = resolved.map((r, k) => {
      const w = wanted[k]!
      const mid = r ? mids[i++] : null
      return r && mid ? { user_id: w.user_id, slot: w.slot, track: r.name, mid } : { user_id: w.user_id, slot: w.slot, error: 'gone' as const }
    })
    return ok({ sdp: offer?.sdp ?? null, tracks })
  }

  /** 回给 SFU 的 answer（压缩），不写库 */
  async answerGroupCall(_chatId: string, userId: string, deviceId: string, callId: string, packed: string): Promise<Result<null>> {
    const p = this.participant(userId, deviceId, callId)
    if (!p?.session_id) return err('call_ended')
    const session = p.session_id
    const sdp = await unpackSdp(packed)
    if (!sdp) return err('bad_request')
    const res = await this.sfuOp(() => this.sfu.renegotiate(session, { type: 'answer', sdp }))
    return res.ok ? ok(null) : res
  }

  /** 换一路已拉取的摄像头的 simulcast 层，不写库 */
  async layerGroupCall(
    _chatId: string,
    userId: string,
    deviceId: string,
    callId: string,
    mid: string,
    ownerId: string,
    rid: SimulcastRid,
  ): Promise<Result<null>> {
    const p = this.participant(userId, deviceId, callId)
    const owner = this.groupCall?.participants[ownerId]
    const track = owner?.tracks.camera
    if (!p?.session_id) return err('call_ended')
    if (!owner?.session_id || !track || ownerId === userId) return ok(null)
    const session = p.session_id
    const remote = { session: owner.session_id, name: track.name }
    const res = await this.sfuOp(() => this.sfu.layer(session, mid, remote, rid))
    return res.ok ? ok(null) : res
  }

  /** 开关麦克风（有变化时 1 行写入），只是告诉其他参与者 */
  async muteGroupCall(_chatId: string, userId: string, deviceId: string, callId: string, muted: boolean): Promise<Result<null>> {
    const p = this.participant(userId, deviceId, callId)
    if (!p) return err('call_ended')
    if (p.muted === muted) return ok(null)
    await this.updateParticipant(userId, deviceId, callId, (cur) => ({ ...cur, muted }))
    this.notifyGroupCall(true)
    return ok(null)
  }

  /** 参与者所在的设备断开了连接：CALL_GRACE_MS 内认领回来就继续，否则离开（1 行写入 + Alarm）。SFU 的媒体不经过 WebSocket */
  async groupDeviceGone(_chatId: string, userId: string, deviceId: string, callId: string): Promise<void> {
    const p = this.participant(userId, deviceId, callId)
    if (!p || p.lost_at !== null) return
    await this.updateParticipant(userId, deviceId, callId, (cur) => ({ ...cur, lost_at: Date.now() }))
  }

  /** 断线的设备重新连上后认领（有掉线记录时 1 行写入）；已经不在通话里返回 call_ended */
  async claimGroupCall(_chatId: string, userId: string, deviceId: string, callId: string): Promise<Result<GroupCall>> {
    const p = this.participant(userId, deviceId, callId)
    if (!p) return err('call_ended')
    if (p.lost_at !== null) await this.updateParticipant(userId, deviceId, callId, (cur) => ({ ...cur, lost_at: null }))
    return ok(this.toGroupCall(this.groupCall!))
  }

  // ---------- 秘密聊天 ----------
  // 见 docs/adr/0010-secret-chats-multi-device-mls.md。MLS 运算都在客户端；这里只转存密文与提交，
  // 按纪元给提交排序，并核对加入、移除的设备与双方现有的设备

  private get secretState(): SecretState {
    const s = this.secret!
    return { epoch: s.epoch, leaves: s.leaves, devices: Object.fromEntries(this.devices), resets: s.resets }
  }

  /** 秘密聊天的成员身份检查：会话存在、没被删除、是成员 */
  private checkSecret(userId: string): Result<null> {
    if (this.kind !== 'secret' || this.gone) return err('not_found')
    if (!this.isMember(userId)) return err('forbidden')
    return ok(null)
  }

  private putSecret(meta: SecretMeta) {
    this.secret = meta
    this.putInfo({ [SECRET_KEY]: JSON.stringify(meta) })
  }

  /** 组里的设备与双方现有的设备不一致，或有设备等着重新加入 */
  private secretPending(): boolean {
    const s = this.secret
    if (!s) return false
    if (s.resets.length > 0) return true
    const leaves = new Set(s.leaves.map((l) => l.device_id))
    for (const [userId, ids] of this.devices) {
      if (ids.some((id) => !leaves.has(id))) return true
      if (s.leaves.some((l) => l.user_id === userId && !ids.includes(l.device_id))) return true
    }
    return false
  }

  /** 告诉双方的设备拉取状态与提交（瞬时，丢了由下一次连接时的检查补上） */
  private notifySecret() {
    const chatId = this.chatId!
    this.ctx.waitUntil(
      pool(this.currentMembers(), FANOUT_CONCURRENCY, async (id) => {
        try {
          await this.env.USER.getByName(id).onSecret(chatId)
        } catch {
          // 瞬时事件，丢了无害
        }
      }),
    )
  }

  /**
   * 开始秘密聊天（纪元 1）：发起设备已经用领到的 KeyPackage 建好组，adds 为 Welcome 里加入的设备。
   * 对方拉黑了发起者时失败（发起者自己拉黑了对方由 UserDO 拒绝）。重放返回第一次的结果
   */
  async createSecret(
    chatId: string,
    creatorId: string,
    deviceId: string,
    randomId: number,
    welcome: string,
    adds: SecretDevice[],
  ): Promise<Result<Wrote>> {
    const pair = parseSecretChatId(chatId)
    if (!pair?.includes(creatorId)) return err('forbidden')
    const peerId = pair[0] === creatorId ? pair[1] : pair[0]
    if (adds.some((d) => !pair.includes(d.user_id) || d.device_id === deviceId)) return err('bad_request')
    const check = (): Result<Wrote> | null => {
      if (!this.initialized && !this.gone) return null
      return this.dedup(creatorId, randomId) ?? err('bad_request')
    }
    const early = check()
    if (early) return early
    if ((await this.missingUsers([peerId])).length > 0) return err('not_found')
    if (await this.env.USER.getByName(peerId).hasBlocked(creatorId)) return err('blocked')
    const [mine, theirs] = await Promise.all(pair.map((id) => this.env.USER.getByName(id).secretDevices(id)))
    const late = check()
    if (late) return late

    const now = Date.now()
    this.putInfo({
      chat_id: chatId,
      kind: 'secret',
      [DEVICES_KEY + pair[0]]: JSON.stringify(mine),
      [DEVICES_KEY + pair[1]]: JSON.stringify(theirs),
    })
    this.chatId = chatId
    this.kind = 'secret'
    this.devices = new Map([
      [pair[0], mine!],
      [pair[1], theirs!],
    ])
    this.putSecret({ epoch: 1, leaves: [{ user_id: creatorId, device_id: deviceId }, ...adds], resets: [] })
    for (const id of pair) this.putMember(id, { role: 'member', joined_at: now, left_seq: null, last_read_seq: 0 })
    this.sql.run(
      'INSERT INTO commits (epoch, sender_id, device_id, date, data, welcome, adds, removes) VALUES (1, ?, ?, ?, NULL, ?, ?, ?)',
      creatorId, deviceId, now, welcome, JSON.stringify(adds), '[]',
    )
    const message = this.append(creatorId, randomId, service({ type: 'secret_create' }), pair)
    return ok({ message, chat: this.snapshot })
  }

  async secretStateOf(_chatId: string, userId: string): Promise<Result<SecretState>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    return ok(this.secretState)
  }

  /** 纪元 after 之后的提交；加入了 deviceId 的提交带 Welcome */
  async secretCommits(_chatId: string, userId: string, deviceId: string, after: number): Promise<Result<{ commits: SecretCommit[] }>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    const rows = this.sql.all<CommitRow>('SELECT * FROM commits WHERE epoch > ? ORDER BY epoch LIMIT ?', after, COMMITS_PAGE)
    const commits = rows.map((r): SecretCommit => {
      const adds = JSON.parse(r.adds) as SecretDevice[]
      const commit: SecretCommit = {
        epoch: r.epoch,
        sender_id: r.sender_id,
        device_id: r.device_id,
        date: r.date,
        commit: r.data,
        adds,
        removes: JSON.parse(r.removes) as string[],
      }
      if (r.welcome && adds.some((d) => d.device_id === deviceId)) commit.welcome = r.welcome
      return commit
    })
    return ok({ commits })
  }

  /**
   * 提交（1 行，加上成员状态 1 行）：只有组里的设备能提交，并且必须基于当前纪元，否则 stale_epoch。
   * 加入的设备必须是双方现有的设备、还不在组里（要重新加入的除外，它们须同时被移除）；移除的必须在组里。
   * 有设备加入时写一条服务消息（2 行），安全码随之变化
   */
  async secretCommit(
    _chatId: string,
    userId: string,
    deviceId: string,
    epoch: number,
    data: string,
    welcome: string | undefined,
    adds: SecretDevice[],
    removes: string[],
  ): Promise<Result<null>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    const s = this.secret!
    if (!s.leaves.some((l) => l.device_id === deviceId && l.user_id === userId)) return err('forbidden')
    if (epoch !== s.epoch + 1) return err('stale_epoch')
    if (adds.length + removes.length === 0 || (adds.length > 0) !== (welcome !== undefined)) return err('bad_request')
    const leaves = new Set(s.leaves.map((l) => l.device_id))
    const removing = new Set(removes)
    if (removing.size !== removes.length || removes.some((id) => !leaves.has(id))) return err('bad_request')
    const adding = new Set<string>()
    for (const d of adds) {
      if (adding.has(d.device_id) || !this.devices.get(d.user_id)?.includes(d.device_id)) return err('bad_request')
      if (leaves.has(d.device_id) && !removing.has(d.device_id)) return err('bad_request')
      adding.add(d.device_id)
    }

    this.sql.run(
      'INSERT INTO commits (epoch, sender_id, device_id, date, data, welcome, adds, removes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      epoch, userId, deviceId, Date.now(), data, welcome ?? null, JSON.stringify(adds), JSON.stringify(removes),
    )
    this.putSecret({
      epoch,
      leaves: [...s.leaves.filter((l) => !removing.has(l.device_id)), ...adds],
      resets: s.resets.filter((id) => !adding.has(id)),
    })
    if (adds.length > 0) {
      const users = [...new Set(adds.map((d) => d.user_id))]
      this.append(userId, randomSafeInt(), service({ type: 'secret_devices', user_ids: users }), this.currentMembers(), true)
    }
    this.notifySecret()
    return ok(null)
  }

  /** 由 UserDO 调用：一方现有的设备变了（新设备上传了 KeyPackage、设备被移除）；与组里的不一致时通知双方 */
  async setSecretDevices(_chatId: string, userId: string, devices: string[]): Promise<void> {
    if (this.checkSecret(userId).ok === false) return
    const sorted = [...devices].sort()
    if (JSON.stringify(sorted) === JSON.stringify(this.devices.get(userId) ?? [])) return
    this.devices.set(userId, sorted)
    this.putInfo({ [DEVICES_KEY + userId]: JSON.stringify(sorted) })
    if (this.secretPending()) this.notifySecret()
  }

  /** 设备丢了本地状态：记下它，等成员设备把它移除后重新加入（1 行） */
  async secretReset(_chatId: string, userId: string, deviceId: string): Promise<Result<null>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    const s = this.secret!
    if (!s.leaves.some((l) => l.device_id === deviceId && l.user_id === userId)) return ok(null)
    if (!s.resets.includes(deviceId)) this.putSecret({ ...s, resets: [...s.resets, deviceId] })
    this.notifySecret()
    return ok(null)
  }

  /** 发送密文：必须用当前纪元加密；keys 为已复制到发送后的键的媒体对象，撤回与删除时据此删除 */
  async sendSecret(
    _chatId: string,
    senderId: string,
    randomId: number,
    epoch: number,
    cipher: string,
    keys: string[] = [],
  ): Promise<Result<Wrote>> {
    const check = this.checkSecret(senderId)
    if (!check.ok) return check
    // 确认丢了的重放仍返回原来的结果，即使纪元已经变了
    const dup = this.dedup(senderId, randomId)
    if (dup) return dup
    if (this.blockers.size > 0) return err('blocked')
    if (epoch !== this.secret!.epoch) return err('stale_epoch')
    const message = this.append(senderId, randomId, { kind: 'cipher', cipher }, this.currentMembers(), false, keys)
    return ok({ message, chat: this.snapshot })
  }

  /** 编辑自己的消息：整条换成新的密文（同样必须用当前纪元） */
  async editSecret(_chatId: string, userId: string, seq: number, epoch: number, cipher: string): Promise<Result<Wrote | null>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    if (this.blockers.size > 0) return err('blocked')
    if (epoch !== this.secret!.epoch) return err('stale_epoch')
    return this.change(_chatId, userId, seq, EDIT_WINDOW_MS, (row) => {
      if (row.kind !== 'cipher') return err('bad_request')
      if (row.text === cipher) return ok(null)
      return ok({ ...row, text: cipher, edit_date: Date.now() })
    })
  }

  /** 回应：每人一个加密的回应，null 为取消；没有变化时不写入 */
  async reactSecret(_chatId: string, userId: string, seq: number, epoch: number, cipher: string | null): Promise<Result<Wrote | null>> {
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    if (this.blockers.size > 0) return err('blocked')
    if (cipher !== null && epoch !== this.secret!.epoch) return err('stale_epoch')
    const row = this.sql.one<MessageRow>('SELECT * FROM messages WHERE seq = ?', seq)
    if (!row) return err('not_found')
    if (row.kind !== 'cipher') return err('bad_request')
    const cur = row.reactions ? (JSON.parse(row.reactions) as Record<string, string>) : {}
    if ((cur[userId] ?? null) === cipher) return ok(null)
    const next = { ...cur }
    if (cipher === null) delete next[userId]
    else next[userId] = cipher
    const reactions = Object.keys(next).length > 0 ? JSON.stringify(next) : null
    return ok(this.rewrite({ ...row, reactions }, userId))
  }

  /**
   * 删除秘密聊天，对双方生效：删掉所有消息、提交与加密的媒体对象，留下成员与删除标记（之后的请求都当它不存在），
   * 通知另一方的 UserDO 删除对话；发起者的由它自己的 UserDO 处理
   */
  async deleteSecret(_chatId: string, userId: string): Promise<Result<null>> {
    if (this.gone && this.members.has(userId)) return ok(null)
    const check = this.checkSecret(userId)
    if (!check.ok) return check
    const keys = this.sql.all<MessageRow>("SELECT * FROM messages WHERE kind = 'cipher' AND media IS NOT NULL").flatMap(rowKeys)
    this.deleteMedia(keys)
    this.sql.run('DELETE FROM messages')
    this.sql.run('DELETE FROM commits')
    this.sql.run('DELETE FROM info WHERE key = ?', SECRET_KEY)
    this.putInfo({ [DELETED_KEY]: '1' })
    this.secret = null
    this.deleted = true
    this.recent.clear()
    for (const id of this.currentMembers()) if (id !== userId) this.enqueue(id, [{ type: 'chat_deleted' }])
    this.scheduleFlush()
    return ok(null)
  }

  // ---------- 查看者与输入中 ----------

  /** 当前成员；私聊在第一条消息之前也允许（不落库） */
  private canView(chatId: string, userId: string) {
    if (this.gone) return false
    return this.initialized ? this.isMember(userId) : parsePrivateChatId(chatId)?.includes(userId) === true
  }

  /** 登记为正在查看，PRESENCE_TTL_MS 后过期 */
  async view(chatId: string, userId: string): Promise<Result<GroupCall | null>> {
    if (!this.canView(chatId, userId)) return err('forbidden')
    this.viewers.set(userId, Date.now() + PRESENCE_TTL_MS)
    return ok(this.currentGroupCall(chatId, userId))
  }

  /** 输入中（打字或录音）：只转给正在查看的其他成员，不写库，也不等待送达 */
  async typing(chatId: string, userId: string, action: TypingAction): Promise<Result<null>> {
    if (!this.canView(chatId, userId)) return err('forbidden')
    if (this.blockers.size > 0) return ok(null)
    const now = Date.now()
    const targets = new Set<string>()
    for (const [id, expires] of this.viewers) {
      if (expires <= now || !this.canView(chatId, id)) this.viewers.delete(id)
      else if (id !== userId) targets.add(id)
    }
    // 名单可能不全时发给所有成员，由 UserDO 按设备正在查看的会话过滤
    if (now < this.viewersCompleteAt) {
      const everyone = this.initialized ? this.currentMembers() : (parsePrivateChatId(chatId) ?? [])
      for (const id of everyone) if (id !== userId) targets.add(id)
    }
    this.ctx.waitUntil(
      pool([...targets], FANOUT_CONCURRENCY, async (id) => {
        try {
          await this.env.USER.getByName(id).onTyping(chatId, userId, action)
        } catch {
          // 瞬时事件，丢了无害
        }
      }),
    )
    return ok(null)
  }

  // ---------- 读取 ----------

  async history(chatId: string, userId: string, beforeSeq: number | undefined, limit: number): Promise<Result<{ messages: Message[] }>> {
    const max = this.readLimit(chatId, userId)
    if (max === null) return err('forbidden')
    const before = Math.min(beforeSeq ?? Infinity, max + 1, this.topSeq + 1)
    const rows = this.sql.all<MessageRow>('SELECT * FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?', before, limit)
    return ok({ messages: rows.reverse().map((r) => this.toMessage(r, userId)) })
  }

  /** 按 seq 取消息；超出读取范围或不存在的直接略过 */
  async getMessages(chatId: string, userId: string, seqs: number[]): Promise<Result<{ messages: Message[] }>> {
    const max = this.readLimit(chatId, userId)
    if (max === null) return err('forbidden')
    const wanted = [...new Set(seqs)].filter((seq) => seq <= max)
    if (wanted.length === 0) return ok({ messages: [] })
    const rows = this.sql.all<MessageRow>(
      `SELECT * FROM messages WHERE seq IN (${wanted.map(() => '?').join(', ')}) ORDER BY seq`,
      ...wanted,
    )
    return ok({ messages: rows.map((r) => this.toMessage(r, userId)) })
  }

  async diff(chatId: string, userId: string, pts: number, limit: number): Promise<Result<ChatDiff>> {
    const max = this.readLimit(chatId, userId)
    if (max === null) return err('forbidden')
    const topSeq = Math.min(max, this.topSeq)
    const rows = this.sql.all<MessageRow>('SELECT * FROM messages WHERE pts > ? AND seq <= ? ORDER BY pts LIMIT ?', pts, topSeq, limit + 1)
    // 前成员也同步到最新的 chat_pts：离开前的消息之后被编辑或撤回，他的副本也跟着变。
    // 离开期间的新消息因此会被跳过，客户端在被重新加入时重建该会话的本地窗口
    const pinned = this.pinnedSeqs().filter((seq) => seq <= topSeq)
    if (rows.length > limit) return ok({ too_long: true, top_seq: topSeq, pts: this.chatPts, pinned })
    return ok({ too_long: false, messages: rows.map((r) => this.toMessage(r, userId)), pts: this.chatPts, pinned })
  }

  // ---------- 扇出 ----------

  private enqueue(userId: string, events: FanoutEvent[]) {
    const queued = this.pending.get(userId)
    if (queued) queued.push(...events)
    else this.pending.set(userId, [...events])
  }

  /**
   * 不阻塞发送者：扇出在 waitUntil 中进行，期间新到的事件合并进下一轮。
   * 推迟到微任务再开始，同一个请求里先后入队的事件（置顶时的改写与服务消息）合并成一次投递
   */
  private scheduleFlush() {
    if (this.flushing) return
    this.flushing = Promise.resolve().then(() => this.flush()).finally(() => {
      this.flushing = null
      if (this.pending.size > 0) this.scheduleFlush()
    })
    this.ctx.waitUntil(this.flushing)
  }

  private async flush() {
    while (this.pending.size > 0) {
      const batch = [...this.pending]
      this.pending.clear()
      await pool(batch, FANOUT_CONCURRENCY, async ([userId, events]) => {
        try {
          await this.deliver(userId, events)
        } catch (e) {
          console.error('fanout failed', { chat_id: this.chatId, user_id: userId, error: String(e) })
          await this.enqueueRetry(userId, events)
        }
      })
    }
  }

  /** 总是带上当前的会话资料：重试时送达的也是最新的群名 */
  private async deliver(userId: string, events: FanoutEvent[]) {
    await this.env.USER.getByName(userId).onChatEvents(this.chatId!, userId, events, this.snapshot)
  }

  /** 仅在扇出失败时写入重试队列，正常路径不产生这张表的写入 */
  private async enqueueRetry(userId: string, events: FanoutEvent[]) {
    const nextAt = Date.now() + retryDelay(0)
    this.sql.run(
      'INSERT INTO fanout_outbox (user_id, events, attempts, next_at) VALUES (?, ?, 1, ?)',
      userId, JSON.stringify(events), nextAt,
    )
    await this.armAlarm(nextAt)
  }

  /** 每个 DO 只有一个 Alarm，扇出重试与通话的期限共用：只在需要更早时改（每次 setAlarm 计 1 行写入） */
  private async armAlarm(at: number) {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  /** 先处理到期的通话，再重试扇出；期限提前取消（接听、认领回来）时 Alarm 照样响一次，什么都不做 */
  override async alarm() {
    const now = Date.now()
    const call = this.call
    if (call?.deadline != null && call.deadline <= now) this.finishCall(call.accepted_at === null ? 'missed' : 'ended')
    for (const [id, p] of Object.entries(this.groupCall?.participants ?? {})) {
      if (p.lost_at !== null && p.lost_at + CALL_GRACE_MS <= now) await this.dropParticipant(id)
    }
    const due = this.sql.all<OutboxRow>('SELECT * FROM fanout_outbox WHERE next_at <= ? ORDER BY id', now)
    await pool(due, FANOUT_CONCURRENCY, async (row) => {
      try {
        await this.deliver(row.user_id, JSON.parse(row.events) as FanoutEvent[])
        this.sql.run('DELETE FROM fanout_outbox WHERE id = ?', row.id)
      } catch (e) {
        console.error('fanout retry failed', { chat_id: this.chatId, user_id: row.user_id, attempts: row.attempts, error: String(e) })
        this.sql.run(
          'UPDATE fanout_outbox SET attempts = ?, next_at = ? WHERE id = ?',
          row.attempts + 1, Date.now() + retryDelay(row.attempts), row.id,
        )
      }
    })
    const next = this.sql.one<{ at: number | null }>('SELECT min(next_at) AS at FROM fanout_outbox')?.at ?? null
    const deadlines = [next, this.call?.deadline ?? null, this.groupDeadline(this.groupCall)].filter((d) => d !== null)
    const at = deadlines.length > 0 ? Math.min(...deadlines) : null
    if (at !== null) await this.ctx.storage.setAlarm(at)
  }
}

const service = (action: ServiceAction): MessageBody => ({ kind: 'service', action })

/** 消息行上的媒体对象键：媒体消息取自 media，秘密聊天的消息里 media 本身就是键的列表 */
function rowKeys(row: MessageRow): string[] {
  if (!row.media) return []
  return row.kind === 'cipher' ? (JSON.parse(row.media) as string[]) : mediaKeys(JSON.parse(row.media) as Media[])
}

/** 服务端自己写的服务消息（秘密聊天的设备加入）用的 random_id：不会被客户端重放，只需与发送者的其他 random_id 不撞 */
function randomSafeInt(): number {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2))
  return (hi! & 0x1fffff) * 2 ** 32 + lo!
}

/** 挂断的结果：接通后是结束；响铃中主叫方挂断是取消，被叫方挂断是拒绝 */
function hangUpResult(c: CallState, userId: string): CallResult {
  if (c.accepted_at !== null) return 'ended'
  return userId === c.caller_id ? 'canceled' : 'declined'
}

/** 这台设备是不是通话所在的设备 */
function onDevice(c: CallState, userId: string, deviceId: string): boolean {
  return userId === c.caller_id ? c.caller_device === deviceId : userId === c.callee_id && c.callee_device === deviceId
}

/** 通话记录的 random_id：由通话 ID 确定性生成（取前 6 字节），重复结束不会写出第二条记录 */
function callRandomId(callId: string): number {
  const bytes = Uint8Array.from(atob(callId.slice(0, 8).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  return bytes.reduce((n, b) => n * 256 + b, 0)
}

/** 被置顶消息的摘要：文本截断，媒体消息见 summarizeMedia */
function excerpt(row: MessageRow): PinExcerpt {
  if (row.kind === 'text') return { kind: 'text', text: row.text!.slice(0, EXCERPT_LENGTH) }
  return summarizeMedia(JSON.parse(row.media!) as Media[])
}

/** 比较邀请令牌，耗时与内容无关 */
function sameToken(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y)
}

/** 把 userId 的回应改成 emoji（null 为取消），返回新的 JSON：按 REACTIONS 的顺序，没有回应时为 null */
function setReaction(cur: Reactions, userId: string, emoji: ReactionEmoji | null): string | null {
  const next: Reactions = {}
  for (const e of REACTIONS) {
    const ids = (cur[e] ?? []).filter((id) => id !== userId)
    if (e === emoji) ids.push(userId)
    if (ids.length > 0) next[e] = ids
  }
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null
}
