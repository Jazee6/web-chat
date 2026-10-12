// 同步状态机：应用服务端更新、缺口检测、差量同步、发件箱，以及设备状态（在线、输入中）。
// 见 docs/architecture/03-sync-protocol.md、04-realtime-and-fanout.md
import {
  GROUP_CALL_LOCK,
  MAX_ALBUM_SIZE,
  MAX_PAGE_LIMIT,
  MAX_VIEWING,
  PRESENCE_RENEW_MS,
  TYPING_THROTTLE_MS,
  chatPair,
  isGroupChatId,
  messageUserIds,
  parseInviteCode,
  parseSecretChatId,
  sentMedia,
  sentPreview,
  type Call,
  type GroupCall,
  type Dialog,
  type Draft,
  type ErrorCode,
  type LinkPreview,
  type Message,
  type Method,
  type MethodParams,
  type Presence,
  type PushSubscriptionKeys,
  type ReactionEmoji,
  type Transient,
  type Update,
  type UserEvent,
} from 'shared/protocol'
import { inviteCodeOf, linkOnly } from 'shared/text'
import { LINK_WAIT_MS, resolveWebLink } from '@/features/link/resolve'
import { MEDIA_ORIGIN } from '@/lib/deploy'
import { deleteBlobs, saveBlobs } from './blobs'
import type { OpError, Ops, OutgoingMessage, WorkerMessage } from './bridge'
import { OfflineError, type Connection, type RpcResult } from './connection'
import { GAP_WAIT_MS, classify, drain, needsReconcile } from './logic'
import type { Binding, SealedMedia, SecretPayload, SecretReaction } from './secret/format'
import { SecretError, Secrets } from './secret/secrets'
import {
  sealedMedia,
  uploadedMedia,
  type NewOutboxRow,
  type OutboxLink,
  type OutboxMedia,
  type OutboxRow,
  type Store,
} from './store'
import { UploadError, UploadOffline, uploadLinkPhoto, uploadMedia, uploadSticker } from './upload'

/** 改变群成员的服务消息：正在查看的群组收到时刷新成员 */
const MEMBER_ACTIONS = new Set(['chat_create', 'members_add', 'member_remove', 'member_leave', 'member_join'])

/** 向上分页与 too_long 后重建窗口时每页的消息数 */
const PAGE_SIZE = 50
/** 同一会话的已读上报间隔，见 04 § 已读回执 */
const READ_THROTTLE_MS = 2000
/** 标签页可见性上报的有效期：可见的标签页定期上报，崩溃或被冻结的标签页过期后不再算数 */
const TAB_TTL_MS = PRESENCE_RENEW_MS + 20_000
/** 秘密聊天的写入遇到纪元过期时，追上之后最多试几次 */
const SECRET_ATTEMPTS = 3
/** 上传进度的广播间隔 */
const PROGRESS_INTERVAL_MS = 100
/** 链接预览卡片的图片在 OPFS 暂存目录里的文件名 */
const LINK_FILE = 'l'

/** 操作失败，code 与 userIds 原样返回给标签页 */
export class OpFailure extends Error {
  readonly code: OpError
  readonly userIds: string[] | undefined

  constructor(code: OpError, userIds?: string[]) {
    super(code)
    this.code = code
    this.userIds = userIds
  }
}

type ChatUpdate = Extract<Update, { k: 'chat' }>
type ReadyLink = Extract<OutboxLink, { state: 'ready' }>
type PendingUser = { pts: number; count: number; ev: UserEvent }
type PendingChat = { pts: number; count: number; update: ChatUpdate }

export class Engine {
  /** 标签页 → 正在查看的会话 */
  private viewing = new Map<string, string>()
  private userPending: PendingUser[] = []
  private userTimer: ReturnType<typeof setTimeout> | undefined
  private chatPending = new Map<string, PendingChat[]>()
  private chatTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private syncingUser: Promise<void> | null = null
  private syncingChats = new Map<string, Promise<void>>()
  /** 正在逐条发送发件箱的会话；运行期间又有新消息入队或重试时，结束后再跑一轮 */
  private pumping = new Set<string>()
  private repump = new Set<string>()
  /** 发送请求依次入队：写 OPFS 较慢时，后到的消息也不会插到前面 */
  private enqueuing: Promise<unknown> = Promise.resolve()
  private profilesRefreshed = false
  private loadingMembers = new Map<string, Promise<void>>()
  /** 待上报的已读位置，按会话合并 */
  private reads = new Map<string, number>()
  private readTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readSentAt = new Map<string, number>()
  /** 正在同步草稿的会话 */
  private flushingDrafts = new Set<string>()
  /** 正在拉取的回复引用与置顶消息：`${chat_id}:${seq}` */
  private fetchingReplies = new Set<string>()
  /** 可见的标签页 → 最近一次上报的时间 */
  private visibleTabs = new Map<string, number>()
  /** 最近一次发给服务端的设备状态（JSON），用于判断是否变化 */
  private sentPresence: string | null = null
  /** 私聊对象的在线状态，新打开会话的标签页可以立即显示 */
  private peers = new Map<string, Presence>()
  /** `${chat_id}:${action}` → 最近一次上报输入中的时间：从打字换成录音时立即上报 */
  private typingSentAt = new Map<string, number>()
  /** 当前的通话（来电、本设备或其他设备上的通话），以及通话所在的标签页 */
  private call: Call | null = null
  private callTab: string | null = null
  /** 向服务端问过通话状态（新 Worker 问过之前，标签页不把"没有通话"当真） */
  private callChecked = false
  /** 记得的群组通话：查看过的群组里的、自己参加的；mine 为自己就在这台设备上参加 */
  private groupCalls = new Map<string, { call: GroupCall; mine: boolean }>()
  /** 正在排队等通话标签页的锁的群组通话 */
  private watchingGroupCall: string | null = null
  /** 本机的推送订阅：undefined 表示标签页还没告知；sentPush 为这条连接上最近一次上报的值（JSON） */
  private push: PushSubscriptionKeys | null | undefined
  private sentPush: string | null = null
  /** 秘密聊天：加入、追上提交与加解密；本设备加入（或进入新纪元）后接着发发件箱 */
  private readonly secrets: Secrets

  private readonly store: Store
  private readonly conn: Connection
  private readonly me: string
  private readonly emit: (message: WorkerMessage) => void

  constructor(store: Store, conn: Connection, me: string, emit: (message: WorkerMessage) => void) {
    this.store = store
    this.conn = conn
    this.me = me
    this.emit = emit
    this.secrets = new Secrets(store, conn, me, {
      onReady: (chatId) => this.kick(chatId),
      onReplies: (chatId, seqs) => void this.fetchMessages(chatId, seqs).catch(ignoreOffline),
    })
    // 查看期间续订：服务端的查看者登记与在线状态观察都会过期，对象休眠后也靠续订恢复
    setInterval(() => void this.updatePresence(true), PRESENCE_RENEW_MS)
  }

  // ---------- 连接生命周期 ----------

  /** 连上后：先报设备状态（新连接默认不可见），再对话列表差量 → 正在查看的会话差量 → 重发发件箱 */
  async onOpen() {
    this.sentPresence = null
    void this.updatePresence()
    // 服务端可能已清除订阅（推送服务报告失效、session 过期），每条新连接都重新上报；没变化时服务端不写库
    this.sentPush = null
    this.reportPush().catch(ignoreOffline)
    // 断线期间的来电与本设备的通话：通话所在的设备由服务端在这里认领回来
    this.refreshCall().catch(ignoreOffline)
    try {
      await this.syncUser()
      // 秘密聊天的检查各自进行，加入了的随即发发件箱
      this.secrets.onOpen().catch(ignoreOffline)
      await Promise.all([...new Set(this.viewing.values())].map((chatId) => this.syncChat(chatId).catch(ignoreOffline)))
      for (const chatId of this.store.outboxChats()) this.kick(chatId)
      for (const chatId of this.reads.keys()) this.scheduleRead(chatId)
      for (const chatId of this.store.dirtyDrafts()) void this.flushDraft(chatId)
      await this.refreshProfiles(!this.profilesRefreshed)
      this.profilesRefreshed = true
    } catch (e) {
      ignoreOffline(e)
    }
  }

