// UserDO：每个用户一个。设备 WebSocket（Hibernation）、对话列表、user_pts。
// 见 docs/architecture/02-data-model.md § UserDO、03-sync-protocol.md
import { DurableObject } from 'cloudflare:workers'
import * as v from 'valibot'
import {
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  DEFAULT_SETTINGS,
  HEARTBEAT_MS,
  MAX_FRAME_BYTES,
  MAX_PINNED_DIALOGS,
  MAX_STICKERS,
  STICKER_SIZE,
  PING,
  PONG,
  PRESENCE_TTL_MS,
  RING_TIMEOUT_MS,
  KEY_PACKAGES_PER_DEVICE,
  ReqFrame,
  chatPair,
  inviteCode,
  isGroupChatId,
  isMissedCall,
  isMethod,
  methodParams,
  parseInviteCode,
  parsePrivateChatId,
  parseSecretChatId,
  privateChatId,
  savedKey,
  sentKey,
  sentMedia,
  sentPreview,
  summarizeMedia,
  MAX_RECENT_CALLS,
  type Call,
  type GroupCall,
  type CallLog,
  type ChatKind,
  type ClaimedKeyPackage,
  type DeviceInfo,
  type Dialog,
  type Draft,
  type LinkPreview,
  type Media,
  type DialogPreview,
  type DialogStatus,
  type IceServer,
  type Message,
  type Method,
  type MethodParams,
  type MethodResults,
  type Presence,
  type PushPayload,
  type Relation,
  type ServerFrame,
  type Settings,
  type SavedSticker,
  type StickerChange,
  type Transient,
  type TypingAction,
  type Update,
  type UserProfile,
} from 'shared/protocol'
import { inviteCodeOf, linkOnly } from 'shared/text'
import { COOKIE_CACHE_MAX_AGE } from './auth/options'
import { STUN_ONLY, TURN_TTL_S, fetchIceServers } from './calls'
import type { ChatSnapshot, Content, FanoutEvent, Wrote } from './chat-do'
import { STICKER_NAMES, copyMedia, copyObject, copyPreview, mediaKeys, objectExists, ownsKey, previewKeys } from './media'
import { displayNames, pushDevices, pushTo, ringRecord, unreadTotal, type SendPush } from './push/deliver'
import { isPushService, mentionedUsers, pickPush, renderNotification } from './push/notify'
import { Vapid, pushTopic, sendWebPush } from './push/webpush'
import { err, ok, pool, type Result } from './result'
import { Sql, migrate } from './sql'

/** Worker 鉴权后写入的身份 header；Worker 总是覆盖客户端传来的同名 header */
export const USER_HEADER = 'X-Chat-User-Id'
export const DEVICE_HEADER = 'X-Chat-Device-Id'
/** 连接来源（JSON，经 encodeURIComponent），由 Worker 取自 request.cf 与 CF-Connecting-IP */
export const LOCATION_HEADER = 'X-Chat-Location'

export type DeviceLocation = { ip: string | null; country: string | null; city: string | null }

const PREVIEW_LENGTH = 100
/** 超过这么久没有心跳的连接不算在线（设备休眠时可能收不到页面隐藏事件） */
const STALE_MS = HEARTBEAT_MS * 2.5
const WATCH_CONCURRENCY = 6
const DAY_MS = 24 * 60 * 60 * 1000
/** 移除记录的保留时长：被移除的设备凭 cookie 缓存还能通过 Worker 校验，期间由 UserDO 拒绝连接 */
const REVOKED_TTL_MS = COOKIE_CACHE_MAX_AGE * 1000 * 2
/** 推送在推送服务最多保留一天，设备离线更久就丢弃 */
const PUSH_TTL_S = 24 * 60 * 60

/** 精确的在线状态（隐私规则应用之前） */
type ExactPresence = Extract<Presence, { status: 'online' | 'offline' }>

/**
 * WebSocket 附件，跨休眠保留（约 2KB 上限）。visible / viewing 由客户端经 presence.update 上报；
 * hidden_at 为最近一次从可见变为不可见的时间（从未可见过为 0），用来得出最后上线时间，切换标签页因此不写库
 */
type Attachment = {
  user_id: string
  device_id: string
  since: number
  visible: boolean
  hidden_at: number
  viewing: string[]
} & DeviceLocation

/** 本应用附加的设备状态；设备本身（session）由 better-auth 存在 D1 */
type DeviceRow = {
  id: string
  last_active_at: number
  ip: string | null
  country: string | null
  city: string | null
  revoked_at: number | null
  /** 推送订阅（PushSubscriptionKeys 的 JSON），本机不接收推送时为 NULL */
  push: string | null
}

type SessionRow = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string }

type DialogRow = {
  chat_id: string
  kind: ChatKind
  title: string | null
  status: DialogStatus
  pts: number
  top_seq: number
  top_preview: string | null
  chat_pts: number
  last_read_seq: number
  peer_read_seq: number
  pinned_rank: number | null
  muted_until: number
  /** Draft 的 JSON；没有草稿为 NULL */
  draft: string | null
  /** 未读提及的 seq（number[] 的 JSON，升序）；没有为 NULL */
  mentions: string | null
}

/** contact / blocked 为 0 或 1；两者都为 0 的行是墓碑 */
type RelationRow = { user_id: string; contact: number; alias: string | null; blocked: number; pts: number }

/** 我的贴纸：removed 为 1 的行是墓碑（对象不删除，见 ADR-0012） */
type StickerRow = Omit<SavedSticker, 'type'> & { removed: number; pts: number }

/**
 * 自己当前的通话（meta 的 call 键）：主叫方发起、被叫方响铃或接听时写入，结束时删除。
 * device_id 为通话所在的设备，来电还在响铃时为 null；信令据此只转给这台设备
 */
type CallMeta = { chat_id: string; call_id: string; device_id: string | null }

/** 运行时拒绝过深的调用链时的错误信息（D1 的前面还有 D1_ERROR:） */
const DEPTH_LIMIT = 'Subrequest depth limit exceeded'

/** 留到 Alarm 里重做的请求：回复到原来的连接 */
type Deferred = { ws: WebSocket; id: number; m: Method; p: unknown }

type Handlers = {
  [M in Method]: (me: Attachment, p: MethodParams<M>, ws: WebSocket) => Promise<Result<MethodResults[M]>>
}

