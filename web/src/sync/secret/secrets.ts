// 秘密聊天在同步 Worker 里的部分：本设备的 KeyPackage、加入与追上提交、替对方或自己的设备提交加入与移除，
// 消息与回应的加解密。见 docs/adr/0010-secret-chats-multi-device-mls.md
import * as v from 'valibot'
import {
  KEY_PACKAGES_PER_DEVICE,
  REACTIONS,
  SecretPayload as SecretPayloadSchema,
  parseSecretChatId,
  randomToken,
  summarizeMedia,
  type DialogPreview,
  type Message,
  type Method,
  type MethodResults,
  type methodParams,
  type Reactions,
} from 'shared/protocol'
import { OfflineError, type Connection, type RpcResult } from '../connection'
import type { Store } from '../store'
import { header, open, safetyCode, seal, type Binding, type Leaf, type SecretPayload, type SecretReaction } from './format'
import { unwrap, wrap } from './wrap'

type Mls = typeof import('./mls')
type ClientState = Awaited<ReturnType<Mls['decodeState']>>

let mlsModule: Promise<Mls> | null = null
/** ts-mls 只在用到秘密聊天时才加载 */
const mls = () => (mlsModule ??= import('./mls'))

/** 提交被别的设备抢先时，追上之后重来几次 */
const COMMIT_ATTEMPTS = 3
/** 一轮最多解开多少条消息 */
const UNSEAL_BATCH = 200

/** 秘密聊天的服务端错误，由引擎转换成标签页看得到的错误 */
export class SecretError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

type Plain = Extract<Message, { kind: 'text' | 'media' }>

export type SecretHooks = {
  /** 本设备加入了某个秘密聊天（或进入了新纪元）：发件箱可以发了 */
  onReady: (chatId: string) => void
  /** 解开的消息回复了这些消息：本地没有的要拉取 */
  onReplies: (chatId: string, seqs: number[]) => void
}

export class Secrets {
  /** 本设备的 ID（= better-auth session.id），连上后由 secrets.keys 告知；KeyPackage 补齐之后才设上 */
  private deviceId: string | null = null
  /** 正在补齐 KeyPackage：同一时间只有一轮，避免两轮各自 replace，服务端与本地的私钥对不上 */
  private keying: Promise<void> | null = null
  /** 同一个会话的 MLS 操作串行进行 */
  private chains = new Map<string, Promise<unknown>>()
  /** 纪元密钥与组里的设备，解开后缓存在内存里：`${chat_id}:${epoch}` */
  private epochs = new Map<string, { key: Uint8Array<ArrayBuffer>; leaves: Leaf[] }>()
  private unsealing: Promise<void> | null = null
  private unsealAgain = false
  /** 解开时缺纪元密钥、已经为它检查过的会话：进入新纪元或有新的提交之前不再重复检查 */
  private waiting = new Set<string>()

  private readonly store: Store
  private readonly conn: Connection
  private readonly me: string
  private readonly hooks: SecretHooks

  constructor(store: Store, conn: Connection, me: string, hooks: SecretHooks) {
    this.store = store
    this.conn = conn
    this.me = me
    this.hooks = hooks
  }

  private async request<M extends Method>(m: M, p: v.InferInput<(typeof methodParams)[M]>): Promise<MethodResults[M]> {
    const res: RpcResult<M> = await this.conn.request(m, p)
    if (!res.ok) throw new SecretError(res.e)
    return res.r
  }