  onUpdates(updates: Update[]) {
    for (const u of updates) {
      if (u.k === 'chat') {
        this.onChatUpdate(u)
        continue
      }
      this.onUserUpdate({ pts: u.pts, count: 1, ev: u.ev })
    }
  }

  // ---------- 用户序列 ----------

  private onUserUpdate(item: PendingUser) {
    const verdict = classify(this.store.userPts, item.pts, item.count)
    if (verdict === 'skip') return
    if (verdict === 'gap') {
      this.userPending.push(item)
      this.userTimer ??= setTimeout(() => {
        this.userTimer = undefined
        if (this.userPending.length > 0) this.syncUser().catch(ignoreOffline)
      }, GAP_WAIT_MS)
      return
    }
    this.store.tx(() => {
      this.applyUser(item)
      const { ready, waiting } = drain(item.pts, this.userPending)
      for (const next of ready) this.applyUser(next)
      this.userPending = waiting
    })
    this.refreshProfiles(false).catch(ignoreOffline)
  }

  private applyUser(item: PendingUser) {
    switch (item.ev.type) {
      case 'dialog':
        this.putDialog(item.ev.dialog)
        break
      case 'settings':
        this.store.putSettings(item.ev.settings)
        break
      case 'relation':
        this.store.putRelation(item.ev.relation)
        break
      case 'call':
        this.store.putCall(item.ev.call)
        break
      case 'sticker':
        this.store.putSticker(item.ev)
        break
    }
    this.store.setUserPts(item.pts)
  }

  private putDialog(dialog: Dialog) {
    const known = this.store.dialogKind(dialog.chat_id) !== null
    if (this.store.upsertDialog(dialog)) this.resetChat(dialog.chat_id)
    if (dialog.kind === 'secret' && dialog.status === 'member') {
      // 新出现的秘密聊天：加入（对方刚开始的，或自己的其他设备开始的）
      if (!known) queueMicrotask(() => void this.secrets.reconcile(dialog.chat_id))
      if (dialog.top_preview?.kind === 'cipher') queueMicrotask(() => this.secrets.unseal())
    }
    // 对话行出现之前写的草稿（服务端当时返回 not_found）：现在可以同步了
    if (dialog.status === 'member' && this.store.draft(dialog.chat_id)?.dirty) {
      queueMicrotask(() => void this.flushDraft(dialog.chat_id))
    }
  }

  /** 前成员被重新加入：本地窗口已丢弃，清掉缓存的乱序更新；正在查看时立即从头同步 */
  private resetChat(chatId: string) {
    this.chatPending.delete(chatId)
    clearTimeout(this.chatTimers.get(chatId))
    this.chatTimers.delete(chatId)
    if (this.isViewed(chatId)) queueMicrotask(() => this.syncChat(chatId).catch(ignoreOffline))
  }

  private syncUser(): Promise<void> {
    this.syncingUser ??= (async () => {
      const r = unwrap(await this.conn.request('sync.user', { pts: this.store.userPts }))
      this.store.tx(() => {
        for (const d of r.dialogs) this.putDialog(d)
        for (const rel of r.relations) this.store.putRelation(rel)
        if (r.settings) this.store.putSettings(r.settings)
        for (const call of r.calls) this.store.putCall(call)
        for (const change of r.stickers) this.store.putSticker(change)
        this.store.setUserPts(r.pts)
        const { ready, waiting } = drain(this.store.userPts, this.userPending)
        for (const next of ready) this.applyUser(next)
        this.userPending = waiting
      })
    })().finally(() => {
      this.syncingUser = null
    })
    return this.syncingUser
  }

  // ---------- 会话序列 ----------

  private onChatUpdate(u: ChatUpdate) {
    const state = this.store.chatState(u.chat_id)
    // 从未打开过的会话不保存消息，对话列表摘要由 user 更新维护
    if (!state) return
    const verdict = classify(state.pts, u.pts, u.pts_count)
    if (verdict === 'skip') return
    if (verdict === 'gap') {
      const list = this.chatPending.get(u.chat_id) ?? []
      list.push({ pts: u.pts, count: u.pts_count, update: u })
      this.chatPending.set(u.chat_id, list)
      if (!this.chatTimers.has(u.chat_id)) {
        this.chatTimers.set(u.chat_id, setTimeout(() => this.onChatGapTimeout(u.chat_id), GAP_WAIT_MS))
      }
      return
    }
    this.store.tx(() => {
      this.applyChatUpdate(u, state.min_seq)
      this.drainChat(u.chat_id)
    })
  }

  private onChatGapTimeout(chatId: string) {
    this.chatTimers.delete(chatId)
    if (!this.chatPending.get(chatId)?.length) return
    // 只为用户看得到的会话拉差量；其余等打开时再同步
    if (this.isViewed(chatId)) this.syncChat(chatId).catch(ignoreOffline)
    else this.chatPending.delete(chatId)
  }

  private applyChatUpdate(u: ChatUpdate, minSeq: number) {
    this.putMessages(u.chat_id, [u.ev.message])
    this.store.setChatState(u.chat_id, { pts: u.pts, min_seq: minSeq })
    // 对方发出了消息，他的「正在输入」随之结束；编辑、回应不算
    const sender = u.ev.message.sender_id
    if (u.ev.type === 'new_message' && sender !== this.me) this.emit({ k: 'typing', chat_id: u.chat_id, user_id: sender, action: null })
  }

  /** 写入消息；缺资料的用户与本地没有的回复引用稍后拉取，成员变化时刷新正在查看的群组的成员 */
  private putMessages(chatId: string, messages: Message[]) {
    this.store.putMessages(chatId, messages)
    if (messages.some((m) => m.kind === 'cipher')) queueMicrotask(() => this.secrets.unseal())
    const ids = this.store.missingUserIds(messages.flatMap(messageUserIds))
    if (ids.length > 0) queueMicrotask(() => this.refreshProfiles(false, ids).catch(ignoreOffline))
    const replies = messages.flatMap((m) => ((m.kind === 'text' || m.kind === 'media') && m.reply_to ? [m.reply_to] : []))
    if (replies.length > 0) queueMicrotask(() => this.fetchMessages(chatId, replies).catch(ignoreOffline))
    const membersChanged = messages.some((m) => m.kind === 'service' && MEMBER_ACTIONS.has(m.action.type))
    if (!membersChanged || !this.isViewed(chatId)) return
    // 同一帧里的对话行更新随后才应用：等它落地后再判断自己是否仍是成员
    queueMicrotask(() => {
      if (this.store.dialogStatus(chatId) === 'member') this.loadMembers(chatId).catch(ignoreOffline)
    })
  }

  /** 应用缓存中已经连续的更新；须在事务内调用 */
  private drainChat(chatId: string) {
    const state = this.store.chatState(chatId)
    const pending = this.chatPending.get(chatId)
    if (!state || !pending) return
    const { ready, waiting } = drain(state.pts, pending)
    for (const next of ready) this.applyChatUpdate(next.update, state.min_seq)
    if (waiting.length > 0) this.chatPending.set(chatId, waiting)
    else this.chatPending.delete(chatId)
  }

  /** 会话差量同步；本地没有该会话时加载最新一页 */
  private syncChat(chatId: string): Promise<void> {
    let running = this.syncingChats.get(chatId)
    if (!running) {
      running = this.doSyncChat(chatId).finally(() => this.syncingChats.delete(chatId))
      this.syncingChats.set(chatId, running)
    }
    return running
  }