/** 表结构迁移：第 i 项把版本 i 升到 i + 1，见 sql.ts 的 migrate */
const MIGRATIONS = [
  // v1
  [
    // 刻意不建二级索引：对话数很少，WHERE pts > ? 全表扫描只消耗读额度
    `CREATE TABLE dialogs (
      chat_id       TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      title         TEXT,
      status        TEXT NOT NULL,
      pts           INTEGER NOT NULL,
      top_seq       INTEGER NOT NULL,
      top_preview   TEXT,
      chat_pts      INTEGER NOT NULL,
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      peer_read_seq INTEGER NOT NULL DEFAULT 0,
      pinned_rank   INTEGER,
      muted_until   INTEGER NOT NULL DEFAULT 0,
      draft         TEXT,
      mentions      TEXT
    ) STRICT, WITHOUT ROWID`,
    // 账号设置：每项一行，pts 为最后一次变化时的 user_pts
    `CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      pts   INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // 设备最后活跃时间与最近一次连接的位置，断开时写入；revoked_at 为移除时间；push 为推送订阅
    `CREATE TABLE devices (
      id             TEXT PRIMARY KEY,
      last_active_at INTEGER NOT NULL,
      ip             TEXT,
      country        TEXT,
      city           TEXT,
      revoked_at     INTEGER,
      push           TEXT
    ) STRICT, WITHOUT ROWID`,
    // 账号级的零散状态（最后上线时间等），不参与同步
    `CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value ANY
    ) STRICT, WITHOUT ROWID`,
    // 与其他用户的关系：联系人（及备注名）与拉黑，每个对方一行。
    // 取消联系人、解除拉黑后行保留为墓碑，供其他设备同步删除
    `CREATE TABLE relations (
      user_id TEXT PRIMARY KEY,
      contact INTEGER NOT NULL,
      alias   TEXT,
      blocked INTEGER NOT NULL,
      pts     INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // 最近通话：来自通话记录，只增不改；超过 MAX_RECENT_CALLS 的删掉，不留墓碑（客户端按同样的规则删）
    `CREATE TABLE calls (
      call_id   TEXT PRIMARY KEY,
      chat_id   TEXT NOT NULL,
      seq       INTEGER NOT NULL,
      peer_id   TEXT NOT NULL,
      caller_id TEXT NOT NULL,
      result    TEXT NOT NULL,
      duration  INTEGER NOT NULL,
      date      INTEGER NOT NULL,
      pts       INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // 我的贴纸：key 为贴纸在 s/ 下的键（可能是别人添加的，从贴纸消息添加时引用同一个对象）。
    // 移除后行保留为墓碑，供其他设备同步删除；再次添加时复活
    `CREATE TABLE stickers (
      key       TEXT PRIMARY KEY,
      mime      TEXT NOT NULL,
      w         INTEGER NOT NULL,
      h         INTEGER NOT NULL,
      size      INTEGER NOT NULL,
      thumbhash TEXT NOT NULL,
      added_at  INTEGER NOT NULL,
      removed   INTEGER NOT NULL,
      pts       INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
    // 秘密聊天的 KeyPackage：每台设备几个一次性的（领走即删）与一个可重复使用的最后备用（last_resort = 1）
    `CREATE TABLE key_packages (
      device_id   TEXT NOT NULL,
      ref         TEXT NOT NULL,
      data        TEXT NOT NULL,
      last_resort INTEGER NOT NULL,
      PRIMARY KEY (device_id, ref)
    ) STRICT, WITHOUT ROWID`,
  ],
]

export class UserDO extends DurableObject<Env> {
  readonly sql: Sql
  private userPts: number
  /**
   * 正在观察我在线状态的用户：user_id → 过期时间，以及对方是否隐藏了自己的最后上线时间（对等规则）。
   * 只在内存里，休眠后丢失，由对方续订恢复
   */
  private watchers = new Map<string, { expires: number; hides: boolean }>()
  /** 已处理过断开的连接：webSocketError 之后可能还会触发 webSocketClose */
  private gone = new WeakSet<WebSocket>()
  private vapid: Vapid | null = null
  /** 因调用深度超限失败、等 Alarm 重做的请求（只在内存里） */
  private deferred: Deferred[] = []
  /** 签发过的 ICE 服务器，在凭据有效期过半之前复用 */
  private ice: { servers: IceServer[]; expires: number } | null = null
  /** 发一条推送，返回推送服务的 HTTP 状态；测试替换为假的实现 */
  sendPush: SendPush = async (subscription, payload, options) => {
    const { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, BETTER_AUTH_URL } = this.env
    // 没有配置推送时浏览器不会订阅；撤掉配置之前留下的订阅当作失效清除
    if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return 410
    // VAPID 的 sub 用应用地址：推送服务出问题时据此联系应用方
    this.vapid ??= new Vapid(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, BETTER_AUTH_URL)
    return (await sendWebPush(subscription, JSON.stringify(payload), options, this.vapid)).status
  }
  /** 服务端复制一个媒体对象（发送与转发时），源对象不存在时返回 false；测试替换为本地 R2 上的复制 */
  copyObject = (src: string, dst: string): Promise<boolean> => copyObject(this.env, src, dst)
  /** 媒体对象是否存在（发送时判断待发对象是否已经复制过）；测试替换为本地 R2 上的查询 */
  objectExists = (key: string): Promise<boolean> => objectExists(this.env, key)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = new Sql(ctx.storage.sql)
    migrate(ctx.storage, MIGRATIONS)
    // user_pts 不落计数器，唤醒时取所有带 pts 的表的最大值。
    // 多参数 max() 遇到 NULL 即返回 NULL，空表必须先 coalesce
    this.userPts = this.sql.one<{ pts: number }>(
      `SELECT max(
        coalesce((SELECT max(pts) FROM dialogs), 0),
        coalesce((SELECT max(pts) FROM settings), 0),
        coalesce((SELECT max(pts) FROM relations), 0),
        coalesce((SELECT max(pts) FROM calls), 0),
        coalesce((SELECT max(pts) FROM stickers), 0)
      ) AS pts`,
    )!.pts
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  // ---------- WebSocket ----------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const userId = request.headers.get(USER_HEADER)
    const deviceId = request.headers.get(DEVICE_HEADER)
    if (!userId || !deviceId) return new Response('missing identity', { status: 400 })

    // 已移除的设备还可能凭 cookie 缓存通过 Worker：接受后立即以 CLOSE_REVOKED 关闭，让客户端退出登录。
    // 不走 Hibernation 的 acceptWebSocket，免得这条连接的关闭被当成设备下线写库
    if (this.sql.one('SELECT 1 AS x FROM devices WHERE id = ? AND revoked_at IS NOT NULL', deviceId)) {
      const { 0: client, 1: server } = new WebSocketPair()
      server.accept()
      server.close(CLOSE_REVOKED, 'revoked')
      return new Response(null, { status: 101, webSocket: client })
    }

    // 同一设备只保留一条连接
    for (const old of this.ctx.getWebSockets(deviceId)) old.close(CLOSE_REPLACED, 'replaced')

    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server, [deviceId])
    // 客户端连上后立即上报可见性，在此之前按不可见处理。
    // 后台重连（网络抖动、设备唤醒）不算上线，所以 hidden_at 从 0 开始，不取连接时间
    server.serializeAttachment({
      user_id: userId,
      device_id: deviceId,
      since: Date.now(),
      visible: false,
      hidden_at: 0,
      viewing: [],
      ...parseLocation(request.headers.get(LOCATION_HEADER)),
    } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return ws.close(1003, 'text frames only')
    if (message.length > MAX_FRAME_BYTES) return ws.close(1009, 'frame too large')

    let json: unknown
    try {
      json = JSON.parse(message)
    } catch {
      return ws.close(1007, 'invalid json')
    }
    const frame = v.safeParse(ReqFrame, json)
    if (!frame.success) return ws.close(1008, 'invalid frame')

    const { id, m, p } = frame.output
    if (!isMethod(m)) return reply(ws, id, err('unknown_method'))
    const params = v.safeParse(methodParams[m], p)
    if (!params.success) return reply(ws, id, err('bad_request'))

    try {
      reply(ws, id, await this.handle(ws, m, params.output))
    } catch (e) {
      console.error('method failed', { method: m, error: String(e) })
      if (String(e).includes(DEPTH_LIMIT) && (await this.defer({ ws, id, m, p: params.output }))) return
      reply(ws, id, err('internal'))
    }
  }

  private handle(ws: WebSocket, m: Method, p: unknown): Promise<Result<unknown>> {
    const handler = this.handlers[m] as (me: Attachment, p: unknown, ws: WebSocket) => Promise<Result<unknown>>
    return handler(ws.deserializeAttachment() as Attachment, p, ws)
  }

  /**
   * 运行时拒绝了过深的调用链（见 04-realtime-and-fanout.md § 调用深度）：WebSocket 消息里发出的调用会这样失败一段时间，
   * Alarm 里发出的则不会。请求留到立即触发的 Alarm 里重做（只在出错时写 1 行）；Alarm 已经排上时不再写
   */
  private async defer(d: Deferred): Promise<boolean> {
    try {
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now())
    } catch {
      return false
    }
    this.deferred.push(d)
    return true
  }

  /** 按到达顺序重做留下的请求，每个只回复一次；连接已经断开的不再重做，客户端重连后自己重发 */
  override async alarm() {
    const batch = this.deferred
    this.deferred = []
    for (const d of batch) {
      if (d.ws.readyState !== WebSocket.OPEN) continue
      try {
        reply(d.ws, d.id, await this.handle(d.ws, d.m, d.p))
        console.log('method retried', { method: d.m })
      } catch (e) {
        console.error('method retry failed', { method: d.m, error: String(e) })
        reply(d.ws, d.id, err('internal'))
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      // 已关闭
    }
    this.onSocketGone(ws)
  }

  override async webSocketError(ws: WebSocket) {
    this.onSocketGone(ws)
  }

  /**
   * 连接断开：在线状态可能变化。设备的最后活跃时间或位置有变化时写设备行（至多 1 行）；
   * 最后一条连接断开时再把最后上线时间落盘（1 行）。
   * 此时 getWebSockets() 可能已经不含这条连接，所以显式地把它算进"断开前"
   */
  private onSocketGone(ws: WebSocket) {
    if (this.gone.has(ws)) return
    this.gone.add(ws)
    const a = ws.deserializeAttachment() as Attachment
    const now = Date.now()
    const activity = this.activity(ws, now)
    this.sql.run(
      `INSERT INTO devices (id, last_active_at, ip, country, city) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         last_active_at = max(last_active_at, excluded.last_active_at),
         ip = excluded.ip, country = excluded.country, city = excluded.city
       WHERE excluded.last_active_at > devices.last_active_at
          OR excluded.ip IS NOT devices.ip OR excluded.country IS NOT devices.country OR excluded.city IS NOT devices.city`,
      a.device_id, activity.online ? now : activity.last_active, a.ip, a.country, a.city,
    )

    const others = this.ctx.getWebSockets().filter((other) => other !== ws)
    const before = this.presence([...others, ws])
    const after = this.presence(others)
    if (others.length === 0) {
      const lastSeen = before.status === 'online' ? Date.now() : before.last_seen
      this.sql.run(
        "INSERT INTO meta (key, value) VALUES ('last_seen', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        lastSeen,
      )
    }
    if (before.status !== after.status) this.notifyWatchers(a.user_id, after)

    // 通话所在的设备断开了：ChatDO 开始等它认领回来。同一设备已经有了新连接（顶替了旧连接、或旧连接的关闭迟到）时
    // 不算断开，否则新连接认领之后又会被这里重新计时
    const call = this.callMeta()
    const replaced = this.ctx.getWebSockets(a.device_id).some((other) => other !== ws)
    if (call?.device_id === a.device_id && !replaced) {
      const chat = this.chat(call.chat_id)
      this.ctx.waitUntil(
        (isGroupChatId(call.chat_id)
          ? chat.groupDeviceGone(call.chat_id, a.user_id, a.device_id, call.call_id)
          : chat.deviceGone(call.chat_id, a.user_id, a.device_id, call.call_id)
        ).catch((e: unknown) => console.error('call device gone failed', { error: String(e) })),
      )
    }
  }

  // ---------- 在线状态 ----------

  /** 至少一台设备在前台即在线；否则取各设备最后一次在前台的时间与落盘值中较晚的 */
  private presence(sockets = this.ctx.getWebSockets()): ExactPresence {
    const now = Date.now()
    let lastSeen = this.sql.one<{ value: number }>("SELECT value FROM meta WHERE key = 'last_seen'")?.value ?? 0
    for (const ws of sockets) {
      const activity = this.activity(ws, now)
      if (activity.online) return { status: 'online' }
      lastSeen = Math.max(lastSeen, activity.last_active)
    }
    return { status: 'offline', last_seen: lastSeen }
  }

  /**
   * 一条连接所在设备的状态：可见且心跳未过期即在前台；
   * last_active 为最后一次在前台的时间（可见时取最后心跳，从未可见过为 0）
   */
  private activity(ws: WebSocket, now: number): { online: boolean; last_active: number } {
    const a = ws.deserializeAttachment() as Attachment
    if (!a.visible) return { online: false, last_active: a.hidden_at }
    const alive = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0, a.since)
    return { online: now - alive < STALE_MS, last_active: alive }
  }

  /**
   * 由对方的 UserDO 调用：登记为观察者（PRESENCE_TTL_MS 后过期），返回当前在线状态。
   * 我隐藏了最后上线时间，或对方隐藏了他自己的（对等），都只给出大致范围；
   * 被我拉黑的人不登记，总是看到"很久以前"
   */
  async watchPresence(watcherId: string, watcherHides: boolean): Promise<Presence> {
    if (this.blocks(watcherId)) return { status: 'long' }
    this.watchers.set(watcherId, { expires: Date.now() + PRESENCE_TTL_MS, hides: watcherHides })
    const presence = this.presence()
    return this.exactFor(watcherHides) ? presence : approximate(presence)
  }

  private exactFor(watcherHides: boolean) {
    return !watcherHides && this.settings().last_seen === 'everyone'
  }

  /** 上线、下线时只通知能看到精确状态的观察者（大致范围在这时不会变），不等待送达 */
  private notifyWatchers(userId: string, presence: Presence) {
    const now = Date.now()
    const targets: string[] = []
    for (const [id, w] of this.watchers) {
      if (w.expires <= now) this.watchers.delete(id)
      else if (this.exactFor(w.hides)) targets.push(id)
    }
    if (targets.length === 0) return
    this.ctx.waitUntil(
      pool(targets, WATCH_CONCURRENCY, async (id) => {
        try {
          await this.env.USER.getByName(id).onPresence(userId, presence)
        } catch {
          // 瞬时事件，观察者续订时会拿到最新状态
        }
      }),
    )
  }

  /** 由群组的 ChatDO 调用：拉人进群前确认对象没有拉黑发起者 */
  async hasBlocked(userId: string): Promise<boolean> {
    return this.blocks(userId)
  }

  private blocks(userId: string): boolean {
    return this.sql.one('SELECT 1 AS x FROM relations WHERE user_id = ? AND blocked = 1', userId) !== undefined
  }

  /** 观察对象的在线状态变化：推给自己的所有设备 */
  async onPresence(userId: string, presence: Presence): Promise<void> {
    this.emit(this.ctx.getWebSockets(), [{ type: 'presence', user_id: userId, presence }])
  }

  /** 输入中：只推给正在查看该会话的设备 */
  async onTyping(chatId: string, userId: string, action: TypingAction): Promise<void> {
    const viewing = this.ctx
      .getWebSockets()
      .filter((ws) => (ws.deserializeAttachment() as Attachment).viewing.includes(chatId))
    this.emit(viewing, [{ type: 'typing', chat_id: chatId, user_id: userId, action }])
  }

  private emit(sockets: WebSocket[], events: Transient[]) {
    if (sockets.length === 0) return
    const frame = JSON.stringify({ t: 'evt', e: events } satisfies ServerFrame)
    for (const ws of sockets) {
      try {
        ws.send(frame)
      } catch {
        // 连接正在关闭
      }
    }
  }

  private broadcast(updates: Update[]) {
    if (updates.length === 0) return
    const frame = JSON.stringify({ t: 'upd', u: updates } satisfies ServerFrame)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame)
      } catch {
        // 连接正在关闭，重连后由 sync 补齐
      }
    }
  }

  // ---------- 方法 ----------

  private readonly handlers: Handlers = {
    'users.resolve': async (_me, { email }) => {
      // better-auth 存储的 email 已转成小写，精确匹配可走唯一索引
      const user = await this.env.DIRECTORY.prepare('SELECT id, name, image FROM "user" WHERE email = ?')
        .bind(email.toLowerCase())
        .first<UserProfile>()
      return user ? ok({ user }) : err('not_found')
    },

    'users.get': async (_me, { ids }) => {
      const unique = [...new Set(ids)]
      const { results } = await this.env.DIRECTORY.prepare(
        `SELECT id, name, image FROM "user" WHERE id IN (${unique.map(() => '?').join(', ')})`,
      )
        .bind(...unique)
        .all<UserProfile>()
      return ok({ users: results })
    },

    'messages.send': async (me, { chat_id, random_id, text, entities, reply_to, preview }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      if (!preview) return this.wrote(me, chat_id, await this.chat(chat_id).send(chat_id, me.user_id, random_id, { text, entities }, reply_to))
      if (!this.validPreview(me.user_id, text, preview)) return err('bad_request')
      if (this.blocksPeer(chat_id, me.user_id)) return err('blocked')
      const res = await this.sendObjects(previewKeys(preview), () =>
        this.chat(chat_id).send(chat_id, me.user_id, random_id, { text, entities, preview: sentPreview(preview) }, reply_to),
      )
      return this.wrote(me, chat_id, res)
    },

    /** 媒体必须是自己上传、还没发送的：撤回时会删除这些对象，不能借此删掉别人的，也不能让两条消息共用一个对象 */
    'messages.sendMedia': async (me, { chat_id, random_id, media, reply_to }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      if (!mediaKeys(media).every((key) => ownsKey(key, this.env.MEDIA_KEY_PREFIX, me.user_id, 'p'))) return err('bad_request')
      if (this.blocksPeer(chat_id, me.user_id)) return err('blocked')
      const res = await this.sendObjects(mediaKeys(media), () =>
        this.chat(chat_id).send(chat_id, me.user_id, random_id, { media: sentMedia<Media>(media) }, reply_to),
      )
      return this.wrote(me, chat_id, res)
    },

    /** 只能发自己贴纸里的（没移除的）；贴纸的格式与尺寸取自收藏行，消息引用同一个对象，不复制（ADR-0012） */
    'messages.sendSticker': async (me, { chat_id, random_id, key, reply_to }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      const row = this.sql.one<StickerRow>('SELECT * FROM stickers WHERE key = ? AND removed = 0', key)
      if (!row) return err('not_found')
      if (this.blocksPeer(chat_id, me.user_id)) return err('blocked')
      const { added_at: _, ...sticker } = toSticker(row)
      return this.wrote(me, chat_id, await this.chat(chat_id).send(chat_id, me.user_id, random_id, { media: [sticker] }, reply_to))
    },

    'messages.history': async (me, { chat_id, before_seq, limit }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).history(chat_id, me.user_id, before_seq, limit)
    },

    'messages.edit': async (me, { chat_id, seq, text, entities }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).edit(chat_id, me.user_id, seq, text, entities))
    },

    'messages.recall': async (me, { chat_id, seq }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).recall(chat_id, me.user_id, seq))
    },

    /**
     * 转发：来源只要自己读得到（前成员也可以），只能转发文本与媒体消息；来源本身是转发来的，保留最初的来源。
     * 媒体先在服务端复制到自己名下，再作为自己的新消息发到目标会话（不带回复引用）
     */
    'messages.forward': async (me, { from_chat_id, seq, to_chat_id, random_id }) => {
      for (const chatId of [from_chat_id, to_chat_id]) {
        const check = this.checkChat(chatId, me.user_id)
        if (!check.ok) return check
      }
      const got = await this.chat(from_chat_id).getMessages(from_chat_id, me.user_id, [seq])
      if (!got.ok) return got
      const source = got.r.messages[0]
      if (!source) return err('not_found')
      if (source.kind !== 'text' && source.kind !== 'media') return err('bad_request')
      if (this.blocksPeer(to_chat_id, me.user_id)) return err('blocked')
      const fwd_from = source.fwd_from ?? { user_id: source.sender_id, date: source.date }
      // 复制出来的对象：没能发出去时当场删掉（不在 p/ 下，生命周期规则管不到）
      const copied: string[] = []
      const copy = async (src: string, dst: string) => {
        if (!(await this.copyObject(src, dst))) throw new Error(`copy source missing: ${src}`)
        copied.push(dst)
      }
      let content: Content
      try {
        content =
          source.kind === 'text'
            ? {
                text: source.text,
                entities: source.entities,
                preview: source.preview && (await copyPreview(source.preview, this.env.MEDIA_KEY_PREFIX, me.user_id, random_id, copy)),
                fwd_from,
              }
            : { media: await copyMedia(source.media, this.env.MEDIA_KEY_PREFIX, me.user_id, random_id, copy), fwd_from }
      } catch (e) {
        this.dropObjects(copied)
        throw e
      }
      const res = await this.chat(to_chat_id).send(to_chat_id, me.user_id, random_id, content)
      if (!res.ok) this.dropObjects(copied)
      return this.wrote(me, to_chat_id, res)
    },

    'messages.react': async (me, { chat_id, seq, emoji }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).react(chat_id, me.user_id, seq, emoji))
    },

    'messages.pin': async (me, { chat_id, random_id, seq }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      const res = await this.chat(chat_id).pin(chat_id, me.user_id, random_id, seq)
      if (!res.ok || res.r === null) return res as Result<null>
      const { message, chat, pinned } = res.r
      // 被置顶的消息与服务消息一起应用到自己的对话行，推给自己的所有设备
      const events: FanoutEvent[] = [...(pinned ? [{ type: 'update_message' as const, message: pinned }] : []), { type: 'new_message', message }]
      this.broadcast(this.applyEvents(chat_id, me.user_id, events, chat))
      return ok({ seq: message.seq, pts: message.pts, date: message.date })
    },

    'messages.unpin': async (me, { chat_id, seq }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).unpin(chat_id, me.user_id, seq))
    },

    'messages.get': async (me, { chat_id, seqs }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).getMessages(chat_id, me.user_id, seqs)
    },

    /** 已读位置只前移，读到的提及随之移除；私聊再转告 ChatDO 生成已读回执，群组只写自己的对话行 */
    'messages.read': async (me, { chat_id, max_seq }) => {
      const cur = this.sql.one<DialogRow>('SELECT * FROM dialogs WHERE chat_id = ?', chat_id)
      if (!cur || cur.status === 'deleted') return err('not_found')
      const seq = Math.min(max_seq, cur.top_seq)
      if (seq <= cur.last_read_seq) return ok(null)

      // 先发回执再写对话行：发不出去（调用深度超限）时请求在 Alarm 里重做，回执不会因为对话行已经前移而被跳过
      if (cur.kind !== 'group') {
        const res = await this.chat(chat_id).read(chat_id, me.user_id, seq)
        // 回执丢失只影响对方的双勾，下一次已读会带上更大的位置
        if (!res.ok) console.error('read receipt failed', { chat_id, error: res.e })
      }
      const row: DialogRow = { ...cur, last_read_seq: seq, mentions: unreadMentions(cur.mentions, seq), pts: ++this.userPts }
      this.sql.run(
        'UPDATE dialogs SET last_read_seq = ?, mentions = ?, pts = ? WHERE chat_id = ?',
        row.last_read_seq, row.mentions, row.pts, chat_id,
      )
      this.broadcast([{ k: 'user', pts: row.pts, ev: { type: 'dialog', dialog: toDialog(row) } }])
      return ok(null)
    },

    /**
     * 更新本设备的可见性与正在查看的会话；在线状态变化时通知观察者。
     * 然后向正在查看的会话登记（输入中转发），并观察私聊对象的在线状态
     */
    'presence.update': async (me, { visible, viewing }, ws) => {
      const before = this.presence()
      const now = Date.now()
      const hidden_at = visible ? me.hidden_at : me.visible ? now : me.hidden_at
      ws.serializeAttachment({ ...me, visible, hidden_at, viewing: [...new Set(viewing)] } satisfies Attachment)
      const after = this.presence()
      if (before.status !== after.status) this.notifyWatchers(me.user_id, after)

      const groupCalls: GroupCall[] = []
      const peers = await Promise.all(
        [...new Set(viewing)].map(async (chatId) => {
          if (!isGroupChatId(chatId) && !chatPair(chatId)?.includes(me.user_id)) return null
          const peerId = chatPair(chatId)?.find((id) => id !== me.user_id)
          const hides = this.settings().last_seen === 'nobody'
          const [presence, viewed] = await Promise.all([
            peerId ? this.env.USER.getByName(peerId).watchPresence(me.user_id, hides) : null,
            this.chat(chatId).view(chatId, me.user_id),
          ])
          // 查看的群组里进行中的通话，用于横条
          if (viewed.ok && viewed.r) groupCalls.push(viewed.r)
          return peerId && presence ? { user_id: peerId, presence } : null
        }),
      )
      return ok({ peers: peers.filter((p) => p !== null), group_calls: groupCalls })
    },

    'presence.typing': async (me, { chat_id, action }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).typing(chat_id, me.user_id, action)
    },

    'sync.user': async (_me, { pts }) => {
      const rows = this.sql.all<DialogRow>('SELECT * FROM dialogs WHERE pts > ?', pts)
      const relations = this.sql.all<RelationRow>('SELECT * FROM relations WHERE pts > ?', pts)
      const settingsChanged = this.sql.one('SELECT 1 FROM settings WHERE pts > ? LIMIT 1', pts) !== undefined
      const calls = this.sql.all<CallLog & { pts: number }>('SELECT * FROM calls WHERE pts > ?', pts)
      const stickers = this.sql.all<StickerRow>('SELECT * FROM stickers WHERE pts > ?', pts)
      return ok({
        dialogs: rows.map(toDialog),
        relations: relations.map(toRelation),
        settings: settingsChanged ? this.settings() : null,
        calls: calls.map(({ pts: _, ...call }) => call),
        stickers: stickers.map(toStickerChange),
        pts: this.userPts,
      })
    },

    /** 只写有变化的项（每项 1 行），同一次修改共用一个 user_pts */
    'settings.set': async (_me, patch) => {
      const cur = this.settings()
      const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== undefined && patch[k] !== cur[k])
      if (changed.length === 0) return ok(null)
      const pts = ++this.userPts
      for (const key of changed) {
        this.sql.run(
          `INSERT INTO settings (key, value, pts) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, pts = excluded.pts`,
          key, JSON.stringify(patch[key]), pts,
        )
      }
      this.broadcast([{ k: 'user', pts, ev: { type: 'settings', settings: this.settings() } }])
      return ok(null)
    },

    'sync.chat': async (me, { chat_id, pts, limit }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).diff(chat_id, me.user_id, pts, limit)
    },

    'chats.create': async (me, { chat_id, random_id, title, user_ids }) =>
      this.wrote(me, chat_id, await this.chat(chat_id).create(chat_id, me.user_id, random_id, title, user_ids)),

    'chats.get': async (me, { chat_id }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).get(chat_id, me.user_id)
    },

    'chats.addMembers': async (me, { chat_id, random_id, user_ids }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      return this.wrote(me, chat_id, await this.chat(chat_id).addMembers(chat_id, me.user_id, random_id, user_ids))
    },

    'chats.removeMember': async (me, { chat_id, random_id, user_id }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      return this.wrote(me, chat_id, await this.chat(chat_id).removeMember(chat_id, me.user_id, random_id, user_id))
    },

    'chats.leave': async (me, { chat_id, random_id }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      return this.wrote(me, chat_id, await this.chat(chat_id).leave(chat_id, me.user_id, random_id))
    },

    'chats.editTitle': async (me, { chat_id, random_id, title }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      return this.wrote(me, chat_id, await this.chat(chat_id).editTitle(chat_id, me.user_id, random_id, title))
    },

    'chats.getInvite': async (me, { chat_id }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      const res = await this.chat(chat_id).getInvite(chat_id, me.user_id)
      return res.ok ? ok({ code: inviteCode(chat_id, res.r.token) }) : res
    },

    'chats.resetInvite': async (me, { chat_id }) => {
      if (!isGroupChatId(chat_id)) return err('bad_request')
      const res = await this.chat(chat_id).resetInvite(chat_id, me.user_id)
      return res.ok ? ok({ code: inviteCode(chat_id, res.r.token) }) : res
    },

    'chats.checkInvite': async (me, { code }) => {
      const invite = parseInviteCode(code)
      if (!invite) return err('not_found')
      return this.chat(invite.chat_id).checkInvite(invite.chat_id, me.user_id, invite.token)
    },

    'chats.join': async (me, { code, random_id }) => {
      const invite = parseInviteCode(code)
      if (!invite) return err('not_found')
      return this.wrote(me, invite.chat_id, await this.chat(invite.chat_id).join(invite.chat_id, me.user_id, random_id, invite.token))
    },

    /** 空的备注名等于不设；没有变化时不写 */
    'contacts.set': async (me, { user_id, alias }) => {
      const check = await this.checkPeer(me.user_id, user_id)
      if (!check.ok) return check
      const cur = this.relation(user_id)
      const next = { ...cur, contact: true, alias: alias || null }
      if (cur.contact && cur.alias === next.alias) return ok(null)
      this.putRelation(next)
      return ok(null)
    },

    'contacts.remove': async (_me, { user_id }) => {
      const cur = this.relation(user_id)
      if (cur.contact) this.putRelation({ ...cur, contact: false, alias: null })
      return ok(null)
    },

    /**
     * 从图片添加：把待发对象复制到 s/（同一目录只换前缀，重放写到同一个键），写入后删除待发对象。
     * 从贴纸消息添加：消息必须读得到、确实是贴纸消息，引用同一个对象。
     * 先查上限再复制，免得白白消耗 A 类操作
     */
    'stickers.add': async (me, params) => {
      let sticker: Omit<SavedSticker, 'added_at'>
      if (params.from === 'message') {
        const check = this.checkChat(params.chat_id, me.user_id)
        if (!check.ok) return check
        const got = await this.chat(params.chat_id).getMessages(params.chat_id, me.user_id, [params.seq])
        if (!got.ok) return got
        const m = got.r.messages[0]
        if (!m) return err('not_found')
        const first = m.kind === 'media' ? m.media[0] : undefined
        if (first?.type !== 'sticker') return err('bad_request')
        sticker = first
      } else {
        const { key, w, h, size, thumbhash } = params
        const mime = STICKER_NAMES[key.slice(key.lastIndexOf('/') + 1)]
        if (!mime || !ownsKey(key, this.env.MEDIA_KEY_PREFIX, me.user_id, 'p')) return err('bad_request')
        if (mime !== 'image/gif' && Math.max(w, h) > STICKER_SIZE) return err('bad_request')
        sticker = { type: 'sticker', key: savedKey(key), mime, w, h, size, thumbhash }
      }
      const cur = this.sql.one<StickerRow>('SELECT * FROM stickers WHERE key = ?', sticker.key)
      if (cur && cur.removed === 0) return ok(null)
      const { n } = this.sql.one<{ n: number }>('SELECT count(*) AS n FROM stickers WHERE removed = 0')!
      if (n >= MAX_STICKERS) return err('sticker_limit')
      if (params.from === 'upload') {
        // 待发对象不在了：之前已经复制过（确认丢了的重放）就照常写入，否则已过期被删
        if (!(await this.copyObject(params.key, sticker.key)) && !(await this.objectExists(sticker.key))) return err('media_expired')
        this.dropObjects([params.key])
      }
      const pts = ++this.userPts
      const row: StickerRow = { ...sticker, added_at: Date.now(), removed: 0, pts }
      this.sql.run(
        `INSERT INTO stickers (key, mime, w, h, size, thumbhash, added_at, removed, pts) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT (key) DO UPDATE SET added_at = excluded.added_at, removed = 0, pts = excluded.pts`,
        row.key, row.mime, row.w, row.h, row.size, row.thumbhash, row.added_at, pts,
      )
      this.broadcast([{ k: 'user', pts, ev: { type: 'sticker', ...toStickerChange(row) } }])
      return ok(null)
    },

    /** 只留墓碑，不删对象：已经发出的贴纸消息还在引用它（ADR-0012） */
    'stickers.remove': async (_me, { key }) => {
      const cur = this.sql.one<StickerRow>('SELECT * FROM stickers WHERE key = ? AND removed = 0', key)
      if (!cur) return ok(null)
      const pts = ++this.userPts
      this.sql.run('UPDATE stickers SET removed = 1, pts = ? WHERE key = ?', pts, key)
      this.broadcast([{ k: 'user', pts, ev: { type: 'sticker', key, sticker: null } }])
      return ok(null)
    },

    /**
     * 先让私聊的 ChatDO 记下拉黑（它据此拒绝双方发送），再写自己的关系行。
     * 对方正在观察我的在线状态时，立即改为"很久以前"
     */
    'users.block': async (me, { user_id }) => {
      const check = await this.checkPeer(me.user_id, user_id)
      if (!check.ok) return check
      const cur = this.relation(user_id)
      if (cur.blocked) return ok(null)
      const chatId = privateChatId(me.user_id, user_id)
      const res = await this.chat(chatId).setBlock(chatId, me.user_id, true)
      if (!res.ok) return res
      await this.blockSecretChats(me.user_id, user_id, true)
      this.putRelation({ ...cur, blocked: true })
      if (this.watchers.delete(user_id)) {
        this.ctx.waitUntil(this.env.USER.getByName(user_id).onPresence(me.user_id, { status: 'long' }).catch(() => {}))
      }
      return ok(null)
    },

    'users.unblock': async (me, { user_id }) => {
      const cur = this.relation(user_id)
      if (!cur.blocked) return ok(null)
      const chatId = privateChatId(me.user_id, user_id)
      const res = await this.chat(chatId).setBlock(chatId, me.user_id, false)
      if (!res.ok) return res
      await this.blockSecretChats(me.user_id, user_id, false)
      this.putRelation({ ...cur, blocked: false })
      return ok(null)
    },

    /** 只读对话只从自己这边删；秘密聊天对双方生效，先让 ChatDO 删掉它并通知对方 */
    'dialogs.delete': async (me, { chat_id }) => {
      const cur = this.sql.one<DialogRow>('SELECT * FROM dialogs WHERE chat_id = ?', chat_id)
      if (!cur || cur.status === 'deleted') return err('not_found')
      if (cur.kind === 'secret') {
        const res = await this.chat(chat_id).deleteSecret(chat_id, me.user_id)
        if (!res.ok && res.e !== 'not_found') return res
      } else if (cur.status !== 'left') {
        return err('bad_request')
      }
      // 保留墓碑行供其他设备同步删除（1 行写入）；置顶、静音一并取消，重新入群得到的是全新的对话
      const row: DialogRow = {
        ...cur,
        status: 'deleted',
        pinned_rank: null,
        muted_until: 0,
        draft: null,
        mentions: null,
        pts: ++this.userPts,
      }
      this.putDialogState(row)
      return ok(null)
    },

    /** 只写有变化的项，同一次修改 1 行写入；没有变化时不写 */
    'dialogs.update': async (_me, { chat_id, pinned, muted_until, draft }) => {
      const cur = this.sql.one<DialogRow>('SELECT * FROM dialogs WHERE chat_id = ?', chat_id)
      if (!cur || cur.status === 'deleted') return err('not_found')
      const next: DialogRow = { ...cur }
      if (pinned !== undefined && pinned !== (cur.pinned_rank !== null)) {
        if (pinned) {
          const { n, top } = this.sql.one<{ n: number; top: number | null }>(
            'SELECT count(pinned_rank) AS n, max(pinned_rank) AS top FROM dialogs WHERE pinned_rank IS NOT NULL',
          )!
          if (n >= MAX_PINNED_DIALOGS) return err('pin_limit')
          // 后置顶的排在前面
          next.pinned_rank = (top ?? 0) + 1
        } else {
          next.pinned_rank = null
        }
      }
      if (muted_until !== undefined) next.muted_until = muted_until
      if (draft !== undefined) {
        const value = draft && (draft.text !== '' || draft.reply_to !== null) ? JSON.stringify(draft) : null
        if (value !== null && cur.status !== 'member') return err('bad_request')
        next.draft = value
      }
      if (next.pinned_rank === cur.pinned_rank && next.muted_until === cur.muted_until && next.draft === cur.draft) {
        return ok(null)
      }
      next.pts = ++this.userPts
      this.putDialogState(next)
      return ok(null)
    },

    /** 以 D1 中未过期的 session 为准，合并设备行与在线连接的状态；顺带清理已失效的设备行 */
    'devices.list': async (me) => {
      const now = Date.now()
      const { results: sessions } = await this.env.DIRECTORY.prepare(
        'SELECT id, userAgent, ipAddress, createdAt FROM session WHERE userId = ? AND expiresAt > ?',
      )
        .bind(me.user_id, new Date(now).toISOString())
        .all<SessionRow>()
      const rows = new Map(this.sql.all<DeviceRow>('SELECT * FROM devices').map((r) => [r.id, r]))
      const alive = new Set(sessions.map((s) => s.id))
      for (const row of rows.values()) {
        const revoking = row.revoked_at !== null && now - row.revoked_at < REVOKED_TTL_MS
        if (!alive.has(row.id) && !revoking) this.sql.run('DELETE FROM devices WHERE id = ?', row.id)
      }

      const devices = sessions.map((s): DeviceInfo => {
        const row = rows.get(s.id)
        const device: DeviceInfo = {
          id: s.id,
          current: s.id === me.device_id,
          user_agent: s.userAgent || null,
          created_at: Date.parse(s.createdAt),
          online: false,
          last_active: row?.last_active_at ?? 0,
          ip: row ? row.ip : s.ipAddress || null,
          country: row?.country ?? null,
          city: row?.city ?? null,
        }
        for (const ws of this.ctx.getWebSockets(s.id)) {
          const activity = this.activity(ws, now)
          const a = ws.deserializeAttachment() as Attachment
          device.online ||= activity.online
          device.last_active = Math.max(device.last_active, activity.last_active)
          device.ip = a.ip ?? device.ip
          device.country = a.country ?? device.country
          device.city = a.city ?? device.city
        }
        return device
      })
      // 本机在前，其余按最后活跃时间倒序
      devices.sort(
        (x, y) =>
          Number(y.current) - Number(x.current) ||
          Number(y.online) - Number(x.online) ||
          y.last_active - x.last_active ||
          y.created_at - x.created_at,
      )
      return ok({ devices })
    },

    'devices.revoke': async (me, { device_id }) => {
      if (device_id === me.device_id) return err('bad_request')
      const res = await this.env.DIRECTORY.prepare('DELETE FROM session WHERE id = ? AND userId = ?')
        .bind(device_id, me.user_id)
        .run()
      if (res.meta.changes === 0) return err('not_found')
      this.revoke(me.user_id, [device_id])
      return ok(null)
    },

    /** 每次连接都会上报：订阅没变时不写库 */
    'push.set': async (me, { subscription }) => {
      if (!subscription) {
        this.sql.run('UPDATE devices SET push = NULL WHERE id = ? AND push IS NOT NULL', me.device_id)
        return ok(null)
      }
      if (!isPushService(subscription.endpoint)) return err('bad_request')
      this.sql.run(
        `INSERT INTO devices (id, last_active_at, push) VALUES (?, 0, ?)
         ON CONFLICT (id) DO UPDATE SET push = excluded.push WHERE devices.push IS NOT excluded.push`,
        me.device_id, JSON.stringify(subscription),
      )
      return ok(null)
    },

    /** 自己已经在通话里（来电在响也算）时返回 busy；对方正好在呼叫我时 ChatDO 返回对方的来电 */
    'calls.start': async (me, { chat_id, call_id }) => {
      const check = this.checkCallChat(chat_id, me.user_id)
      if (!check.ok) return check
      if (this.blocksPeer(chat_id, me.user_id)) return err('blocked')
      const cur = this.callMeta()
      // 同一个会话里的由 ChatDO 判断：可能是重放，也可能是对方正在呼叫我
      if (cur && cur.chat_id !== chat_id && (await this.liveCall(cur, me.user_id))) return err('busy')
      // 签发 TURN 凭据要访问外部接口，与呼叫同时进行
      const ice = this.iceServers()
      const res = await this.chat(chat_id).startCall(chat_id, me.user_id, me.device_id, call_id)
      if (!res.ok) return res
      const call = res.r
      if (call.state !== 'ended' && call.caller_id === me.user_id) {
        this.putCallMeta({ chat_id, call_id, device_id: me.device_id })
        this.emit(this.ctx.getWebSockets(), [{ type: 'call', call }])
      }
      return ok({ call, ice_servers: await ice })
    },

    'calls.accept': async (me, { chat_id, call_id }) => {
      const check = this.checkCallChat(chat_id, me.user_id)
      if (!check.ok) return check
      const cur = this.callMeta()
      if (cur && cur.call_id !== call_id && (await this.liveCall(cur, me.user_id))) return err('busy')
      const ice = this.iceServers()
      const res = await this.chat(chat_id).acceptCall(chat_id, me.user_id, me.device_id, call_id)
      if (!res.ok) return res
      this.putCallMeta({ chat_id, call_id, device_id: me.device_id })
      // 其余设备停止响铃
      this.emit(this.ctx.getWebSockets(), [{ type: 'call', call: res.r }])
      return ok({ call: res.r, ice_servers: await ice })
    },

    'calls.end': async (me, { chat_id, call_id }) => {
      const check = this.checkCallChat(chat_id, me.user_id)
      if (!check.ok) return check
      const res = await this.chat(chat_id).endCall(chat_id, me.user_id, call_id)
      if (!res.ok) return res
      this.dropCallMeta(call_id)
      if (res.r) this.emit(this.ctx.getWebSockets(), [{ type: 'call', call: res.r }])
      return ok(null)
    },

    /** 只有通话所在的设备能发；不经过 ChatDO，直接交给对方的 UserDO（0 行写入） */
    'calls.signal': async (me, { chat_id, call_id, data }) => {
      const cur = this.callMeta()
      if (cur?.call_id !== call_id || cur.chat_id !== chat_id || cur.device_id !== me.device_id) return err('call_ended')
      const peer = parsePrivateChatId(chat_id)?.find((id) => id !== me.user_id)
      if (!peer) return err('bad_request')
      return ok({ delivered: await this.env.USER.getByName(peer).onCallSignal(call_id, data) })
    },

    /** 本设备上的通话在这里认领回来；ChatDO 那边已经结束的顺带清掉 */
    'calls.current': async (me) => {
      const cur = this.callMeta()
      if (!cur) return ok({ call: null })
      if (isGroupChatId(cur.chat_id)) {
        // 别的设备上的群组通话由群组通话事件告知（mine 为 false）
        if (cur.device_id !== me.device_id) return ok({ call: null })
        const res = await this.chat(cur.chat_id).claimGroupCall(cur.chat_id, me.user_id, me.device_id, cur.call_id)
        if (!res.ok) {
          this.dropCallMeta(cur.call_id)
          return ok({ call: null })
        }
        return ok({ call: null, group_call: res.r, ice_servers: await this.iceServers() })
      }
      if (cur.device_id !== me.device_id) {
        const call = (await this.liveCall(cur, me.user_id)) as Call | null
        return ok({ call })
      }
      const res = await this.chat(cur.chat_id).claimCall(cur.chat_id, me.user_id, me.device_id, cur.call_id)
      if (!res.ok) {
        this.dropCallMeta(cur.call_id)
        return ok({ call: null })
      }
      return ok({ call: res.r, ice_servers: await this.iceServers() })
    },

    /** 自己已经在另一个通话里（或有来电在响）时返回 busy；同一个群组里的是换设备或重新加入 */
    'group_calls.join': async (me, { chat_id, call_id }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      const cur = this.callMeta()
      if (cur && cur.chat_id !== chat_id && (await this.liveCall(cur, me.user_id))) return err('busy')
      const ice = this.iceServers()
      const res = await this.chat(chat_id).joinGroupCall(chat_id, me.user_id, me.device_id, call_id)
      if (!res.ok) return res
      this.putCallMeta({ chat_id, call_id: res.r.call_id, device_id: me.device_id })
      // ChatDO 的通知可能先于上面这行到达：再推一次，原来那台设备据此知道通话转走了
      this.emitGroupCall(chat_id, res.r)
      return ok({ call: res.r, ice_servers: await ice })
    },

    'group_calls.leave': async (me, { chat_id, call_id }) => {
      const res = await this.chat(chat_id).leaveGroupCall(chat_id, me.user_id, call_id)
      if (!res.ok) return res
      this.dropCallMeta(call_id)
      return ok(null)
    },

    // 以下只有通话所在的设备能做，由 ChatDO 核对
    'group_calls.publish': (me, { chat_id, call_id, sdp, tracks }) =>
      this.chat(chat_id).publishGroupCall(chat_id, me.user_id, me.device_id, call_id, sdp, tracks),
    'group_calls.unpublish': (me, { chat_id, call_id, sdp, slots }) =>
      this.chat(chat_id).unpublishGroupCall(chat_id, me.user_id, me.device_id, call_id, sdp, slots),
    'group_calls.pull': (me, { chat_id, call_id, tracks }) =>
      this.chat(chat_id).pullGroupCall(chat_id, me.user_id, me.device_id, call_id, tracks),
    'group_calls.answer': (me, { chat_id, call_id, sdp }) =>
      this.chat(chat_id).answerGroupCall(chat_id, me.user_id, me.device_id, call_id, sdp),
    'group_calls.layer': (me, { chat_id, call_id, mid, user_id, rid }) =>
      this.chat(chat_id).layerGroupCall(chat_id, me.user_id, me.device_id, call_id, mid, user_id, rid),
    'group_calls.mute': (me, { chat_id, call_id, muted }) =>
      this.chat(chat_id).muteGroupCall(chat_id, me.user_id, me.device_id, call_id, muted),

    /** 连同 session 已过期但连接还在的设备一起断开 */
    'devices.revokeOthers': async (me) => {
      const { results } = await this.env.DIRECTORY.prepare('DELETE FROM session WHERE userId = ? AND id != ? RETURNING id')
        .bind(me.user_id, me.device_id)
        .all<{ id: string }>()
      const connected = this.ctx
        .getWebSockets()
        .map((ws) => (ws.deserializeAttachment() as Attachment).device_id)
        .filter((id) => id !== me.device_id)
      this.revoke(me.user_id, [...new Set([...results.map((r) => r.id), ...connected])])
      return ok(null)
    },

    // ---------- 秘密聊天 ----------
    // 见 docs/adr/0010-secret-chats-multi-device-mls.md

    'secrets.keys': async (me) => {
      const rows = this.sql.all<{ last_resort: number }>('SELECT last_resort FROM key_packages WHERE device_id = ?', me.device_id)
      return ok({
        count: rows.filter((r) => r.last_resort === 0).length,
        last_resort: rows.some((r) => r.last_resort === 1),
        device_id: me.device_id,
      })
    },

    /**
     * 每个 KeyPackage 1 行；replace 时先删掉本设备原有的。本设备第一次上传（新设备）或换掉了全部（本地数据丢了）时，
     * 告诉所有秘密聊天自己现有的设备，成员设备随之把它拉进来
     */
    'secrets.publish': async (me, { replace, key_packages, last_resort }) => {
      const before = this.sql.one<{ n: number }>('SELECT count(*) AS n FROM key_packages WHERE device_id = ?', me.device_id)!.n
      if (replace) this.sql.run('DELETE FROM key_packages WHERE device_id = ?', me.device_id)
      else if (before + key_packages.length > KEY_PACKAGES_PER_DEVICE + 1) return err('bad_request')
      if (last_resort) this.sql.run('DELETE FROM key_packages WHERE device_id = ? AND last_resort = 1', me.device_id)
      const rows = [...key_packages.map((k) => ({ ...k, last: 0 })), ...(last_resort ? [{ ...last_resort, last: 1 }] : [])]
      for (const k of rows) {
        this.sql.run(
          'INSERT OR REPLACE INTO key_packages (device_id, ref, data, last_resort) VALUES (?, ?, ?, ?)',
          me.device_id, k.ref, k.data, k.last,
        )
      }
      if (before === 0 || replace) this.ctx.waitUntil(this.announceDevices(me.user_id))
      return ok(null)
    },

    /** 对方每台设备与自己其他设备各一个 KeyPackage；与对方已经有秘密聊天时失败（同一时间最多一个） */
    'secrets.prepare': async (me, { user_id }) => {
      const check = await this.checkPeer(me.user_id, user_id)
      if (!check.ok) return check
      if (this.blocks(user_id)) return err('blocked')
      if (this.secretChatWith(me.user_id, user_id)) return err('bad_request')
      const peer = await this.env.USER.getByName(user_id).claimKeyPackagesFor(me.user_id, user_id)
      if (!peer.ok) return peer
      if (peer.r.length === 0) return err('no_keys')
      const own = (await this.claimKeyPackages(me.user_id, null)).filter((k) => k.device_id !== me.device_id)
      return ok({ key_packages: [...peer.r, ...own] })
    },

    'secrets.create': async (me, { chat_id, random_id, welcome, adds }) => {
      const pair = parseSecretChatId(chat_id)
      if (!pair?.includes(me.user_id)) return err('forbidden')
      const peer = pair[0] === me.user_id ? pair[1] : pair[0]
      if (this.blocks(peer)) return err('blocked')
      const existing = this.secretChatWith(me.user_id, peer)
      if (existing && existing !== chat_id) return err('bad_request')
      return this.wrote(me, chat_id, await this.chat(chat_id).createSecret(chat_id, me.user_id, me.device_id, random_id, welcome, adds))
    },

    'secrets.state': async (me, { chat_id }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).secretStateOf(chat_id, me.user_id)
    },

    'secrets.claim': async (me, { chat_id, devices }) => {
      const pair = parseSecretChatId(chat_id)
      if (!pair?.includes(me.user_id) || devices.some((d) => !pair.includes(d.user_id))) return err('bad_request')
      const claimed: ClaimedKeyPackage[] = []
      for (const userId of pair) {
        const ids = devices.filter((d) => d.user_id === userId).map((d) => d.device_id)
        if (ids.length === 0) continue
        claimed.push(
          ...(userId === me.user_id ? await this.claimKeyPackages(userId, ids) : await this.env.USER.getByName(userId).claimKeyPackages(userId, ids)),
        )
      }
      return ok({ key_packages: claimed })
    },

    'secrets.commit': async (me, { chat_id, epoch, commit, welcome, adds, removes }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).secretCommit(chat_id, me.user_id, me.device_id, epoch, commit, welcome, adds, removes)
    },

    'secrets.commits': async (me, { chat_id, after }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).secretCommits(chat_id, me.user_id, me.device_id, after)
    },

    'secrets.reset': async (me, { chat_id }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.chat(chat_id).secretReset(chat_id, me.user_id, me.device_id)
    },

    /** 媒体同 messages.sendMedia：必须是自己上传、还没发送的待发对象，复制到发送后的键再交给 ChatDO */
    'secrets.send': async (me, { chat_id, random_id, epoch, cipher, keys = [] }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      if (!keys.every((key) => ownsKey(key, this.env.MEDIA_KEY_PREFIX, me.user_id, 'p'))) return err('bad_request')
      if (this.blocksPeer(chat_id, me.user_id)) return err('blocked')
      const send = () => this.chat(chat_id).sendSecret(chat_id, me.user_id, random_id, epoch, cipher, keys.map(sentKey))
      return this.wrote(me, chat_id, keys.length > 0 ? await this.sendObjects(keys, send) : await send())
    },

    'secrets.edit': async (me, { chat_id, seq, epoch, cipher }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).editSecret(chat_id, me.user_id, seq, epoch, cipher))
    },

    'secrets.react': async (me, { chat_id, seq, epoch, cipher }) => {
      const check = this.checkChat(chat_id, me.user_id)
      if (!check.ok) return check
      return this.changed(me, chat_id, await this.chat(chat_id).reactSecret(chat_id, me.user_id, seq, epoch, cipher))
    },
  }

  // ---------- 秘密聊天 ----------

  /** 与对方现有的秘密聊天（对话还在的）；没有为 null */
  private secretChatWith(selfId: string, peerId: string): string | null {
    const rows = this.sql.all<{ chat_id: string }>("SELECT chat_id FROM dialogs WHERE kind = 'secret' AND status = 'member'")
    return rows.find((r) => parseSecretChatId(r.chat_id)?.includes(peerId) && peerId !== selfId)?.chat_id ?? null
  }

  /** 拉黑与解除拉黑同样记到与对方的秘密聊天里 */
  private async blockSecretChats(selfId: string, peerId: string, blocked: boolean) {
    const chatId = this.secretChatWith(selfId, peerId)
    if (!chatId) return
    const res = await this.chat(chatId).setBlock(chatId, selfId, blocked)
    if (!res.ok) console.error('secret block failed', { chat_id: chatId, error: res.e })
  }

  /**
   * 能加入秘密聊天的设备：上传过 KeyPackage、没被移除、D1 里的 session 仍然有效。
   * session 已失效的设备顺带删掉它的 KeyPackage（每个 1 行）
   */
  async secretDevices(selfId: string): Promise<string[]> {
    const ids = this.sql.all<{ device_id: string }>('SELECT DISTINCT device_id FROM key_packages').map((r) => r.device_id)
    if (ids.length === 0) return []
    const { results } = await this.env.DIRECTORY.prepare('SELECT id FROM session WHERE userId = ? AND expiresAt > ?')
      .bind(selfId, new Date().toISOString())
      .all<{ id: string }>()
    const alive = new Set(results.map((r) => r.id))
    const revoked = new Set(
      this.sql.all<{ id: string }>('SELECT id FROM devices WHERE revoked_at IS NOT NULL').map((r) => r.id),
    )
    const live = ids.filter((id) => alive.has(id) && !revoked.has(id))
    for (const id of ids) if (!live.includes(id)) this.sql.run('DELETE FROM key_packages WHERE device_id = ?', id)
    return live.sort()
  }

  /** 由对方的 UserDO 调用（开始秘密聊天）：我拉黑了对方时拒绝 */
  async claimKeyPackagesFor(requesterId: string, selfId: string): Promise<Result<ClaimedKeyPackage[]>> {
    if (this.blocks(requesterId)) return err('blocked')
    return ok(await this.claimKeyPackages(selfId, null))
  }

  /**
   * 领取 KeyPackage：deviceIds 中（null 为全部）能加入的设备各一个，优先一次性的（领走即删，1 行），没有了用最后备用的
   */
  async claimKeyPackages(selfId: string, deviceIds: string[] | null): Promise<ClaimedKeyPackage[]> {
    const live = await this.secretDevices(selfId)
    const claimed: ClaimedKeyPackage[] = []
    for (const id of live) {
      if (deviceIds && !deviceIds.includes(id)) continue
      const row = this.sql.one<{ ref: string; data: string; last_resort: number }>(
        'SELECT ref, data, last_resort FROM key_packages WHERE device_id = ? ORDER BY last_resort, ref LIMIT 1',
        id,
      )
      if (!row) continue
      if (row.last_resort === 0) this.sql.run('DELETE FROM key_packages WHERE device_id = ? AND ref = ?', id, row.ref)
      claimed.push({ user_id: selfId, device_id: id, key_package: row.data })
    }
    return claimed
  }

  /** 把自己现有的设备告诉所有秘密聊天；不一致的由它们通知成员设备 */
  private async announceDevices(selfId: string) {
    const chats = this.sql
      .all<{ chat_id: string }>("SELECT chat_id FROM dialogs WHERE kind = 'secret' AND status = 'member'")
      .map((r) => r.chat_id)
    if (chats.length === 0) return
    const devices = await this.secretDevices(selfId)
    await pool(chats, WATCH_CONCURRENCY, async (chatId) => {
      try {
        await this.chat(chatId).setSecretDevices(chatId, selfId, devices)
      } catch (e) {
        console.error('announce devices failed', { chat_id: chatId, error: String(e) })
      }
    })
  }

  /** 由 better-auth 在 session 删除后调用（退出登录）：这台设备不再算数，秘密聊天随之把它移出组 */
  async onDevicesChanged(selfId: string): Promise<void> {
    await this.announceDevices(selfId)
  }

  /** 由 ChatDO 调用：秘密聊天有了新的提交或设备变化，推给所有设备 */
  async onSecret(chatId: string): Promise<void> {
    this.emit(this.ctx.getWebSockets(), [{ type: 'secret', chat_id: chatId }])
  }

  /**
   * session 已从 D1 删除后：记录移除时间、清除推送订阅（每台 1 行），断开这些设备的连接；
   * 删掉它们的 KeyPackage，秘密聊天随之把它们移出组
   */
  private revoke(selfId: string, deviceIds: string[]) {
    const now = Date.now()
    let hadKeys = false
    for (const id of deviceIds) {
      if (this.sql.one('SELECT 1 AS x FROM key_packages WHERE device_id = ? LIMIT 1', id)) {
        hadKeys = true
        this.sql.run('DELETE FROM key_packages WHERE device_id = ?', id)
      }
      this.sql.run(
        `INSERT INTO devices (id, last_active_at, revoked_at) VALUES (?, 0, ?)
         ON CONFLICT (id) DO UPDATE SET revoked_at = excluded.revoked_at, push = NULL`,
        id, now,
      )
      for (const ws of this.ctx.getWebSockets(id)) {
        try {
          ws.close(CLOSE_REVOKED, 'revoked')
        } catch {
          // 已关闭
        }
      }
    }
    if (hadKeys) this.ctx.waitUntil(this.announceDevices(selfId))
  }

  // ---------- 通话 ----------

  /** 一对一通话只在私聊里 */
  private checkCallChat(chatId: string, userId: string): Result<null> {
    if (isGroupChatId(chatId)) return err('bad_request')
    return this.checkChat(chatId, userId)
  }

  private callMeta(): CallMeta | null {
    const row = this.sql.one<{ value: string }>("SELECT value FROM meta WHERE key = 'call'")
    return row ? (JSON.parse(row.value) as CallMeta) : null
  }

  /** 1 行写入 */
  private putCallMeta(call: CallMeta) {
    this.sql.run(
      "INSERT INTO meta (key, value) VALUES ('call', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify(call),
    )
  }

  /** 只删这个通话的（1 行写入）；已经换成别的通话时不动 */
  private dropCallMeta(callId: string) {
    if (this.callMeta()?.call_id === callId) this.sql.run("DELETE FROM meta WHERE key = 'call'")
  }

  /** 向 ChatDO 核实记下的通话还在进行；已经结束（通知丢了）的顺带清掉 */
  private async liveCall(cur: CallMeta, selfId: string): Promise<Call | GroupCall | null> {
    const chat = this.chat(cur.chat_id)
    const call = isGroupChatId(cur.chat_id)
      ? await chat.groupCallOf(cur.chat_id, selfId, cur.call_id)
      : await chat.currentCall(cur.chat_id, selfId, cur.call_id)
    if (!call) this.dropCallMeta(cur.call_id)
    return call
  }

  /** 不会失败：签发失败时退回 STUN，一分钟后再试 */
  private async iceServers(): Promise<IceServer[]> {
    const now = Date.now()
    if (this.ice && this.ice.expires > now) return this.ice.servers
    const servers = await fetchIceServers(this.env)
    this.ice = servers ? { servers, expires: now + (TURN_TTL_S * 1000) / 2 } : { servers: STUN_ONLY, expires: now + 60_000 }
    return this.ice.servers
  }

  /**
   * 由 ChatDO 调用：通话状态变化。来电时自己已经在别的通话里就报告忙线；否则记下来电、推给所有设备，
   * 没有设备在前台时推送来电通知（静音不影响来电）。结束时清掉记下的通话
   */
  async onCall(call: Call): Promise<'ok' | 'busy'> {
    if (call.state === 'ringing') {
      const cur = this.callMeta()
      if (cur && cur.call_id !== call.call_id && (await this.liveCall(cur, call.callee_id))) return 'busy'
      this.putCallMeta({ chat_id: call.chat_id, call_id: call.call_id, device_id: null })
      this.emit(this.ctx.getWebSockets(), [{ type: 'call', call }])
      this.ctx.waitUntil(this.ring(call).catch((e: unknown) => console.error('ring push failed', { error: String(e) })))
      return 'ok'
    }
    if (call.state === 'ended') this.dropCallMeta(call.call_id)
    this.emit(this.ctx.getWebSockets(), [{ type: 'call', call }])
    return 'ok'
  }

  /**
   * 由 ChatDO 调用：群组通话的变化。自己已经不在里面（离开、被移出、掉线超时、通话结束）时清掉记下的通话；
   * 推给所有设备，通话所在的那台标为 mine
   */
  async onGroupCall(selfId: string, chatId: string, call: GroupCall | null): Promise<void> {
    const cur = this.callMeta()
    const inCall = call?.participants.some((p) => p.user_id === selfId) === true
    if (cur?.chat_id === chatId && (!call || call.call_id !== cur.call_id || !inCall)) this.dropCallMeta(cur.call_id)
    this.emitGroupCall(chatId, call)
  }

  private emitGroupCall(chatId: string, call: GroupCall | null) {
    const cur = this.callMeta()
    const device = call && cur?.chat_id === chatId && cur.call_id === call.call_id ? cur.device_id : null
    const sockets = this.ctx.getWebSockets()
    const here = device ? this.ctx.getWebSockets(device) : []
    this.emit(here, [{ type: 'group_call', chat_id: chatId, call, mine: true }])
    this.emit(sockets.filter((ws) => !here.includes(ws)), [{ type: 'group_call', chat_id: chatId, call, mine: false }])
  }

  /** 由对方的 UserDO 调用：信令只推给本端通话所在的设备；返回是否送到 */
  async onCallSignal(callId: string, data: string): Promise<boolean> {
    const cur = this.callMeta()
    if (cur?.call_id !== callId || !cur.device_id) return false
    const sockets = this.ctx.getWebSockets(cur.device_id)
    this.emit(sockets, [{ type: 'call_signal', call_id: callId, data }])
    return sockets.length > 0
  }

  /** 来电推送：通知一直显示到被处理；记下推过（1 行），通话记录到达时据此替换它 */
  private async ring(call: Call) {
    const now = Date.now()
    if (this.ctx.getWebSockets().some((ws) => this.activity(ws, now).online)) return
    const devices = await pushDevices(this.sql, this.env, call.callee_id, now)
    if (devices.length === 0) return
    const names = await displayNames(this.sql, this.env, [call.caller_id])
    const payload: PushPayload = {
      chat_id: call.chat_id,
      seq: 0,
      title: names.get(call.caller_id)?.name ?? 'Someone',
      body: 'Incoming call',
      badge: unreadTotal(this.sql),
      silent: false,
      ring: true,
    }
    this.sql.run(
      "INSERT INTO meta (key, value) VALUES ('ring_pushed', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      call.call_id,
    )
    await pushTo(this.sql, this.sendPush, devices, payload, { ttl: RING_TIMEOUT_MS / 1000, urgency: 'high', topic: await pushTopic(call.chat_id) })
  }

  /** 写对话行里用户私有的状态（1 行写入）并推给自己的所有设备 */
  private putDialogState(row: DialogRow) {
    this.sql.run(
      'UPDATE dialogs SET status = ?, pinned_rank = ?, muted_until = ?, draft = ?, mentions = ?, pts = ? WHERE chat_id = ?',
      row.status, row.pinned_rank, row.muted_until, row.draft, row.mentions, row.pts, row.chat_id,
    )
    this.broadcast([{ k: 'user', pts: row.pts, ev: { type: 'dialog', dialog: toDialog(row) } }])
  }

  /**
   * 链接预览只能加在纯链接消息上：邀请卡片的链接必须是本站的邀请链接；
   * 卡片图片必须是自己上传的（撤回时会删除它，不能借此删掉别人的）
   */
  private validPreview(userId: string, text: string, preview: LinkPreview): boolean {
    const url = linkOnly(text)
    if (!url) return false
    if (preview.type === 'invite') return inviteCodeOf(url, new URL(this.env.BETTER_AUTH_URL).origin) !== null
    return previewKeys(preview).every((key) => ownsKey(key, this.env.MEDIA_KEY_PREFIX, userId, 'p'))
  }

  /** 自己拉黑了私聊对象：在复制媒体之前就拒绝（对方拉黑了自己由 ChatDO 拒绝） */
  private blocksPeer(chatId: string, userId: string): boolean {
    const peer = chatPair(chatId)?.find((id) => id !== userId)
    return peer !== undefined && this.blocks(peer)
  }

  /**
   * 发送带媒体对象的消息：先把待发对象复制到发送后的键，再交给 ChatDO 写入，写入后删除待发对象。
   * 待发对象不存在时，发送后的键还在说明之前已经复制过（确认丢了的重放），否则说明已过期被删，客户端重新上传后再发
   */
  private async sendObjects(pending: string[], send: () => Promise<Result<Wrote>>): Promise<Result<Wrote>> {
    const copied: string[] = []
    let expired = false
    const settled = await Promise.allSettled(
      pending.map(async (src) => {
        const dst = sentKey(src)
        if (await this.copyObject(src, dst)) copied.push(dst)
        else if (!(await this.objectExists(dst))) expired = true
      }),
    )
    const failed = settled.find((s) => s.status === 'rejected')
    if (failed || expired) {
      this.dropObjects(copied)
      if (failed) throw failed.reason
      return err('media_expired')
    }
    const res = await send()
    // ChatDO 先去重再校验，被拒绝说明没有写入，复制出来的都没用了；写入后待发对象没用了
    this.dropObjects(res.ok ? pending : pending.map(sentKey))
    return res
  }

  /** 尽力删除媒体对象（R2 的删除操作免费）；删不掉的待发对象由生命周期规则兜底，其余的只记日志 */
  private dropObjects(keys: string[]) {
    if (keys.length === 0) return
    this.ctx.waitUntil(
      this.env.MEDIA.delete(keys).catch((e: unknown) => console.error('media delete failed', { keys, error: String(e) })),
    )
  }

  /** 与某个用户的关系；没有行时两者皆无 */
  private relation(userId: string): Relation {
    const row = this.sql.one<RelationRow>('SELECT * FROM relations WHERE user_id = ?', userId)
    return row ? toRelation(row) : { user_id: userId, contact: false, alias: null, blocked: false }
  }

  /** 写一行关系（1 行写入）并推给自己的所有设备 */
  private putRelation(rel: Relation) {
    const pts = ++this.userPts
    this.sql.run(
      `INSERT INTO relations (user_id, contact, alias, blocked, pts) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         contact = excluded.contact, alias = excluded.alias, blocked = excluded.blocked, pts = excluded.pts`,
      rel.user_id, Number(rel.contact), rel.alias, Number(rel.blocked), pts,
    )
    this.broadcast([{ k: 'user', pts, ev: { type: 'relation', relation: rel } }])
  }

  /** 联系人与拉黑的对象：不能是自己，必须存在 */
  private async checkPeer(selfId: string, userId: string): Promise<Result<null>> {
    if (userId === selfId) return err('bad_request')
    const user = await this.env.DIRECTORY.prepare('SELECT 1 AS x FROM "user" WHERE id = ?').bind(userId).first()
    return user ? ok(null) : err('not_found')
  }

  /** 完整的账号设置：没有存过的项取默认值 */
  private settings(): Settings {
    const rows = this.sql.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) }
  }

  private chat(chatId: string) {
    return this.env.CHAT.getByName(chatId)
  }

  /** 私聊与秘密聊天的 ID 必须合法且包含自己；群组由 ChatDO 校验成员身份 */
  private checkChat(chatId: string, userId: string): Result<null> {
    if (isGroupChatId(chatId)) return ok(null)
    const secret = parseSecretChatId(chatId)
    if (secret) return secret.includes(userId) ? ok(null) : err('forbidden')
    const pair = parsePrivateChatId(chatId)
    if (!pair) return err(chatId === `p:${userId}:${userId}` ? 'self_chat' : 'bad_request')
    return pair.includes(userId) ? ok(null) : err('forbidden')
  }

  /** ChatDO 写入成功后：更新自己的对话行并推给自己的所有设备，再回复发起者 */
  private wrote(me: Attachment, chatId: string, res: Result<Wrote>): Result<{ seq: number; pts: number; date: number }> {
    if (!res.ok) return res
    const { message, chat } = res.r
    this.broadcast(this.applyEvents(chatId, me.user_id, [{ type: 'new_message', message }], chat))
    return ok({ seq: message.seq, pts: message.pts, date: message.date })
  }

  /** 编辑、撤回或回应成功后：同步到自己的所有设备；没有变化时 ChatDO 返回 null */
  private changed(me: Attachment, chatId: string, res: Result<Wrote | null>): Result<null> {
    if (!res.ok) return res
    if (res.r) {
      const { message, chat } = res.r
      this.broadcast(this.applyEvents(chatId, me.user_id, [{ type: 'update_message', message }], chat))
    }
    return ok(null)
  }

  // ---------- 扇出落点 ----------

  /** ChatDO 扇出调用（含重试）；必须幂等。扇出从不包含自己发的消息 */
  async onChatEvents(chatId: string, userId: string, events: FanoutEvent[], chat: ChatSnapshot): Promise<void> {
    const appliedPts = this.sql.one<{ chat_pts: number }>('SELECT chat_pts FROM dialogs WHERE chat_id = ?', chatId)?.chat_pts ?? 0
    this.broadcast(this.applyEvents(chatId, userId, events, chat))
    // ChatDO 在等这次调用返回，推送不能拖慢扇出
    this.ctx.waitUntil(
      this.notify(chatId, userId, events, chat, appliedPts).catch((e: unknown) =>
        console.error('push failed', { chat_id: chatId, error: String(e) }),
      ),
    )
  }

  // ---------- 推送 ----------

  /**
   * 没有任何设备在前台时，把这批事件里该推送的消息推给有订阅的设备。
   * 设备以 D1 中未过期的 session 为准：session 已失效的设备与推送服务报告失效的订阅都清除（每台 1 行）
   */
  private async notify(chatId: string, selfId: string, events: FanoutEvent[], chat: ChatSnapshot, appliedPts: number) {
    const now = Date.now()
    if (this.ctx.getWebSockets().some((ws) => this.activity(ws, now).online)) return
    const dialog = this.sql.one<DialogRow>('SELECT * FROM dialogs WHERE chat_id = ?', chatId)
    if (!dialog || dialog.status === 'deleted') return
    const { notification_preview: preview } = this.settings()
    // 静音的对话只推提及我的新消息，撤回、编辑的静默替换也不推
    // 推过来电通知的，通话记录不推送时（接听、拒绝，或静音的对话里的未接来电）静默替换掉它，免得"来电"一直留在通知中心里
    const ring = ringRecord(this.sql, events, selfId)
    const pick = pickPush(events, dialog, appliedPts, selfId, preview, dialog.muted_until > now) ?? (ring && { message: ring, silent: true })
    if (!pick) return
    const devices = await pushDevices(this.sql, this.env, selfId, now)
    if (devices.length === 0) return

    const names = await displayNames(this.sql, this.env, mentionedUsers(pick.message))
    const { title, body } = renderNotification(pick.message, chat, selfId, names, preview)
    const payload: PushPayload = { chat_id: chatId, seq: pick.message.seq, title, body, badge: unreadTotal(this.sql), silent: pick.silent }
    await pushTo(this.sql, this.sendPush, devices, payload, { ttl: PUSH_TTL_S, urgency: pick.silent ? 'normal' : 'high', topic: await pushTopic(chatId) })
  }

  /**
   * 把一批会话事件合并进对话行（至多 1 行写入），返回要推给在线设备的更新。
   * - 新消息：已应用过的（pts ≤ 本行 chat_pts）直接跳过，保证重试幂等。
   * - 编辑 / 撤回 / 回应：总是推给在线设备（客户端按 pts 去重）；只有改变了最后一条消息的摘要时才写对话行，
   *   这时连同 chat_pts 一起前移，迟到的原消息重试不会把旧内容写回摘要。回应不改变摘要，所以从不写对话行
   * - 已读回执：只在前移时写入。
   * - 提及：别人的新消息提及我（或回复我）时记下；读到、自己发出消息（发送即已读）后移除，提及我的消息被撤回时也移除。
   * 置顶、静音照搬原行；自己发出消息、或离开群组变成只读对话时清空草稿。
   */
  private applyEvents(chatId: string, selfId: string, events: FanoutEvent[], chat: ChatSnapshot): Update[] {
    const cur = this.sql.one<DialogRow>('SELECT * FROM dialogs WHERE chat_id = ?', chatId)
    // 对方删除了秘密聊天：对话一并删除，留下墓碑（1 行）
    if (events.some((e) => e.type === 'chat_deleted')) {
      if (!cur || cur.status === 'deleted') return []
      const row: DialogRow = { ...cur, status: 'deleted', pinned_rank: null, muted_until: 0, draft: null, mentions: null, pts: ++this.userPts }
      this.sql.run(
        'UPDATE dialogs SET status = ?, pinned_rank = ?, muted_until = ?, draft = ?, mentions = ?, pts = ? WHERE chat_id = ?',
        row.status, row.pinned_rank, row.muted_until, row.draft, row.mentions, row.pts, row.chat_id,
      )
      return [{ k: 'user', pts: row.pts, ev: { type: 'dialog', dialog: toDialog(row) } }]
    }
    const changes = events
      .flatMap((e) => (e.type === 'peer_read' || e.type === 'chat_deleted' ? [] : [e]))
      .sort((a, b) => a.message.pts - b.message.pts)
    const peerRead = Math.max(0, ...events.map((e) => (e.type === 'peer_read' ? e.max_seq : 0)))

    // 对方已读只更新已有的对话行
    let dirty = cur !== undefined && peerRead > cur.peer_read_seq
    let topSeq = cur?.top_seq ?? 0
    let preview = cur?.top_preview ?? null
    let chatPts = cur?.chat_pts ?? 0
    let lastRead = cur?.last_read_seq ?? 0
    let status: DialogStatus = cur?.status ?? 'member'
    let draft = cur?.draft ?? null
    let mentions = cur?.mentions ? (JSON.parse(cur.mentions) as number[]) : []
    const pushes: Update[] = []
    const calls: CallLog[] = []

    for (const ev of changes) {
      const m = ev.message
      if (ev.type === 'new_message') {
        if (m.pts <= chatPts) continue
        if (m.seq > topSeq) {
          topSeq = m.seq
          preview = JSON.stringify(toPreview(m))
        }
        // 发送即已读；发出的就不再是草稿（贴纸消息除外：点选贴纸不动输入框里的文字）。通话记录在挂断时才写入，不能当成发送：
        // 除了被叫方的未接来电，它都不算未读，但只在之前的消息都读过时才前移，免得把通话期间对方发来的消息一起算成已读
        if (isCallRecord(m)) {
          if (!missedBy(m, selfId) && lastRead === m.seq - 1) lastRead = m.seq
        } else if (m.sender_id === selfId) {
          lastRead = Math.max(lastRead, m.seq)
        } else if (addsMe(m, selfId)) {
          // 被拉进群（新加入，或被拉回）：之前的历史看得到但不算未读，只有拉我进群的这条
          lastRead = Math.max(lastRead, m.seq - 1)
        }
        if (m.sender_id === selfId && (m.kind === 'text' || (m.kind === 'media' && m.media[0]?.type !== 'sticker'))) draft = null
        status = nextStatus(status, m, selfId)
        if (status !== 'member') draft = null
        if (ev.mentioned?.includes(selfId) && !mentions.includes(m.seq)) mentions.push(m.seq)
        if (m.kind === 'service' && m.action.type === 'call') {
          const peer = parsePrivateChatId(chatId)?.find((id) => id !== selfId)
          if (peer) {
            const { call_id, result, duration = 0 } = m.action
            calls.push({ call_id, chat_id: chatId, seq: m.seq, peer_id: peer, caller_id: m.sender_id, result, duration, date: m.date })
          }
        }
        chatPts = m.pts
        dirty = true
      } else if (m.kind === 'recalled' && mentions.includes(m.seq)) {
        mentions = mentions.filter((seq) => seq !== m.seq)
        dirty = true
      }
      // 群组通话结束时通话记录被改写：加入过的人记进最近通话
      if (ev.type === 'update_message' && m.kind === 'service' && m.action.type === 'group_call' && m.action.joined?.includes(selfId)) {
        const { call_id, duration = 0 } = m.action
        calls.push({ call_id, chat_id: chatId, seq: m.seq, peer_id: m.sender_id, caller_id: m.sender_id, result: 'ended', duration, date: m.date + duration * 1000 })
      }
      if (ev.type === 'update_message' && m.pts > chatPts && m.seq >= topSeq) {
        const next = JSON.stringify(toPreview(m))
        // 最后一条消息的新消息事件还没到时，以这条变更为准
        if (m.seq > topSeq || next !== preview) {
          topSeq = m.seq
          preview = next
          chatPts = m.pts
          dirty = true
        }
      }
      pushes.push({ k: 'chat', chat_id: chatId, pts: m.pts, pts_count: 1, ev })
    }
    const callUpdates = this.logCalls(calls)
    if (!dirty) return [...pushes, ...callUpdates]

    const row: DialogRow = {
      chat_id: chatId,
      kind: chat.kind,
      title: chat.title,
      status,
      pts: ++this.userPts,
      mentions: unreadMentions(JSON.stringify(mentions), lastRead),
      top_seq: topSeq,
      top_preview: preview,
      chat_pts: chatPts,
      last_read_seq: lastRead,
      peer_read_seq: Math.max(cur?.peer_read_seq ?? 0, peerRead),
      pinned_rank: cur?.pinned_rank ?? null,
      muted_until: cur?.muted_until ?? 0,
      draft,
    }
    this.sql.run(
      `INSERT INTO dialogs (chat_id, kind, title, status, pts, top_seq, top_preview, chat_pts, last_read_seq, peer_read_seq, draft, mentions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, status = excluded.status, pts = excluded.pts,
         top_seq = excluded.top_seq, top_preview = excluded.top_preview,
         chat_pts = excluded.chat_pts, last_read_seq = excluded.last_read_seq, peer_read_seq = excluded.peer_read_seq,
         draft = excluded.draft, mentions = excluded.mentions`,
      row.chat_id, row.kind, row.title, row.status, row.pts, row.top_seq, row.top_preview, row.chat_pts, row.last_read_seq,
      row.peer_read_seq, row.draft, row.mentions,
    )
    return [...pushes, ...callUpdates, { k: 'user', pts: row.pts, ev: { type: 'dialog', dialog: toDialog(row) } }]
  }

  /**
   * 记进最近通话（每条 1 行），已经记过的（扇出重试）跳过；超过 MAX_RECENT_CALLS 时删掉最早的（每条 1 行）。
   * 与对话行在同一批更新里，各占一个 user_pts，排在对话行之前
   */
  private logCalls(calls: CallLog[]): Update[] {
    const updates: Update[] = []
    for (const call of calls) {
      if (this.sql.one('SELECT 1 AS x FROM calls WHERE call_id = ?', call.call_id)) continue
      const pts = ++this.userPts
      this.sql.run(
        'INSERT INTO calls (call_id, chat_id, seq, peer_id, caller_id, result, duration, date, pts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        call.call_id, call.chat_id, call.seq, call.peer_id, call.caller_id, call.result, call.duration, call.date, pts,
      )
      updates.push({ k: 'user', pts, ev: { type: 'call', call } })
    }
    if (updates.length > 0) {
      this.sql.run(
        'DELETE FROM calls WHERE call_id IN (SELECT call_id FROM calls ORDER BY date DESC, call_id LIMIT -1 OFFSET ?)',
        MAX_RECENT_CALLS,
      )
    }
    return updates
  }
}

