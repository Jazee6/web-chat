// 秘密聊天端到端：客户端真实的 MLS 与密文格式（web/src/sync/secret）对着真实的 ChatDO / UserDO 跑一遍。
// 规则细节见 secret.test.ts（那里的 KeyPackage、Welcome 与密文都是占位的字节）
import { newSecretChatId, parseSecretChatId, type ClaimedKeyPackage, type Message } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { open, safetyCode, seal, type Binding, type SecretPayload, type SecretReaction } from '../../web/src/sync/secret/format'
import * as mls from '../../web/src/sync/secret/mls'
import { connect, createSession, createUser, eventually, randomId, type Client } from './helpers'

type State = Awaited<ReturnType<typeof mls.decodeState>>

/** 一台设备：连接、本地的 KeyPackage 私钥与 MLS 状态 */
type Device = { userId: string; c: Client; secrets: Uint8Array[]; state: State | null }

const ref = () => crypto.randomUUID().replace(/-/g, '').slice(0, 22)

async function device(userId: string): Promise<Device> {
  const c = await connect(userId, await createSession(userId))
  const kps = await Promise.all(Array.from({ length: 3 }, () => mls.newKeyPackage(userId, c.deviceId)))
  const res = await c.call('secrets.publish', {
    replace: false,
    key_packages: kps.slice(0, 2).map((k) => ({ ref: ref(), data: k.data })),
    last_resort: { ref: ref(), data: kps[2]!.data },
  })
  expect(res).toEqual({ ok: true, r: null })
  return { userId, c, secrets: kps.map((k) => k.secret), state: null }
}

async function ok<T>(p: Promise<{ ok: true; r: T } | { ok: false; e: string }>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.e)
  return res.r
}

/** 与客户端相同：领到的 KeyPackage 必须真是那台设备的 */
const genuine = (kps: ClaimedKeyPackage[]) =>
  kps.filter((k) => {
    const id = mls.keyPackageIdentity(k.key_package)
    return id?.[0] === k.user_id && id[1] === k.device_id
  })

/** 追上服务端的提交：还没加入的凭 Welcome 加入，已在组里的逐个处理 */
async function catchUp(d: Device, chatId: string) {
  const pair = parseSecretChatId(chatId)!
  const after = d.state ? mls.epochOf(d.state) : 0
  const { commits } = await ok(d.c.call('secrets.commits', { chat_id: chatId, after }))
  for (const c of commits) {
    if (!d.state) {
      if (!c.welcome) continue
      const joined = await mls.join(c.welcome, d.secrets, pair)
      expect(joined).not.toBeNull()
      d.state = joined!.state
    } else {
      d.state = await mls.apply(d.state, c.commit!)
    }
  }
}

async function sealAs(d: Device, chatId: string, plaintext: unknown, binding: Binding) {
  const state = d.state!
  const epoch = mls.epochOf(state)
  const cipher = await seal(plaintext, {
    chatId,
    senderId: d.userId,
    binding,
    epoch,
    leaf: mls.ownLeaf(state),
    key: (await mls.epochKey(state, chatId)).slice(),
    sign: (m) => mls.sign(state, m),
  })
  return { epoch, cipher }
}

async function openAs<T>(d: Device, chatId: string, cipher: string, senderId: string, binding: Binding) {
  return open<T>(cipher, {
    chatId,
    senderId,
    binding,
    key: (await mls.epochKey(d.state!, chatId)).slice(),
    leaves: mls.leavesOf(d.state!),
    verify: mls.verify,
  })
}

async function history(d: Device, chatId: string) {
  const { messages } = await ok(d.c.call('messages.history', { chat_id: chatId, limit: 50 }))
  return messages.filter((m): m is Extract<Message, { kind: 'cipher' }> => m.kind === 'cipher')
}