  private async doSyncChat(chatId: string) {
    const before = this.store.chatState(chatId)
    const r = unwrap(await this.conn.request('sync.chat', { chat_id: chatId, pts: before?.pts ?? 0, limit: MAX_PAGE_LIMIT }))
    // 置顶的消息可能早于本地的窗口：本地窗口落定之后再拉（too_long 时会先丢弃整个窗口）
    const fetchPinned = () => {
      if (r.pinned.length > 0) this.fetchMessages(chatId, r.pinned).catch(ignoreOffline)
    }
    if (!r.too_long) {
      this.store.tx(() => {
        const cur = this.store.chatState(chatId)
        this.putMessages(chatId, r.messages)
        // 从 0 开始的差量包含全部消息，因此本地从第 1 条起连续
        this.store.setChatState(chatId, { pts: Math.max(cur?.pts ?? 0, r.pts), min_seq: cur?.min_seq ?? 1 })
        this.drainChat(chatId)
      })
      fetchPinned()
      return
    }
    // 变化太多：丢弃本地窗口，从最新一页重新开始，更早的靠向上滚动补齐
    const page = unwrap(await this.conn.request('messages.history', { chat_id: chatId, limit: PAGE_SIZE }))
    this.store.tx(() => {
      const cur = this.store.chatState(chatId)
      this.store.dropMessages(chatId)
      this.putMessages(chatId, page.messages)
      this.store.setChatState(chatId, { pts: Math.max(cur?.pts ?? 0, r.pts), min_seq: pageStart(page.messages) })
      this.drainChat(chatId)
    })
    fetchPinned()
  }

  /**
   * 拉取本地没有的回复引用与置顶消息。它们可能早于 min_seq，只作为引用存在；
   * 消息列表只显示 min_seq 之后连续的部分，向上分页补齐时会被覆盖。
   */
  private async fetchMessages(chatId: string, seqs: number[]) {
    const missing = this.store.missingSeqs(chatId, seqs).filter((seq) => !this.fetchingReplies.has(`${chatId}:${seq}`))
    if (missing.length === 0 || !this.conn.online) return
    const keys = missing.slice(0, MAX_PAGE_LIMIT).map((seq) => `${chatId}:${seq}`)
    for (const key of keys) this.fetchingReplies.add(key)
    try {
      const r = unwrap(await this.conn.request('messages.get', { chat_id: chatId, seqs: missing.slice(0, MAX_PAGE_LIMIT) }))
      this.store.tx(() => this.store.putMessages(chatId, r.messages))
      if (r.messages.some((m) => m.kind === 'cipher')) this.secrets.unseal()
      const ids = this.store.missingUserIds(r.messages.map((m) => m.sender_id))
      if (ids.length > 0) await this.refreshProfiles(false, ids)
    } finally {
      for (const key of keys) this.fetchingReplies.delete(key)
    }
  }

  private isViewed(chatId: string) {
    for (const id of this.viewing.values()) if (id === chatId) return true
    return false
  }

  // ---------- 发件箱 ----------

  /** 逐条发送该会话的发件箱：同一会话严格按入队顺序，失败的留在原位，后面的照常发送 */
  private kick(chatId: string) {
    if (this.pumping.has(chatId)) {
      this.repump.add(chatId)
      return
    }
    this.pumping.add(chatId)
    this.pump(chatId)
      .catch(ignoreOffline)
      .finally(() => {
        this.pumping.delete(chatId)
        if (this.repump.delete(chatId)) this.kick(chatId)
      })
  }

  private async pump(chatId: string) {
    let reconciled = false
    while (this.conn.online) {
      const row = this.store.nextOutbox(chatId)
      if (!row) return
      // 秘密聊天在本设备加入之前发不了：加入后 Secrets 会再 kick
      if (isSecret(chatId) && !this.secrets.ready(chatId)) return
      try {
        // 确认可能丢失：先拉差量，用自己的 random_id 对账，只重发确实没有落库的
        if (!reconciled && needsReconcile(row.created_at, Date.now())) {
          await this.syncChat(chatId)
          reconciled = true
          if (this.store.sentRandomIds(chatId, [row.random_id]).has(row.random_id)) {
            this.store.tx(() => this.store.deleteOutbox(row.random_id))
            void deleteBlobs(row.random_id)
            continue
          }
        }
        await this.dispatch(row)
      } catch (e) {
        if (e instanceof OfflineError) throw e
        // 其他意外（暂存文件丢失、响应格式不对……）只让这一条失败，不能卡住整个会话的发件箱
        console.error('send failed', e)
        this.store.tx(() => this.store.setOutboxState(row, 'failed'))
      }
    }
  }

  /**
   * 发送一条；断线时抛出 OfflineError，让 pump 停下，重连后再来。
   * 媒体在发件箱里放得太久、已被桶的生命周期规则删掉时（media_expired），清掉对象键，从 OPFS 重新上传后再发一次
   */
  private async dispatch(row: OutboxRow, reuploaded = false): Promise<void> {
    if (isSecret(row.chat_id)) return this.dispatchSecret(row)
    const sticker = row.kind === 'media' && row.media[0]?.type === 'sticker' ? row.media[0] : null
    if (sticker) return this.dispatchSticker(row, sticker)
    let media = null
    if (row.kind === 'media') {
      const items = await this.upload(row)
      if (!items) return
      media = uploadedMedia(items)
      if (!media) throw new Error('media not uploaded')
    }
    const preview = row.kind === 'text' && row.link ? await this.linkPreview(row) : undefined
    const res =
      row.kind === 'text'
        ? await this.conn.request('messages.send', {
            chat_id: row.chat_id,
            random_id: row.random_id,
            text: row.text,
            entities: row.entities ?? undefined,
            reply_to: row.reply_to ?? undefined,
            preview,
          })
        : await this.conn.request('messages.sendMedia', {
            chat_id: row.chat_id,
            random_id: row.random_id,
            media: media as MethodParams<'messages.sendMedia'>['media'],
            reply_to: row.reply_to ?? undefined,
          })
    if (!res.ok && res.e === 'media_expired' && !reuploaded) {
      this.store.tx(() => this.store.clearUploaded(row.random_id))
      const current = this.store.outboxRow(row.random_id)
      if (current) return this.dispatch(current, true)
      return
    }
    // 服务端把待发对象复制到了发送后的键，本地照样换过来
    this.store.tx(() => {
      if (res.ok) this.store.confirmOutbox(row, res.r, media && sentMedia(media), preview && sentPreview(preview))
      else this.store.setOutboxState(row, 'failed', res.e === 'blocked' ? res.e : null)
    })
    if (res.ok && (row.kind === 'media' || preview)) void deleteBlobs(row.random_id)
  }

  /** 普通会话里的贴纸：发的是我的贴纸里的那个对象，不上传；消息里的键就是它（ADR-0012） */
  private async dispatchSticker(row: OutboxRow, item: Extract<OutboxMedia, { type: 'sticker' }>) {
    const res = await this.conn.request('messages.sendSticker', {
      chat_id: row.chat_id,
      random_id: row.random_id,
      key: item.source,
      reply_to: row.reply_to ?? undefined,
    })
    const { source: key, mime, w, h, size, thumbhash } = item
    this.store.tx(() => {
      if (res.ok) this.store.confirmOutbox(row, res.r, [{ type: 'sticker', key, mime, w, h, size, thumbhash }])
      else this.store.setOutboxState(row, 'failed', res.e === 'blocked' ? res.e : null)
    })
  }