/** 隐藏最后上线时间时给出的大致范围：在线与 3 天内都是 recently */
function approximate(presence: Presence, now = Date.now()): Presence {
  if (presence.status === 'online') return { status: 'recently' }
  if (presence.status !== 'offline') return presence
  const ago = now - presence.last_seen
  if (presence.last_seen > 0 && ago <= 3 * DAY_MS) return { status: 'recently' }
  if (presence.last_seen > 0 && ago <= 7 * DAY_MS) return { status: 'week' }
  if (presence.last_seen > 0 && ago <= 30 * DAY_MS) return { status: 'month' }
  return { status: 'long' }
}

function isCallRecord(m: Message): boolean {
  return m.kind === 'service' && m.action.type === 'call'
}

/** 自己作为被叫方没接到的通话的记录 */
function missedBy(m: Message, selfId: string): boolean {
  return m.kind === 'service' && m.action.type === 'call' && m.sender_id !== selfId && isMissedCall(m.action.result)
}

/** 服务消息决定自己在群里的身份：被拉进来即成员，退出或被移除即只读 */
function addsMe(m: Message, selfId: string): boolean {
  return m.kind === 'service' && m.action.type === 'members_add' && m.action.user_ids.includes(selfId)
}

function nextStatus(status: DialogStatus, m: Message, selfId: string): DialogStatus {
  if (m.kind !== 'service') return status
  const a = m.action
  switch (a.type) {
    case 'chat_create':
    case 'members_add':
      return m.sender_id === selfId || a.user_ids.includes(selfId) ? 'member' : status
    case 'member_remove':
      return a.user_id === selfId ? 'left' : status
    case 'member_leave':
      return m.sender_id === selfId ? 'left' : status
    case 'member_join':
      return m.sender_id === selfId ? 'member' : status
    case 'title_edit':
    case 'message_pin':
    case 'call':
    case 'group_call':
    case 'secret_create':
    case 'secret_devices':
      return status
  }
}