describe('secret chats with real MLS', () => {
  it('start, join by Welcome, add a device, exchange messages, edits and reactions, then delete', async () => {
    const a = await createUser()
    const b = await createUser()
    const a1 = await device(a.id)
    const b1 = await device(b.id)
    const chatId = newSecretChatId(a.id, b.id)
    const pair = parseSecretChatId(chatId)!

    // a1 建组并把 b1 加进来；Welcome 是真实大小的
    const prepared = genuine((await ok(a1.c.call('secrets.prepare', { user_id: b.id }))).key_packages)
    expect(prepared.map((k) => k.device_id)).toEqual([b1.c.deviceId])
    const created = await mls.create(chatId, pair, a.id, a1.c.deviceId, prepared.map((k) => k.key_package))
    a1.state = created.state
    await ok(
      a1.c.call('secrets.create', {
        chat_id: chatId,
        random_id: randomId(),
        welcome: created.welcome,
        adds: prepared.map(({ user_id, device_id }) => ({ user_id, device_id })),
      }),
    )
    await catchUp(b1, chatId)
    expect(mls.epochOf(b1.state!)).toBe(1)
    const st = await ok(a1.c.call('secrets.state', { chat_id: chatId }))
    expect(st.leaves.map((l) => l.device_id).sort()).toEqual(mls.leavesOf(b1.state!).map((l) => l.device_id).sort())

    // 消息：服务端只看到密文
    const hello: SecretPayload = { t: 'text', text: 'hello from a1', random_id: randomId() }
    const sent = await sealAs(a1, chatId, hello, { kind: 'message' })
    const { seq } = await ok(a1.c.call('secrets.send', { chat_id: chatId, random_id: randomId(), ...sent }))
    const [got] = (await history(b1, chatId)).filter((m) => m.seq === seq)
    expect(got!.cipher).not.toContain('hello')
    expect(await openAs(b1, chatId, got!.cipher, a.id, { kind: 'message' })).toEqual(hello)

    // 编辑与回应
    const edited: SecretPayload = { t: 'text', text: 'hello, edited', random_id: hello.random_id }
    await ok(a1.c.call('secrets.edit', { chat_id: chatId, seq, ...(await sealAs(a1, chatId, edited, { kind: 'edit', seq })) }))
    const like: SecretReaction = { emoji: '👍' }
    await ok(b1.c.call('secrets.react', { chat_id: chatId, seq, ...(await sealAs(b1, chatId, like, { kind: 'react', seq })) }))
    const [after] = (await history(a1, chatId)).filter((m) => m.seq === seq)
    expect(after!.edit_date).toBeDefined()
    expect(await openAs(a1, chatId, after!.cipher, a.id, { kind: 'edit', seq })).toEqual(edited)
    expect(await openAs(a1, chatId, after!.reactions![b.id]!, b.id, { kind: 'react', seq })).toEqual(like)

    // a 的第二台设备上线：b1 照服务端的设备列表替它提交，a1 处理提交，a2 凭 Welcome 加入
    const a2 = await device(a.id)
    const before = await safetyCode(mls.leavesOf(b1.state!))
    const st2 = await ok(b1.c.call('secrets.state', { chat_id: chatId }))
    const inGroup = new Set(st2.leaves.map((l) => l.device_id))
    const wanted = Object.entries(st2.devices).flatMap(([user_id, ids]) => ids.filter((id) => !inGroup.has(id)).map((device_id) => ({ user_id, device_id })))
    expect(wanted).toEqual([{ user_id: a.id, device_id: a2.c.deviceId }])
    const claimed = genuine((await ok(b1.c.call('secrets.claim', { chat_id: chatId, devices: wanted }))).key_packages)
    const next = await mls.commit(b1.state!, claimed.map((k) => k.key_package), [])
    await ok(b1.c.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: next.commit, welcome: next.welcome!, adds: wanted, removes: [] }))
    b1.state = next.state
    await catchUp(a1, chatId)
    await catchUp(a2, chatId)
    expect([a1, b1, a2].map((d) => mls.epochOf(d.state!))).toEqual([2, 2, 2])
    const codes = await Promise.all([a1, b1, a2].map((d) => safetyCode(mls.leavesOf(d.state!))))
    expect(codes[0]).toEqual(codes[1])
    expect(codes[2]).toEqual(codes[1])
    expect(codes[0]).not.toEqual(before)
    await eventually(async () => expect((await ok(b1.c.call('messages.history', { chat_id: chatId, limit: 50 }))).messages.some((m) => m.kind === 'service')).toBe(true))

    // 还用旧纪元加密的被拒绝；用新纪元的双方的设备都解得开
    const stale = await sealAs({ ...a1, state: created.state }, chatId, hello, { kind: 'message' })
    expect(await a1.c.call('secrets.send', { chat_id: chatId, random_id: randomId(), ...stale })).toEqual({ ok: false, e: 'stale_epoch' })
    const laptop: SecretPayload = { t: 'text', text: 'from a2', random_id: randomId() }
    const second = await ok(a2.c.call('secrets.send', { chat_id: chatId, random_id: randomId(), ...(await sealAs(a2, chatId, laptop, { kind: 'message' })) }))
    for (const d of [a1, b1]) {
      const [m] = (await history(d, chatId)).filter((x) => x.seq === second.seq)
      expect(await openAs(d, chatId, m!.cipher, a.id, { kind: 'message' })).toEqual(laptop)
    }
    // 冒充对方发送者的验证不过
    const [forged] = (await history(b1, chatId)).filter((x) => x.seq === second.seq)
    expect(await openAs(b1, chatId, forged!.cipher, b.id, { kind: 'message' })).toBeNull()

    // 删除对双方生效
    await ok(b1.c.call('dialogs.delete', { chat_id: chatId }))
    expect(await a1.c.call('secrets.state', { chat_id: chatId })).toMatchObject({ ok: false })
  })
})