  /**
   * 秘密聊天的消息：加密后发出，确认时本地直接写明文（推回来的同一条密文不会覆盖它）。
   * 媒体先加密上传，消息里带上发送后的键与密钥，待发键交给服务端复制；过期被删时同 dispatch 重新上传一次
   */
  private async dispatchSecret(row: OutboxRow, reuploaded = false): Promise<void> {
    let pending: SealedMedia[] | null = null
    if (row.kind === 'media') {
      const items = await this.upload(row, true)
      if (!items) return
      pending = sealedMedia(items)
      if (!pending) throw new Error('media not uploaded')
    }
    const media = pending && sentMedia(pending)
    const reply = row.reply_to ? { reply_to: row.reply_to } : {}
    const payload: SecretPayload =
      row.kind === 'text'
        ? { t: 'text', text: row.text, ...reply, random_id: row.random_id }
        : { t: 'media', media: media as Extract<SecretPayload, { t: 'media' }>['media'], ...reply, random_id: row.random_id }
    const keys = pending?.flatMap((m) => (m.type === 'photo' || m.type === 'video' ? [m.key, m.preview_key] : [m.key]))
    const res = await this.secretWrite(row.chat_id, payload, { kind: 'message' }, (epoch, cipher) =>
      this.conn.request('secrets.send', { chat_id: row.chat_id, random_id: row.random_id, epoch, cipher, ...(keys ? { keys } : {}) }),
    )
    if (!res.ok && res.e === 'media_expired' && !reuploaded) {
      this.store.tx(() => this.store.clearUploaded(row.random_id))
      const current = this.store.outboxRow(row.random_id)
      if (current) return this.dispatchSecret(current, true)
      return
    }
    this.store.tx(() => {
      if (!res.ok) {
        this.store.setOutboxState(row, 'failed', res.e === 'blocked' ? res.e : null)
        return
      }
      this.store.confirmOutbox(row, res.r, media)
      // 推回来的密文可能先到了（行已经在、发件箱已经删了）：明文本来就知道，不必等解开
      const { seq, pts, date } = res.r
      const base = { chat_id: row.chat_id, seq, pts, sender_id: this.me, date, ...reply }
      this.store.putPlain(
        row.chat_id,
        seq,
        pts,
        row.kind === 'text' ? { ...base, kind: 'text', text: row.text } : { ...base, kind: 'media', media: media! },
        row.random_id,
      )
    })
    if (res.ok && row.kind === 'media') void deleteBlobs(row.random_id)
  }

  /** 用当前纪元加密后写入；别的设备刚提交、纪元过期时追上再试 */
  private async secretWrite<M extends 'secrets.send' | 'secrets.edit' | 'secrets.react'>(
    chatId: string,
    plaintext: SecretPayload | SecretReaction,
    binding: Binding,
    write: (epoch: number, cipher: string) => Promise<RpcResult<M>>,
  ): Promise<RpcResult<M>> {
    for (let attempt = 1; ; attempt++) {
      const { epoch, cipher } = await this.secrets.encrypt(chatId, plaintext, binding)
      const res = await write(epoch, cipher)
      if (res.ok || res.e !== 'stale_epoch' || attempt === SECRET_ATTEMPTS) return res
      await this.secrets.refresh(chatId)
    }
  }

  /**
   * 准备好链接预览卡片：输入时没抓到的现在抓（最多 LINK_WAIT_MS），再上传卡片图片。
   * 抓不到就发成只有域名的卡片，图片传不上去就不带图，都不会让这条消息发送失败；每一步的结果写回发件箱
   */
  private async linkPreview(row: Extract<OutboxRow, { kind: 'text' }>): Promise<LinkPreview> {
    let link: ReadyLink
    if (row.link!.state === 'pending') {
      const resolved = await this.resolveLink(row)
      this.store.tx(() => this.store.setOutboxLink(row, resolved))
      link = resolved
    } else {
      link = row.link!
    }
    const { preview } = link
    let photo = link.photo
    if (photo && !photo.key) {
      try {
        photo = { ...photo, key: await uploadLinkPhoto(row.random_id, photo) }
      } catch (e) {
        if (e instanceof UploadOffline && !this.conn.online) throw new OfflineError()
        if (!(e instanceof UploadError) && !(e instanceof UploadOffline)) throw e
        console.error('link photo upload failed', e)
        photo = undefined
      }
      const next: OutboxLink = { state: 'ready', preview, ...(photo ? { photo } : {}) }
      this.store.tx(() => this.store.setOutboxLink(row, next))
    }
    if (preview.type === 'invite') return preview
    return photo?.key
      ? { ...preview, photo: { key: photo.key, w: photo.w, h: photo.h, thumbhash: photo.thumbhash } }
      : preview
  }

  /** 发送时才抓取卡片：本站的邀请链接问服务端要群名与人数，其他链接请 Worker 抓取 */
  private async resolveLink(row: Extract<OutboxRow, { kind: 'text' }>): Promise<ReadyLink> {
    const none: ReadyLink = { state: 'ready', preview: { type: 'web', title: null } }
    const url = linkOnly(row.text)
    if (!url) return none
    const code = inviteCodeOf(url, location.origin)
    if (code) {
      const res = await Promise.race([
        this.conn.request('chats.checkInvite', { code }),
        new Promise<null>((r) => setTimeout(() => r(null), LINK_WAIT_MS)),
      ])
      return res?.ok ? { state: 'ready', preview: { type: 'invite', title: res.r.title, member_count: res.r.member_count } } : none
    }
    try {
      const web = await resolveWebLink(url, AbortSignal.timeout(LINK_WAIT_MS))
      if (!web.photo) return { state: 'ready', preview: { type: 'web', title: web.title } }
      await saveBlobs(row.random_id, new Map([[LINK_FILE, web.photo.blob]]))
      const { blob, ...rest } = web.photo
      return { state: 'ready', preview: { type: 'web', title: web.title }, photo: { ...rest, file: LINK_FILE, size: blob.size } }
    } catch (e) {
      console.error('link preview failed', e)
      return none
    }
  }

  /** 上传还没传完的媒体（秘密聊天的加密后上传），返回上传完的发件箱媒体；失败时标记为发送失败并返回 null */
  private async upload(row: Extract<OutboxRow, { kind: 'media' }>, sealed = false): Promise<OutboxMedia[] | null> {
    let sentAt = 0
    try {
      await uploadMedia(
        row.random_id,
        row.media,
        (items) => this.store.setOutboxMedia(row.random_id, items),
        (progress) => {
          const now = Date.now()
          if (now - sentAt < PROGRESS_INTERVAL_MS && progress < 1) return
          sentAt = now
          this.emit({ k: 'upload', random_id: row.random_id, progress })
        },
        sealed,
      )
    } catch (e) {
      // WebSocket 还连着却传不上去（例如 R2 不可达），不能一直卡住后面的消息
      if (e instanceof UploadOffline && !this.conn.online) throw new OfflineError()
      if (!(e instanceof UploadError) && !(e instanceof UploadOffline)) throw e
      console.error('upload failed', e)
      this.store.tx(() => this.store.setOutboxState(row, 'failed'))
      return null
    } finally {
      this.emit({ k: 'upload', random_id: row.random_id, progress: null })
    }
    const current = this.store.outboxRow(row.random_id)
    if (current?.kind !== 'media') throw new Error('media not uploaded')
    return current.media
  }

  // ---------- 用户资料 ----------

  private async refreshProfiles(all: boolean, extra: string[] = []) {
    if (!this.conn.online) return
    const ids = [...new Set([...this.store.knownUserIds(!all), ...extra])]
    for (let i = 0; i < ids.length; i += MAX_PAGE_LIMIT) {
      const r = unwrap(await this.conn.request('users.get', { ids: ids.slice(i, i + MAX_PAGE_LIMIT) }))
      this.store.tx(() => this.store.putUsers(r.users))
    }
  }

  // ---------- 标签页操作 ----------

  query({ sql, params }: Ops['query']['args']) {
    return this.store.query(sql, params)
  }

  async view({ chatId }: Ops['view']['args'], tab: string) {
    if (!chatId) {
      this.viewing.delete(tab)
      void this.updatePresence()
      return null
    }
    this.viewing.set(tab, chatId)
    void this.updatePresence()
    // 打开会话时总是先 sync.chat：这是「只推不存」类更新的补齐点
    const peer = chatPair(chatId)?.find((id) => id !== this.me)
    const known = peer && this.peers.get(peer)
    if (known) this.emit({ k: 'presence', users: [{ user_id: peer, presence: known }] })
    if (peer && !this.store.hasUser(peer)) this.refreshProfiles(false, [peer]).catch(ignoreOffline)
    if (isGroupChatId(chatId) && this.store.dialogStatus(chatId) === 'member') this.loadMembers(chatId).catch(ignoreOffline)
    // 秘密聊天：顺便检查有没有错过的提交与设备变化
    if (isSecret(chatId) && this.store.dialogStatus(chatId) === 'member') void this.secrets.refresh(chatId)
    await this.syncChat(chatId).catch(ignoreOffline)
    return null
  }