function toPreview(m: Message): DialogPreview {
  const base = { sender_id: m.sender_id, date: m.date }
  switch (m.kind) {
    case 'text':
      return { ...base, kind: 'text', text: m.text.slice(0, PREVIEW_LENGTH) }
    case 'media':
      return { ...base, ...summarizeMedia(m.media) }
    case 'service':
      return { ...base, kind: 'service', action: m.action }
    case 'recalled':
      return { ...base, kind: 'recalled' }
    case 'cipher':
      return { ...base, kind: 'cipher', cipher: m.cipher }
  }
}

function toSticker(row: StickerRow): SavedSticker {
  const { key, mime, w, h, size, thumbhash, added_at } = row
  return { type: 'sticker', key, mime, w, h, size, thumbhash, added_at }
}

function toStickerChange(row: StickerRow): StickerChange {
  return { key: row.key, sticker: row.removed ? null : toSticker(row) }
}

function toRelation(row: RelationRow): Relation {
  return { user_id: row.user_id, contact: row.contact === 1, alias: row.alias, blocked: row.blocked === 1 }
}

function toDialog(row: DialogRow): Dialog {
  return {
    chat_id: row.chat_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    pts: row.pts,
    top_seq: row.top_seq,
    top_preview: row.top_preview ? (JSON.parse(row.top_preview) as DialogPreview) : null,
    chat_pts: row.chat_pts,
    last_read_seq: row.last_read_seq,
    peer_read_seq: row.peer_read_seq,
    pinned_rank: row.pinned_rank,
    muted_until: row.muted_until,
    draft: row.draft ? (JSON.parse(row.draft) as Draft) : null,
    unread_mentions: row.mentions ? (JSON.parse(row.mentions) as number[]) : [],
  }
}

/** 已读位置之后的提及（升序 JSON）；没有了为 null */
function unreadMentions(json: string | null, lastRead: number): string | null {
  const seqs = json ? (JSON.parse(json) as number[]).filter((seq) => seq > lastRead).sort((a, b) => a - b) : []
  return seqs.length > 0 ? JSON.stringify(seqs) : null
}

function reply(ws: WebSocket, id: number, res: Result<unknown>) {
  send(ws, res.ok ? { t: 'res', id, ok: true, r: res.r } : { t: 'res', id, ok: false, e: res.e, user_ids: res.user_ids })
}

function send(ws: WebSocket, frame: ServerFrame) {
  try {
    ws.send(JSON.stringify(frame))
  } catch {
    // 连接正在关闭
  }
}

const NO_LOCATION: DeviceLocation = { ip: null, country: null, city: null }

/** header 由 Worker 写入；本地开发与测试直连 DO 时没有 */
function parseLocation(raw: string | null): DeviceLocation {
  if (!raw) return NO_LOCATION
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>
    const str = (x: unknown) => (typeof x === 'string' && x ? x.slice(0, 64) : null)
    return { ip: str(value.ip), country: str(value.country), city: str(value.city) }
  } catch {
    return NO_LOCATION
  }
}