  private exclusive<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(chatId) ?? Promise.resolve()
    const run = prev.catch(() => {}).then(fn)
    const tail = run.catch(() => {})
    this.chains.set(chatId, tail)
    void tail.then(() => {
      if (this.chains.get(chatId) === tail) this.chains.delete(chatId)
    })
    return run
  }

  private pairOf(chatId: string): [string, string] {
    const pair = parseSecretChatId(chatId)
    if (!pair) throw new Error(`not a secret chat: ${chatId}`)
    return pair
  }

  // ---------- 连接 ----------

  /** 连上后：补齐本设备的 KeyPackage，再检查每个秘密聊天 */
  async onOpen() {
    this.deviceId = null
    await this.checkWrapKey()
    await this.ensureKeys()
    await Promise.all(this.store.secretChats().map((chatId) => this.reconcile(chatId)))
    this.unseal()
  }

  /**
   * 包装密钥在 IndexedDB 里，可能单独丢失而本地库还在：那样本地的密钥材料一个都解不开。
   * 全部忘掉，之后像丢了本地数据一样换掉 KeyPackage、作为新设备重新加入
   */
  private async checkWrapKey() {
    const sample = this.store.secretKeys()[0]?.private
    if (!sample) return
    try {
      await unwrap(sample)
    } catch (e) {
      // 其他错误（例如 IndexedDB 打不开）不能说明密钥丢了
      if (!(e instanceof DOMException) || e.name !== 'OperationError') return
      this.epochs.clear()
      this.store.tx(() => this.store.forgetSecrets())
    }
  }

  /**
   * 服务端一次性的 KeyPackage 不足一半时补齐，没有最后备用的补一个。
   * 本地一个私钥都没有、服务端却还有（本地数据丢了）时整个换掉，之前的已经没法用了
   */
  private ensureKeys(): Promise<void> {
    this.keying ??= this.publishKeys().finally(() => {
      this.keying = null
    })
    return this.keying
  }

  private async publishKeys() {
    const r = await this.request('secrets.keys', {})
    const local = this.store.secretKeys()
    const replace = local.length === 0 && (r.count > 0 || r.last_resort)
    const count = replace ? 0 : r.count
    const fresh = count < KEY_PACKAGES_PER_DEVICE / 2 ? KEY_PACKAGES_PER_DEVICE - count : 0
    const needLast = replace || !r.last_resort || !local.some((k) => k.last_resort === 1)
    if (fresh === 0 && !needLast) {
      this.deviceId = r.device_id
      return
    }
    const m = await mls()
    const make = async (lastResort: boolean) => {
      const kp = await m.newKeyPackage(this.me, r.device_id)
      return { ref: randomToken(), data: kp.data, private: await wrap(kp.secret), last_resort: lastResort }
    }
    const oneTime = await Promise.all(Array.from({ length: fresh }, () => make(false)))
    const last = needLast ? await make(true) : null
    // 先存私钥再上传：上传了却没存下的私钥会让加入失败，反过来只是多存了几个用不上的
    this.store.tx(() => this.store.putSecretKeys([...oneTime, ...(last ? [last] : [])], replace))
    await this.request('secrets.publish', {
      replace,
      key_packages: oneTime.map((k) => ({ ref: k.ref, data: k.data })),
      ...(last ? { last_resort: { ref: last.ref, data: last.data } } : {}),
    })
    this.deviceId = r.device_id
  }

  // ---------- 成员 ----------

  /** 加入、追上提交，再替双方的设备变化提交；任何一步失败都留给下一次（连接、推送的 secret 事件、打开会话） */
  reconcile(chatId: string): Promise<void> {
    return this.exclusive(chatId, async () => {
      try {
        if (!this.deviceId) await this.ensureKeys()
        let joined = this.store.secretGroup(chatId) !== null
        if (!joined) joined = await this.join(chatId)
        if (!joined) return
        if (!(await this.catchUp(chatId))) {
          // 本设备被移出了组（被当成丢了状态的设备重新加入）：凭新的 Welcome 再加入
          if (!(await this.join(chatId))) return
          await this.catchUp(chatId)
        }
        await this.maintain(chatId)
        this.hooks.onReady(chatId)
      } catch (e) {
        // 还没连上（打开页面时的检查）的留给连上后的那次
        const expected = e instanceof OfflineError || (e instanceof SecretError && e.code === 'not_found')
        if (!expected) console.error('secret reconcile failed', chatId, e)
      } finally {
        this.unseal()
      }
    })
  }

  /**
   * 凭 Welcome 加入：只有本设备在组里时才有加入它的提交。在组里却加入不了（本地的私钥丢了）时，请成员把它重新加入
   */
  private async join(chatId: string): Promise<boolean> {
    const state = await this.request('secrets.state', { chat_id: chatId })
    if (!state.leaves.some((l) => l.device_id === this.deviceId)) return false
    let welcome: { epoch: number; welcome?: string } | null = null
    for (let after = 0; ; ) {
      const { commits } = await this.request('secrets.commits', { chat_id: chatId, after })
      for (const c of commits) if (c.welcome) welcome = c
      if (commits.length < 100) break
      after = commits.at(-1)!.epoch
    }
    const keys = this.store.secretKeys()
    const m = await mls()
    const pair = this.pairOf(chatId)
    const joined = welcome
      ? await m.join(welcome.welcome!, await Promise.all(keys.map((k) => unwrap(k.private))), pair).catch(() => null)
      : null
    if (!joined || m.epochOf(joined.state) !== welcome!.epoch) {
      await this.request('secrets.reset', { chat_id: chatId })
      return false
    }
    const used = keys[joined.used]!
    await this.enter(chatId, joined.state, m.epochOf(joined.state))
    this.store.tx(() => this.store.deleteSecretKey(used.ref))
    return true
  }

  /** 进入一个纪元：存下（包了一层的）MLS 状态、这个纪元的密钥与组里的设备 */
  private async enter(chatId: string, state: ClientState, joinEpoch?: number) {
    const m = await mls()
    const epoch = m.epochOf(state)
    const key = (await m.epochKey(state, chatId)).slice()
    const leaves = m.leavesOf(state)
    const [wrappedState, wrappedKey] = await Promise.all([wrap(m.encodeState(state)), wrap(key)])
    const join = joinEpoch ?? this.store.secretGroup(chatId)?.join_epoch ?? epoch
    this.epochs.set(`${chatId}:${epoch}`, { key, leaves })
    this.waiting.delete(chatId)
    this.store.tx(() => this.store.putSecretEpoch(chatId, epoch, join, wrappedState, wrappedKey, JSON.stringify(leaves)))
  }

  private async loadState(chatId: string): Promise<ClientState | null> {
    const group = this.store.secretGroup(chatId)
    if (!group) return null
    return (await mls()).decodeState(await unwrap(group.state), this.pairOf(chatId))
  }

  /** 按纪元处理之后的提交；本设备被移出时忘掉组并返回 false */
  private async catchUp(chatId: string): Promise<boolean> {
    const m = await mls()
    for (;;) {
      let state = await this.loadState(chatId)
      if (!state) return false
      const { commits } = await this.request('secrets.commits', { chat_id: chatId, after: m.epochOf(state) })
      for (const c of commits) {
        if (c.removes.includes(this.deviceId!)) {
          this.store.tx(() => this.store.dropSecretGroup(chatId))
          return false
        }
        try {
          state = await m.apply(state, c.commit!)
        } catch (e) {
          // 处理不了（例如本设备自己的提交成功了、确认却丢了，新状态没存下）：只能请成员把本设备重新加入
          console.error('secret commit failed', chatId, c.epoch, e)
          this.store.tx(() => this.store.dropSecretGroup(chatId))
          await this.request('secrets.reset', { chat_id: chatId })
          return false
        }
        await this.enter(chatId, state)
      }
      if (commits.length < 100) return true
    }
  }

  /**
   * 组里的设备与双方现有的设备不一致、或有设备要重新加入时，替它们提交：领到 KeyPackage 的加入，已经不在的移除。
   * 别的设备抢先提交时（stale_epoch）追上后重来
   */
  private async maintain(chatId: string) {
    const m = await mls()
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
      const st = await this.request('secrets.state', { chat_id: chatId })
      const state = await this.loadState(chatId)
      if (!state || m.epochOf(state) !== st.epoch) {
        if (!(await this.catchUp(chatId))) return
        continue
      }
      const inGroup = new Set(st.leaves.map((l) => l.device_id))
      const wanted = Object.entries(st.devices).flatMap(([user_id, ids]) =>
        ids.filter((id) => !inGroup.has(id) || st.resets.includes(id)).map((device_id) => ({ user_id, device_id })),
      )
      const gone = st.leaves.filter(
        (l) => l.device_id !== this.deviceId && (st.resets.includes(l.device_id) || !(st.devices[l.user_id] ?? []).includes(l.device_id)),
      )
      if (wanted.length === 0 && gone.length === 0) return

      let claimed: MethodResults['secrets.claim']['key_packages'] = []
      if (wanted.length > 0) {
        claimed = (await this.request('secrets.claim', { chat_id: chatId, devices: wanted })).key_packages
        // 领到的 KeyPackage 必须真是那台设备的
        claimed = claimed.filter((k) => {
          const id = m.keyPackageIdentity(k.key_package)
          return id?.[0] === k.user_id && id[1] === k.device_id
        })
      }
      // 重新加入的设备领不到 KeyPackage 时只移除它，等它上传了新的再加
      if (claimed.length === 0 && gone.length === 0) return
      const leaves = m.leavesOf(state)
      const removes = gone.flatMap((g) => leaves.filter((l) => l.device_id === g.device_id && l.user_id === g.user_id).map((l) => l.index))
      const next = await m.commit(
        state,
        claimed.map((k) => k.key_package),
        removes,
      )
      try {
        await this.request('secrets.commit', {
          chat_id: chatId,
          epoch: st.epoch + 1,
          commit: next.commit,
          ...(next.welcome ? { welcome: next.welcome } : {}),
          adds: claimed.map(({ user_id, device_id }) => ({ user_id, device_id })),
          removes: gone.map((g) => g.device_id),
        })
      } catch (e) {
        if (e instanceof SecretError && e.code === 'stale_epoch') {
          if (!(await this.catchUp(chatId))) return
          continue
        }
        throw e
      }
      await this.enter(chatId, next.state)
      return
    }
  }

  // ---------- 开始与安全码 ----------

  /** 开始秘密聊天：领取对方与自己其他设备的 KeyPackage，建组，把 Welcome 交给服务端；返回会话 ID */
  start(peerId: string, chatId: string, randomId: number): Promise<void> {
    // 整个过程占着这个会话：自己的设备收到新对话行时的 reconcile 排在后面，那时本设备已经在组里
    return this.exclusive(chatId, () => this.create(peerId, chatId, randomId))
  }

  private async create(peerId: string, chatId: string, randomId: number) {
    if (!this.deviceId) await this.ensureKeys()
    const { key_packages } = await this.request('secrets.prepare', { user_id: peerId })
    const m = await mls()
    const valid = key_packages.filter((k) => {
      const id = m.keyPackageIdentity(k.key_package)
      return id?.[0] === k.user_id && id[1] === k.device_id
    })
    const pair = this.pairOf(chatId)
    const { state, welcome } = await m.create(chatId, pair, this.me, this.deviceId!, valid.map((k) => k.key_package))
    await this.request('secrets.create', {
      chat_id: chatId,
      random_id: randomId,
      welcome,
      adds: valid.map(({ user_id, device_id }) => ({ user_id, device_id })),
    })
    await this.enter(chatId, state, 1)
  }

  /** 当前纪元的安全码；本设备还没加入时为 null */
  async safetyCode(chatId: string): Promise<string[] | null> {
    const group = this.store.secretGroup(chatId)
    if (!group) return null
    const cur = await this.epoch(chatId, group.epoch)
    return cur ? safetyCode(cur.leaves) : null
  }

  // ---------- 加解密 ----------

  private async epoch(chatId: string, epoch: number) {
    const cached = this.epochs.get(`${chatId}:${epoch}`)
    if (cached) return cached
    const row = this.store.secretEpoch(chatId, epoch)
    if (!row) return null
    const loaded = { key: await unwrap(row.key), leaves: JSON.parse(row.leaves) as Leaf[] }
    this.epochs.set(`${chatId}:${epoch}`, loaded)
    return loaded
  }

  /** 这一页里有本设备加入之前、解不开的密文：再往前翻也都解不开 */
  reachedJoin(chatId: string, messages: Message[]): boolean {
    const group = this.store.secretGroup(chatId)
    if (!group) return false
    return messages.some((m) => {
      if (m.kind !== 'cipher') return false
      const epoch = header(m.cipher)?.epoch ?? 0
      return epoch < group.join_epoch && !this.store.secretEpoch(chatId, epoch)
    })
  }

  /** 本设备是否已经加入，可以发消息 */
  ready(chatId: string): boolean {
    return this.store.secretGroup(chatId) !== null
  }

  /** 用当前纪元加密；本设备还没加入时抛出 not_ready */
  encrypt(chatId: string, plaintext: SecretPayload | SecretReaction, binding: Binding): Promise<{ epoch: number; cipher: string }> {
    return this.exclusive(chatId, async () => {
      const state = await this.loadState(chatId)
      if (!state) throw new SecretError('not_ready')
      const m = await mls()
      const epoch = m.epochOf(state)
      const cur = await this.epoch(chatId, epoch)
      if (!cur) throw new SecretError('not_ready')
      const cipher = await seal(plaintext, {
        chatId,
        senderId: this.me,
        binding,
        epoch,
        leaf: m.ownLeaf(state),
        key: cur.key,
        sign: (message) => m.sign(state, message),
      })
      return { epoch, cipher }
    })
  }

  /** 有了新的提交或设备变化（推送的 secret 事件、服务端说纪元不对、打开会话）：重新检查，解不开的也再试一次 */
  refresh(chatId: string): Promise<void> {
    this.waiting.delete(chatId)
    return this.reconcile(chatId)
  }

  /** 解开一条消息（或编辑）的密文，内容不合格的也算验证失败 */
  private async decryptPayload(chatId: string, senderId: string, cipher: string, binding: Binding): Promise<SecretPayload | 'pending' | 'sealed' | null> {
    const payload = await this.decrypt<unknown>(chatId, senderId, cipher, binding)
    if (payload === 'pending' || payload === 'sealed' || payload === null) return payload
    const parsed = v.safeParse(SecretPayloadSchema, payload)
    return parsed.success ? parsed.output : null
  }

  /**
   * 解开一条密文：pending 为还解不开（还没加入，或缺之后纪元的提交），sealed 为本设备加入之前的，null 为验证失败
   */
  private async decrypt<T>(chatId: string, senderId: string, cipher: string, binding: Binding): Promise<T | 'pending' | 'sealed' | null> {
    const head = header(cipher)
    if (!head) return null
    const group = this.store.secretGroup(chatId)
    const cur = await this.epoch(chatId, head.epoch)
    if (!cur) {
      if (group && head.epoch < group.join_epoch) return 'sealed'
      return 'pending'
    }
    const m = await mls()
    const plain = await open<T>(cipher, { chatId, senderId, binding, key: cur.key, leaves: cur.leaves, verify: m.verify })
    // 内容总是对象：解出字符串的（例如 "pending"）不能和上面的状态混淆
    return typeof plain === 'object' ? plain : null
  }

  /** 解开还没解开的消息与对话摘要；同一时间只跑一轮，期间又有新的就再跑一轮 */
  unseal() {
    if (this.unsealing) {
      this.unsealAgain = true
      return
    }
    this.unsealing = this.unsealPass()
      .catch((e: unknown) => console.error('unseal failed', e))
      .finally(() => {
        this.unsealing = null
        if (this.unsealAgain) {
          this.unsealAgain = false
          this.unseal()
        }
      })
  }

  private async unsealPass() {
    const rows = this.store.cipherRows(UNSEAL_BATCH)
    const pending = new Set<string>()
    const replies = new Map<string, number[]>()
    let progress = false
    for (const row of rows) {
      if (pending.has(row.chat_id)) continue
      const binding: Binding = row.edit_date !== null ? { kind: 'edit', seq: row.seq } : { kind: 'message' }
      const payload = await this.decryptPayload(row.chat_id, row.sender_id, row.cipher, binding)
      if (payload === 'pending') {
        pending.add(row.chat_id)
        continue
      }
      progress = true
      if (payload === 'sealed' || payload === null) {
        this.store.tx(() => this.store.putPlain(row.chat_id, row.seq, row.pts, { kind: payload === 'sealed' ? 'sealed' : 'broken' }, null))
        continue
      }
      // 同一条密文被复制成了另一条消息：后来的那条当作验证失败
      if (this.store.duplicateRandomId(row.chat_id, row.seq, row.sender_id, payload.random_id)) {
        this.store.tx(() => this.store.putPlain(row.chat_id, row.seq, row.pts, { kind: 'broken' }, null))
        continue
      }
      const reactions = await this.reactions(row.chat_id, row.seq, row.reactions)
      const body = toPlain(row.chat_id, row.seq, row.pts, row.sender_id, payload, reactions)
      this.store.tx(() => this.store.putPlain(row.chat_id, row.seq, row.pts, body, payload.random_id))
      if (payload.reply_to) replies.set(row.chat_id, [...(replies.get(row.chat_id) ?? []), payload.reply_to])
    }
    for (const [chatId, seqs] of replies) this.hooks.onReplies(chatId, seqs)
    for (const p of this.store.cipherPreviews()) {
      if (pending.has(p.chat_id)) continue
      let payload = await this.decryptPayload(p.chat_id, p.top_sender_id, p.top_text, { kind: 'message' })
      if (payload === null) payload = await this.decryptPayload(p.chat_id, p.top_sender_id, p.top_text, { kind: 'edit', seq: p.top_seq })
      if (payload === 'pending') {
        pending.add(p.chat_id)
        continue
      }
      progress = true
      const preview: DialogPreview | null =
        payload === 'sealed' || payload === null
          ? null
          : payload.t === 'text'
            ? { sender_id: p.top_sender_id, date: 0, kind: 'text', text: payload.text.slice(0, 100) }
            : { sender_id: p.top_sender_id, date: 0, ...summarizeMedia(payload.media) }
      this.store.tx(() => this.store.putPlainPreview(p.chat_id, p.pts, preview))
    }
    // 缺提交的会话：追上之后会再解一轮；同一个会话不重复触发
    for (const chatId of pending) {
      if (this.waiting.has(chatId)) continue
      this.waiting.add(chatId)
      void this.reconcile(chatId)
    }
    if (progress && rows.length === UNSEAL_BATCH) this.unsealAgain = true
  }

  /** 每人一条加密的回应：解不开的略过；按 REACTIONS 的顺序 */
  private async reactions(chatId: string, seq: number, sealed: Record<string, string> | null): Promise<Reactions | undefined> {
    if (!sealed) return undefined
    const out: Reactions = {}
    for (const [userId, cipher] of Object.entries(sealed)) {
      const r = await this.decrypt<SecretReaction>(chatId, userId, cipher, { kind: 'react', seq })
      if (r === null || typeof r !== 'object' || !REACTIONS.includes(r.emoji)) continue
      ;(out[r.emoji] ??= []).push(userId)
    }
    const ordered: Reactions = {}
    for (const e of REACTIONS) if (out[e]) ordered[e] = out[e]
    return Object.keys(ordered).length > 0 ? ordered : undefined
  }
}

function toPlain(chatId: string, seq: number, pts: number, senderId: string, p: SecretPayload, reactions: Reactions | undefined): Plain {
  const base = { chat_id: chatId, seq, pts, sender_id: senderId, date: 0 }
  const extra = { ...(p.reply_to ? { reply_to: p.reply_to } : {}), ...(reactions ? { reactions } : {}) }
  return p.t === 'text' ? { ...base, kind: 'text', text: p.text, ...extra } : { ...base, kind: 'media', media: p.media, ...extra }
}