  // ---------- 设备状态 ----------

  presence({ visible }: Ops['presence']['args'], tab: string) {
    if (visible) this.visibleTabs.set(tab, Date.now())
    else this.visibleTabs.delete(tab)
    void this.updatePresence()
    return null
  }

  /** 汇总各标签页：任一标签页可见即设备可见；只有可见的标签页算在「正在查看」里 */
  private deviceState() {
    const now = Date.now()
    for (const [tab, at] of this.visibleTabs) if (now - at > TAB_TTL_MS) this.visibleTabs.delete(tab)
    const viewing = [...new Set([...this.viewing].filter(([tab]) => this.visibleTabs.has(tab)).map(([, id]) => id))]
    return { visible: this.visibleTabs.size > 0, viewing: viewing.sort().slice(0, MAX_VIEWING) }
  }

  /** 设备状态变化时上报；renew 时即使没变，只要还在查看会话也上报一次 */
  private async updatePresence(renew = false) {
    if (!this.conn.online) return
    const state = this.deviceState()
    const key = JSON.stringify(state)
    if (key === this.sentPresence && !(renew && state.viewing.length > 0)) return
    this.sentPresence = key
    try {
      const { peers, group_calls } = unwrap(await this.conn.request('presence.update', state))
      for (const p of peers) this.peers.set(p.user_id, p.presence)
      if (peers.length > 0) this.emit({ k: 'presence', users: peers })
      // 查看的群组里的通话：没列出的就是没有（结束的通知可能丢了）
      for (const chatId of state.viewing) {
        if (!isGroupChatId(chatId)) continue
        const call = group_calls.find((c) => c.chat_id === chatId) ?? null
        this.setGroupCall(chatId, call, call !== null && this.groupCalls.get(chatId)?.mine === true)
      }
    } catch (e) {
      // 断线：重连后 onOpen 会重新上报
      ignoreOffline(e)
    }
  }

  onEvents(events: Transient[]) {
    for (const e of events) {
      if (e.type === 'typing') {
        this.emit({ k: 'typing', chat_id: e.chat_id, user_id: e.user_id, action: e.action })
      } else if (e.type === 'presence') {
        this.peers.set(e.user_id, e.presence)
        this.emit({ k: 'presence', users: [{ user_id: e.user_id, presence: e.presence }] })
      } else if (e.type === 'call') {
        this.setCall(e.call)
      } else if (e.type === 'group_call') {
        this.setGroupCall(e.chat_id, e.call, e.mine)
      } else if (e.type === 'secret') {
        void this.secrets.refresh(e.chat_id)
      } else if (this.callTab && this.call?.call_id === e.call_id) {
        this.emit({ k: 'call_signal', tab: this.callTab, call_id: e.call_id, data: e.data })
      }
    }
  }

  // ---------- 通话 ----------

  /** 记下并广播通话状态；结束后忘掉 */
  private setCall(call: Call | null) {
    // 别的通话的结束（例如忙线时对方的旧通话）与当前的无关
    if (call?.state === 'ended' && this.call && this.call.call_id !== call.call_id) return
    this.emit({ k: 'call_state', call, tab: this.callTab })
    if (!call || call.state === 'ended') {
      this.call = null
      this.callTab = null
    } else {
      this.call = call
    }
  }

  private async refreshCall() {
    const { call, group_call } = unwrap(await this.conn.request('calls.current', {}))
    // 新 Worker 第一次问过以后，没有通话也广播：换了 Worker 时，标签页等这个结果才判断通话是否已结束。
    // 之后只在原来有通话时广播，免得正在拨出（服务端还没有这个通话）时重连把它当成结束
    if (call || this.call || !this.callChecked) this.setCall(call)
    this.callChecked = true
    // 本设备的群组通话：服务端已经认领回来；不在了（断线期间超时离开）的告诉标签页
    if (group_call) {
      this.setGroupCall(group_call.chat_id, group_call, true)
      this.watchGroupCall(group_call.chat_id, group_call.call_id)
    }
    for (const [chatId, g] of this.groupCalls) if (g.mine && chatId !== group_call?.chat_id) this.setGroupCall(chatId, g.call, false)
  }

  /** 记下并广播群组通话；没有变化的不广播 */
  private setGroupCall(chatId: string, call: GroupCall | null, mine: boolean) {
    const cur = this.groupCalls.get(chatId)
    if (!call) {
      if (!cur) return
      this.groupCalls.delete(chatId)
    } else {
      if (cur && cur.mine === mine && JSON.stringify(cur.call) === JSON.stringify(call)) return
      this.groupCalls.set(chatId, { call, mine })
    }
    this.emit({ k: 'group_call', chat_id: chatId, call, mine: call !== null && mine })
  }

  async joinGroupCall({ chatId, callId }: Ops['joinGroupCall']['args']) {
    const { call, ice_servers } = unwrap(await this.conn.request('group_calls.join', { chat_id: chatId, call_id: callId }))
    this.setGroupCall(chatId, call, true)
    this.watchGroupCall(chatId, call.call_id)
    return { call, iceServers: ice_servers }
  }

  /**
   * 通话所在的标签页在通话里时持有 GROUP_CALL_LOCK。不是 Leader 的标签页崩溃或被杀时 WebSocket 不会断，
   * 服务端察觉不到：这里排队等那把锁，拿到时通话还算在本设备上，就替它离开
   */
  private watchGroupCall(chatId: string, callId: string) {
    if (this.watchingGroupCall === callId) return
    this.watchingGroupCall = callId
    void navigator.locks.request(GROUP_CALL_LOCK, async () => {
      if (this.watchingGroupCall === callId) this.watchingGroupCall = null
      const cur = this.groupCalls.get(chatId)
      if (!cur?.mine || cur.call.call_id !== callId) return
      await this.leaveGroupCall({ chatId, callId }).catch(ignoreOffline)
    })
  }

  async leaveGroupCall({ chatId, callId }: Ops['leaveGroupCall']['args']) {
    unwrap(await this.conn.request('group_calls.leave', { chat_id: chatId, call_id: callId }))
    const cur = this.groupCalls.get(chatId)
    if (cur?.mine) this.setGroupCall(chatId, cur.call, false)
    return null
  }

  async publishGroupCall({ chatId, callId, sdp, tracks }: Ops['publishGroupCall']['args']) {
    return unwrap(await this.conn.request('group_calls.publish', { chat_id: chatId, call_id: callId, sdp, tracks })).sdp
  }

  async unpublishGroupCall({ chatId, callId, sdp, slots }: Ops['unpublishGroupCall']['args']) {
    return unwrap(await this.conn.request('group_calls.unpublish', { chat_id: chatId, call_id: callId, sdp, slots })).sdp
  }

  async pullGroupCall({ chatId, callId, tracks }: Ops['pullGroupCall']['args']) {
    return unwrap(await this.conn.request('group_calls.pull', { chat_id: chatId, call_id: callId, tracks }))
  }

  async answerGroupCall({ chatId, callId, sdp }: Ops['answerGroupCall']['args']) {
    unwrap(await this.conn.request('group_calls.answer', { chat_id: chatId, call_id: callId, sdp }))
    return null
  }

  async layerGroupCall({ chatId, callId, mid, userId, rid }: Ops['layerGroupCall']['args']) {
    unwrap(await this.conn.request('group_calls.layer', { chat_id: chatId, call_id: callId, mid, user_id: userId, rid }))
    return null
  }

  async muteGroupCall({ chatId, callId, muted }: Ops['muteGroupCall']['args']) {
    unwrap(await this.conn.request('group_calls.mute', { chat_id: chatId, call_id: callId, muted }))
    return null
  }

  groupCallOf({ chatId }: Ops['groupCallOf']['args']) {
    const cur = this.groupCalls.get(chatId)
    return { call: cur?.call ?? null, mine: cur?.mine ?? false }
  }

  async startCall({ chatId, callId }: Ops['startCall']['args'], tab: string) {
    const { call, ice_servers } = unwrap(await this.conn.request('calls.start', { chat_id: chatId, call_id: callId }))
    if (call.state !== 'ended' && call.caller_id === this.me) this.callTab = tab
    this.setCall(call)
    return { call, iceServers: ice_servers }
  }

  async acceptCall({ chatId, callId }: Ops['acceptCall']['args'], tab: string) {
    // 服务端先通知主叫方再返回（还要签发 TURN 凭据），主叫方的 offer 可能先到：先记下通话所在的标签页，信令才不会被丢掉
    const prev = this.callTab
    this.callTab = tab
    try {
      const { call, ice_servers } = unwrap(await this.conn.request('calls.accept', { chat_id: chatId, call_id: callId }))
      this.setCall(call)
      return { call, iceServers: ice_servers }
    } catch (e) {
      if (this.callTab === tab) this.callTab = prev
      throw e
    }
  }

  async endCall({ chatId, callId }: Ops['endCall']['args']) {
    unwrap(await this.conn.request('calls.end', { chat_id: chatId, call_id: callId }))
    return null
  }

  async signal({ chatId, callId, data }: Ops['signal']['args']) {
    return unwrap(await this.conn.request('calls.signal', { chat_id: chatId, call_id: callId, data })).delivered
  }

  claimCall({ callId }: Ops['claimCall']['args'], tab: string) {
    if (!this.call || this.call.call_id === callId) this.callTab = tab
    return null
  }

  callState() {
    return { call: this.call, tab: this.callTab }
  }

  typing({ chatId, action }: Ops['typing']['args']) {
    const now = Date.now()
    const key = `${chatId}:${action}`
    if (!this.conn.online || now - (this.typingSentAt.get(key) ?? 0) < TYPING_THROTTLE_MS) return null
    this.typingSentAt.set(key, now)
    this.conn.request('presence.typing', { chat_id: chatId, action }).catch(ignoreOffline)
    return null
  }

  markPlayed({ chatId, seq }: Ops['markPlayed']['args']) {
    this.store.tx(() => this.store.markPlayed(chatId, seq))
    return null
  }

  /** 刷新群组的当前成员（只有成员能读） */
  private loadMembers(chatId: string): Promise<void> {
    let running = this.loadingMembers.get(chatId)
    if (!running) {
      running = (async () => {
        const { chat } = unwrap(await this.conn.request('chats.get', { chat_id: chatId }))
        this.store.tx(() => this.store.putMembers(chat))
        const ids = this.store.missingUserIds(chat.members.map((m) => m.user_id))
        if (ids.length > 0) await this.refreshProfiles(false, ids)
      })().finally(() => this.loadingMembers.delete(chatId))
      this.loadingMembers.set(chatId, running)
    }
    return running
  }

  // ---------- 已读 ----------

  read({ chatId, maxSeq }: Ops['read']['args']) {
    if (!this.store.tx(() => this.store.advanceRead(chatId, maxSeq))) return null
    this.reads.set(chatId, Math.max(maxSeq, this.reads.get(chatId) ?? 0))
    this.scheduleRead(chatId)
    return null
  }

  /** 同一会话每 READ_THROTTLE_MS 最多上报一次，窗口内取最大位置 */
  private scheduleRead(chatId: string) {
    if (this.readTimers.has(chatId)) return
    const wait = Math.max(0, (this.readSentAt.get(chatId) ?? 0) + READ_THROTTLE_MS - Date.now())
    this.readTimers.set(
      chatId,
      setTimeout(() => {
        this.readTimers.delete(chatId)
        void this.flushRead(chatId)
      }, wait),
    )
  }

  private async flushRead(chatId: string) {
    const seq = this.reads.get(chatId)
    if (seq === undefined || !this.conn.online) return
    this.reads.delete(chatId)
    this.readSentAt.set(chatId, Date.now())
    try {
      const res = await this.conn.request('messages.read', { chat_id: chatId, max_seq: seq })
      if (!res.ok) console.error('messages.read failed', res.e)
    } catch (e) {
      // 断线：放回队列，重连后再报
      if (!(e instanceof OfflineError)) throw e
      this.reads.set(chatId, Math.max(seq, this.reads.get(chatId) ?? 0))
    }
  }

  async loadOlder({ chatId, limit = PAGE_SIZE }: Ops['loadOlder']['args']) {
    const state = this.store.chatState(chatId)
    if (!state || state.min_seq <= 1) return { done: true }
    const page = unwrap(
      await this.conn.request('messages.history', {
        chat_id: chatId,
        before_seq: state.min_seq,
        limit: Math.min(limit, MAX_PAGE_LIMIT),
      }),
    )
    // 秘密聊天翻到本设备加入之前就停：再往前的都解不开
    const start = isSecret(chatId) && this.secrets.reachedJoin(chatId, page.messages) ? 1 : pageStart(page.messages)
    this.store.tx(() => {
      const cur = this.store.chatState(chatId) ?? state
      this.putMessages(chatId, page.messages)
      this.store.setChatState(chatId, { pts: cur.pts, min_seq: Math.min(cur.min_seq, start) })
    })
    return { done: start <= 1 }
  }

  /**
   * 媒体先写进 OPFS 再入队：入队后就可能开始上传。
   * 重放时已入队的消息跳过，写文件是覆盖，结果相同
   */
  send(args: Ops['send']['args']) {
    const run = this.enqueuing.then(() => this.enqueue(args))
    this.enqueuing = run.catch(() => {})
    return run
  }

  private async enqueue({ chatId, replyTo, messages }: Ops['send']['args']) {
    const rows: NewOutboxRow[] = []
    for (const [i, m] of messages.entries()) {
      const base = { random_id: m.randomId, chat_id: chatId, reply_to: i === 0 ? (replyTo ?? null) : null }
      if (this.store.outboxRow(m.randomId)) continue
      if ('text' in m) {
        // 秘密聊天不抓链接预览：抓取会把链接告诉服务端
        const link = isSecret(chatId) ? null : await stageLink(m)
        rows.push({ ...base, kind: 'text', text: m.text, entities: m.entities?.length ? m.entities : null, link })
        continue
      }
      if ('sticker' in m) {
        const { key: source, mime, w, h, size, thumbhash } = m.sticker
        const item: OutboxMedia = { type: 'sticker', source, mime, w, h, size, thumbhash }
        // 秘密聊天：取回贴纸暂存起来，发送时像其他媒体一样加密上传
        if (isSecret(chatId)) {
          const blob = await fetchSticker(source)
          await saveBlobs(m.randomId, new Map([['m0', blob]]))
          Object.assign(item, { file: 'm0', size: blob.size })
        }
        rows.push({ ...base, kind: 'media', media: [item] })
        continue
      }
      const { files, media } = stageMedia(m)
      await saveBlobs(m.randomId, files)
      rows.push({ ...base, kind: 'media', media })
    }
    this.store.tx(() => {
      this.store.addOutbox(rows)
      // 点选贴纸单独发出，不动输入框里的文字
      if (!messages.every((m) => 'sticker' in m)) this.store.discardDraft(chatId)
    })
    this.kick(chatId)
    return null
  }

  retry({ randomId }: Ops['retry']['args']) {
    const row = this.store.outboxRow(randomId)
    if (!row) return null
    this.store.tx(() => this.store.setOutboxState(row, 'pending'))
    this.kick(row.chat_id)
    return null
  }

  async discard({ randomId }: Ops['discard']['args']) {
    const row = this.store.outboxRow(randomId)
    if (!row || row.state !== 'failed') return null
    this.store.tx(() => this.store.deleteOutbox(randomId))
    await deleteBlobs(randomId)
    await deleteUploaded(row.kind === 'media' ? uploadedKeys(row.media) : linkKeys(row.link))
    return null
  }

  async releaseMedia() {
    const keys = this.store.allOutbox().flatMap((row) => (row.kind === 'media' ? uploadedKeys(row.media) : linkKeys(row.link)))
    await deleteUploaded(keys)
    return null
  }

  // ---------- 编辑、撤回与回应 ----------

  /** 结果经 upd 推回本设备，这里不写本地库 */
  async editMessage({ chatId, seq, text, entities }: Ops['editMessage']['args']) {
    if (isSecret(chatId)) {
      const cur = this.store.plainText(chatId, seq)
      if (!cur) throw new OpFailure('not_found')
      const payload: SecretPayload = { t: 'text', text, ...(cur.reply_to ? { reply_to: cur.reply_to } : {}), random_id: cur.random_id }
      await this.secretOp(() =>
        this.secretWrite(chatId, payload, { kind: 'edit', seq }, (epoch, cipher) =>
          this.conn.request('secrets.edit', { chat_id: chatId, seq, epoch, cipher }),
        ),
      )
      return null
    }
    unwrap(await this.conn.request('messages.edit', { chat_id: chatId, seq, text, entities }))
    return null
  }

  async recallMessage({ chatId, seq }: Ops['recallMessage']['args']) {
    unwrap(await this.conn.request('messages.recall', { chat_id: chatId, seq }))
    return null
  }

  /** 置顶与取消置顶：必须在线，结果经 upd 推回本设备 */
  async pinMessage({ chatId, seq, randomId }: Ops['pinMessage']['args']) {
    unwrap(await this.conn.request('messages.pin', { chat_id: chatId, random_id: randomId, seq }))
    return null
  }

  async unpinMessage({ chatId, seq }: Ops['unpinMessage']['args']) {
    unwrap(await this.conn.request('messages.unpin', { chat_id: chatId, seq }))
    return null
  }

  /** 转发：结果经 upd 推回本设备；目标还没有对话行时（第一次给这个联系人发消息）确保它已经落地 */
  async forward({ fromChatId, seq, toChatId, randomId }: Ops['forward']['args']) {
    unwrap(await this.conn.request('messages.forward', { from_chat_id: fromChatId, seq, to_chat_id: toChatId, random_id: randomId }))
    if (this.store.dialogStatus(toChatId) === null) await this.syncUser()
    return null
  }

  /** 回应同样必须在线：结果经 upd 推回本设备 */
  async react({ chatId, seq, emoji }: Ops['react']['args']) {
    if (isSecret(chatId)) {
      await this.secretOp(() => this.reactSecret(chatId, seq, emoji))
      return null
    }
    unwrap(await this.conn.request('messages.react', { chat_id: chatId, seq, emoji }))
    return null
  }

  /** 取消回应不用加密，纪元随便填 */
  private reactSecret(chatId: string, seq: number, emoji: ReactionEmoji | null) {
    if (emoji === null) {
      return this.conn.request('secrets.react', { chat_id: chatId, seq, epoch: this.store.secretGroup(chatId)?.epoch ?? 1, cipher: null })
    }
    return this.secretWrite(chatId, { emoji }, { kind: 'react', seq }, (epoch, cipher) =>
      this.conn.request('secrets.react', { chat_id: chatId, seq, epoch, cipher }),
    )
  }

  // ---------- 秘密聊天 ----------

  /**
   * 开始与 userId 的秘密聊天；已经有了就返回那个。chatId 与 randomId 由标签页生成，Leader 换了重放时不变：
   * 服务端已经有这个会话（上一次建好了、确认丢了）时不再建组，改为加入它
   */
  async startSecretChat({ userId, chatId, randomId }: Ops['startSecretChat']['args']) {
    const existing = this.store.secretChatWith(userId)
    if (existing) return existing
    const exists = await this.conn.request('secrets.state', { chat_id: chatId })
    if (exists.ok) await this.secrets.reconcile(chatId)
    else if (exists.e === 'not_found') await this.secretOp(async () => this.secrets.start(userId, chatId, randomId))
    else throw new OpFailure(toOpError(exists.e))
    if (this.store.dialogStatus(chatId) === null) await this.syncUser()
    return chatId
  }

  /** 安全码（12 组 5 位数）；本设备还没加入时为 null */
  safetyCode({ chatId }: Ops['safetyCode']['args']) {
    return this.secrets.safetyCode(chatId)
  }

  /** 秘密聊天的写操作：服务端错误与 Secrets 的错误都转成标签页看得到的 */
  private async secretOp<M extends Method>(fn: () => Promise<RpcResult<M> | void>) {
    try {
      const res = await fn()
      if (res) unwrap(res)
    } catch (e) {
      if (e instanceof SecretError) throw new OpFailure(e.code === 'not_ready' ? 'not_ready' : toOpError(e.code as ErrorCode))
      throw e
    }
  }

  // ---------- 群组 ----------

  /** 产生服务消息的写操作：结果经 upd 推回本设备，这里确保对话行已经落地 */
  private async chatWrite<M extends 'chats.create' | 'chats.addMembers' | 'chats.removeMember' | 'chats.leave' | 'chats.editTitle'>(
    method: M,
    params: MethodParams<M>,
  ) {
    unwrap(await this.conn.request(method, params))
    // user 更新可能还在等待缺口补齐：此时直接拉一次差量
    if (this.store.dialogStatus(params.chat_id) === null) await this.syncUser()
    return null
  }

  createGroup({ chatId, randomId, title, userIds }: Ops['createGroup']['args']) {
    return this.chatWrite('chats.create', { chat_id: chatId, random_id: randomId, title, user_ids: userIds })
  }

  addMembers({ chatId, randomId, userIds }: Ops['addMembers']['args']) {
    return this.chatWrite('chats.addMembers', { chat_id: chatId, random_id: randomId, user_ids: userIds })
  }

  removeMember({ chatId, randomId, userId }: Ops['removeMember']['args']) {
    return this.chatWrite('chats.removeMember', { chat_id: chatId, random_id: randomId, user_id: userId })
  }

  leaveChat({ chatId, randomId }: Ops['leaveChat']['args']) {
    return this.chatWrite('chats.leave', { chat_id: chatId, random_id: randomId })
  }

  editTitle({ chatId, randomId, title }: Ops['editTitle']['args']) {
    return this.chatWrite('chats.editTitle', { chat_id: chatId, random_id: randomId, title })
  }

  async getInvite({ chatId }: Ops['getInvite']['args']) {
    return unwrap(await this.conn.request('chats.getInvite', { chat_id: chatId })).code
  }

  async resetInvite({ chatId }: Ops['resetInvite']['args']) {
    return unwrap(await this.conn.request('chats.resetInvite', { chat_id: chatId })).code
  }

  async checkInvite({ code }: Ops['checkInvite']['args']) {
    return unwrap(await this.conn.request('chats.checkInvite', { code }))
  }

  /** 与其他群组写操作一样，确保对话行已经落地后才返回，标签页随即进入会话 */
  async joinChat({ code, randomId }: Ops['joinChat']['args']) {
    const invite = parseInviteCode(code)
    if (!invite) throw new OpFailure('not_found')
    unwrap(await this.conn.request('chats.join', { code, random_id: randomId }))
    if (this.store.dialogStatus(invite.chat_id) !== 'member') await this.syncUser()
    return null
  }

  /** 结果经 upd 推回所有设备，这里不写本地库 */
  async setSettings({ settings }: Ops['setSettings']['args']) {
    unwrap(await this.conn.request('settings.set', settings))
    return null
  }

  async deleteDialog({ chatId }: Ops['deleteDialog']['args']) {
    unwrap(await this.conn.request('dialogs.delete', { chat_id: chatId }))
    return null
  }

  /** 结果经 upd 推回所有设备，这里不写本地库 */
  async updateDialog({ chatId, pinned, mutedUntil }: Ops['updateDialog']['args']) {
    unwrap(await this.conn.request('dialogs.update', { chat_id: chatId, pinned, muted_until: mutedUntil }))
    return null
  }

  // ---------- 草稿 ----------

  saveDraft({ chatId, draft }: Ops['saveDraft']['args']) {
    if (this.store.tx(() => this.store.setDraft(chatId, draft))) void this.flushDraft(chatId)
    return null
  }

  /**
   * 把未确认的草稿同步给服务端。还没有对话行时保持未确认，等对话行出现再同步；
   * 同步期间本机又改了草稿，确认的就不是最新的，结束后再同步一次
   */
  private async flushDraft(chatId: string) {
    if (this.flushingDrafts.has(chatId) || !this.conn.online) return
    const cur = this.store.draft(chatId)
    if (!cur?.dirty) return
    const status = this.store.dialogStatus(chatId)
    // 秘密聊天的草稿只留在本设备
    if (status !== 'member' || isSecret(chatId)) return
    this.flushingDrafts.add(chatId)
    const sent: Draft | null = cur.draft
    let again = false
    try {
      const res = await this.conn.request('dialogs.update', { chat_id: chatId, draft: sent })
      if (res.ok) {
        this.store.tx(() => this.store.ackDraft(chatId, sent))
        again = this.store.draft(chatId)?.dirty === true
      } else if (res.e !== 'not_found') {
        console.error('draft sync failed', res.e)
      }
    } catch (e) {
      ignoreOffline(e)
    } finally {
      this.flushingDrafts.delete(chatId)
    }
    if (again) void this.flushDraft(chatId)
  }

  // ---------- 我的贴纸 ----------

  /** 处理好的图片先上传到待发区，再请服务端添加；贴纸消息里的直接添加。结果经 upd 推回所有设备 */
  async addSticker(args: Ops['addSticker']['args']) {
    if ('chatId' in args) {
      unwrap(await this.conn.request('stickers.add', { from: 'message', chat_id: args.chatId, seq: args.seq }))
      return null
    }
    const { file, mime, w, h, thumbhash } = args.sticker
    let key: string
    try {
      key = await uploadSticker(file, mime)
    } catch (e) {
      if (e instanceof UploadOffline) throw new OpFailure('offline')
      throw e
    }
    unwrap(await this.conn.request('stickers.add', { from: 'upload', key, w, h, size: file.size, thumbhash }))
    return null
  }

  async removeSticker({ key }: Ops['removeSticker']['args']) {
    unwrap(await this.conn.request('stickers.remove', { key }))
    return null
  }

  // ---------- 联系人与拉黑 ----------

  /** 结果经 upd 推回所有设备，这里不写本地库 */
  async setContact({ userId, alias }: Ops['setContact']['args']) {
    unwrap(await this.conn.request('contacts.set', { user_id: userId, alias }))
    return null
  }

  async removeContact({ userId }: Ops['removeContact']['args']) {
    unwrap(await this.conn.request('contacts.remove', { user_id: userId }))
    return null
  }

  async block({ userId }: Ops['block']['args']) {
    unwrap(await this.conn.request('users.block', { user_id: userId }))
    return null
  }

  async unblock({ userId }: Ops['unblock']['args']) {
    unwrap(await this.conn.request('users.unblock', { user_id: userId }))
    return null
  }

  // ---------- 设备 ----------

  async listDevices() {
    return unwrap(await this.conn.request('devices.list', {})).devices
  }

  async revokeDevice({ deviceId }: Ops['revokeDevice']['args']) {
    unwrap(await this.conn.request('devices.revoke', { device_id: deviceId }))
    return null
  }

  async revokeOtherDevices() {
    unwrap(await this.conn.request('devices.revokeOthers', {}))
    return null
  }

  // ---------- 推送 ----------

  async setPush({ subscription }: Ops['setPush']['args']) {
    this.push = subscription
    await this.reportPush()
    return null
  }

  private async reportPush() {
    if (this.push === undefined) return
    const json = JSON.stringify(this.push)
    if (json === this.sentPush) return
    unwrap(await this.conn.request('push.set', { subscription: this.push }))
    this.sentPush = json
  }

  async resolveUser({ email }: Ops['resolveUser']['args']) {
    const { user } = unwrap(await this.conn.request('users.resolve', { email }))
    this.store.tx(() => this.store.putUsers([user]))
    return user
  }

  async loadUser({ userId }: Ops['loadUser']['args']) {
    if (this.store.hasUser(userId)) return true
    const { users } = unwrap(await this.conn.request('users.get', { ids: [userId] }))
    this.store.tx(() => this.store.putUsers(users))
    return users.length > 0
  }
}

/** 把待发送的媒体拆成要写进 OPFS 的文件与发件箱里的描述：m{i} 为大图、视频或文件，p{i} 为预览图或封面 */
function stageMedia(m: Extract<OutgoingMessage, { media: unknown }>) {
  const files = new Map<string, Blob>()
  const media = m.media.map((item, i): OutboxMedia => {
    files.set(`m${i}`, item.file)
    if (item.type === 'file') return { type: 'file', file: `m${i}`, name: item.name, mime: item.mime, size: item.file.size }
    if (item.type === 'voice') {
      const { file, ...rest } = item
      return { ...rest, file: `m${i}`, size: file.size }
    }
    files.set(`p${i}`, item.preview)
    if (item.type === 'video') {
      const { file, preview, ...rest } = item
      return { ...rest, file: `m${i}`, size: file.size, preview: `p${i}`, preview_size: preview.size }
    }
    return {
      type: 'photo',
      file: `m${i}`,
      mime: item.mime,
      size: item.file.size,
      preview: `p${i}`,
      preview_mime: item.preview_mime,
      preview_size: item.preview.size,
      w: item.w,
      h: item.h,
      thumbhash: item.thumbhash,
    }
  })
  return { files, media }
}

/** 取回我的贴纸里的一张（秘密聊天里加密后另传一份）；离线时取不到 */
async function fetchSticker(key: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(`${MEDIA_ORIGIN}/${key}`, { mode: 'cors', referrerPolicy: 'no-referrer' })
  } catch {
    throw new OpFailure('offline')
  }
  if (!res.ok) throw new Error(`sticker fetch failed: ${res.status}`)
  return res.blob()
}

/** 标签页准备好的卡片图片写进 OPFS，发件箱里只记文件名 */
async function stageLink(m: Extract<OutgoingMessage, { text: string }>): Promise<OutboxLink | null> {
  if (!m.link) return null
  if (m.link.state === 'pending') return { state: 'pending' }
  const { preview, photo } = m.link
  if (!photo) return { state: 'ready', preview }
  await saveBlobs(m.randomId, new Map([[LINK_FILE, photo.blob]]))
  const { blob, ...rest } = photo
  return { state: 'ready', preview, photo: { ...rest, file: LINK_FILE, size: blob.size } }
}

function linkKeys(link: OutboxLink | null): string[] {
  return link?.state === 'ready' && link.photo?.key ? [link.photo.key] : []
}

function uploadedKeys(media: OutboxMedia[]): string[] {
  return media.flatMap((m) => [m.key, 'preview_key' in m ? m.preview_key : undefined].filter((k) => k !== undefined))
}

/** 尽力删除：失败的留给孤儿清理 */
async function deleteUploaded(keys: string[]) {
  for (let i = 0; i < keys.length; i += MAX_ALBUM_SIZE * 2) {
    try {
      await fetch('/api/media', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys.slice(i, i + MAX_ALBUM_SIZE * 2) }),
      })
    } catch {
      // 离线
    }
  }
}

function isSecret(chatId: string) {
  return parseSecretChatId(chatId) !== null
}

/** 一页历史消息的起点；不足一页说明已经到了会话开头 */
function pageStart(messages: { seq: number }[]): number {
  return messages.length < PAGE_SIZE ? 1 : messages[0]!.seq
}

function unwrap<M extends Method>(res: RpcResult<M>) {
  if (!res.ok) throw new OpFailure(toOpError(res.e), res.user_ids)
  return res.r
}

/** media_expired 只出现在发件箱的发送里，由同步 Worker 自己重新上传，不会交给标签页 */
function toOpError(e: ErrorCode): OpError {
  // stale_epoch：已经追上重试过几次仍然过期
  return e === 'unknown_method' || e === 'media_expired' || e === 'stale_epoch' ? 'internal' : e
}

function ignoreOffline(e: unknown) {
  if (e instanceof OfflineError) return
  console.error(e)
}
