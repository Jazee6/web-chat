import { env, SELF } from 'cloudflare:test'
import { newSecretChatId, sentKey, type Message, type SecretDevice, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createSession, createUser, eventually, inChat, login, randomId, userWrites, type Client } from './helpers'

const b64 = (s: string) => btoa(s)
const kp = (tag: string) => ({ ref: crypto.randomUUID().replace(/-/g, '').slice(0, 22), data: b64(`kp-${tag}`) })
const newMessages = (updates: Update[]): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))
const changed = (updates: Update[]): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'update_message' ? [u.ev.message] : []))
const dialogOf = (updates: Update[], chatId: string) =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

/** 一台登录了（D1 里有 session）并上传了 KeyPackage 的设备 */
async function device(userId: string, keys = 2, sessionId?: string): Promise<Client> {
  const c = await connect(userId, sessionId ?? (await createSession(userId)))
  const res = await c.call('secrets.publish', {
    replace: false,
    key_packages: Array.from({ length: keys }, (_, i) => kp(`${c.deviceId}-${i}`)),
    last_resort: kp(`${c.deviceId}-last`),
  })
  expect(res).toEqual({ ok: true, r: null })
  return c
}

/** a 有两台设备，b 有一台；a1 开始秘密聊天 */
async function secretPair() {
  const a = await createUser()
  const b = await createUser()
  const a1 = await device(a.id)
  const a2 = await device(a.id)
  const b1 = await device(b.id)
  const prepared = await a1.call('secrets.prepare', { user_id: b.id })
  if (!prepared.ok) throw new Error(prepared.e)
  const adds: SecretDevice[] = prepared.r.key_packages.map(({ user_id, device_id }) => ({ user_id, device_id }))
  const chatId = newSecretChatId(a.id, b.id)
  const created = await a1.call('secrets.create', { chat_id: chatId, random_id: randomId(), welcome: b64('welcome-1'), adds })
  expect(created).toMatchObject({ ok: true, r: { seq: 1 } })
  await eventually(() => expect(dialogOf(b1.updates, chatId)).toBeDefined())
  return { a, b, a1, a2, b1, chatId }
}

describe('secrets.publish / keys / prepare', () => {
  it('KeyPackage 每个 1 行；领取时一次性的删掉，用完后反复给最后备用的', async () => {
    const a = await createUser()
    const b = await createUser()
    const a1 = await device(a.id, 0)
    const b1 = await connect(b.id, await createSession(b.id))
    const before = await userWrites(b.id)
    await b1.call('secrets.publish', { replace: false, key_packages: [kp('1')], last_resort: kp('last') })
    expect((await userWrites(b.id)) - before).toBe(2)
    expect(await b1.call('secrets.keys', {})).toEqual({ ok: true, r: { count: 1, last_resort: true, device_id: b1.deviceId } })

    const first = await a1.call('secrets.prepare', { user_id: b.id })
    expect(first).toEqual({ ok: true, r: { key_packages: [{ user_id: b.id, device_id: b1.deviceId, key_package: b64('kp-1') }] } })
    expect(await b1.call('secrets.keys', {})).toEqual({ ok: true, r: { count: 0, last_resort: true, device_id: b1.deviceId } })
    for (let i = 0; i < 2; i++) {
      const again = await a1.call('secrets.prepare', { user_id: b.id })
      expect(again.ok && again.r.key_packages.map((k) => k.key_package)).toEqual([b64('kp-last')])
    }
  })

  it('对方没有设备上传过时 no_keys；拉黑时 blocked；不能对自己', async () => {
    const a = await createUser()
    const b = await createUser()
    const a1 = await device(a.id)
    expect(await a1.call('secrets.prepare', { user_id: b.id })).toEqual({ ok: false, e: 'no_keys' })
    expect(await a1.call('secrets.prepare', { user_id: a.id })).toEqual({ ok: false, e: 'bad_request' })
    const b1 = await device(b.id)
    await b1.call('users.block', { user_id: a.id })
    expect(await a1.call('secrets.prepare', { user_id: b.id })).toEqual({ ok: false, e: 'blocked' })
    await b1.call('users.unblock', { user_id: a.id })
    await a1.call('users.block', { user_id: b.id })
    expect(await a1.call('secrets.prepare', { user_id: b.id })).toEqual({ ok: false, e: 'blocked' })
  })

  it('session 已失效的设备不算，顺带删掉它的 KeyPackage', async () => {
    const a = await createUser()
    const b = await createUser()
    const a1 = await device(a.id)
    const expired = await createSession(b.id, { expiresAt: Date.now() - 1000 })
    const old = await connect(b.id, expired)
    await old.call('secrets.publish', { replace: false, key_packages: [kp('x')], last_resort: kp('y') })
    const b1 = await device(b.id)
    const res = await a1.call('secrets.prepare', { user_id: b.id })
    expect(res.ok && res.r.key_packages.map((k) => k.device_id)).toEqual([b1.deviceId])
    expect(await old.call('secrets.keys', {})).toEqual({ ok: true, r: { count: 0, last_resort: false, device_id: old.deviceId } })
  })
})

describe('secrets.create', () => {
  it('双方都有了对话与开始的服务消息；领到的是对方与自己其他设备的 KeyPackage；只有被加入的设备拿得到 Welcome', async () => {
    const { a, b, a1, a2, b1, chatId } = await secretPair()
    expect(dialogOf(b1.updates, chatId)).toMatchObject({ kind: 'secret', title: null, top_seq: 1, last_read_seq: 0 })
    expect(dialogOf(a1.updates, chatId)).toMatchObject({ kind: 'secret', top_seq: 1, last_read_seq: 1 })
    expect(newMessages(b1.updates)).toMatchObject([{ seq: 1, sender_id: a.id, kind: 'service', action: { type: 'secret_create' } }])

    const state = await b1.call('secrets.state', { chat_id: chatId })
    expect(state.ok && state.r.epoch).toBe(1)
    expect(state.ok && state.r.leaves.map((l) => l.device_id).sort()).toEqual([a1.deviceId, a2.deviceId, b1.deviceId].sort())
    expect(state.ok && state.r.devices).toEqual({ [a.id]: [a1.deviceId, a2.deviceId].sort(), [b.id]: [b1.deviceId] })

    const forB = await b1.call('secrets.commits', { chat_id: chatId, after: 0 })
    expect(forB).toMatchObject({ ok: true, r: { commits: [{ epoch: 1, sender_id: a.id, device_id: a1.deviceId, commit: null, welcome: b64('welcome-1') }] } })
    const forA1 = await a1.call('secrets.commits', { chat_id: chatId, after: 0 })
    expect(forA1.ok && forA1.r.commits[0]).not.toHaveProperty('welcome')
    expect(await b1.call('secrets.commits', { chat_id: chatId, after: 1 })).toEqual({ ok: true, r: { commits: [] } })
  })

  it('同一时间最多一个：已有秘密聊天时 prepare 与另开一个都失败；重放 create 返回第一次的结果', async () => {
    const { b, a1, chatId } = await secretPair()
    expect(await a1.call('secrets.prepare', { user_id: b.id })).toEqual({ ok: false, e: 'bad_request' })
    const other = newSecretChatId(a1.deviceId < b.id ? 'x' : 'y', b.id)
    expect((await a1.call('secrets.create', { chat_id: other, random_id: randomId(), welcome: b64('w'), adds: [] })).ok).toBe(false)
    const dialog = dialogOf(a1.updates, chatId)!
    expect(dialog.top_seq).toBe(1)
  })

  it('不是自己的 ID、对方拉黑了自己时失败，不写任何行', async () => {
    const a = await createUser()
    const b = await createUser()
    const c = await createUser()
    const a1 = await device(a.id)
    const b1 = await device(b.id)
    expect(await a1.call('secrets.create', { chat_id: newSecretChatId(b.id, c.id), random_id: 1, welcome: b64('w'), adds: [] })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    await b1.call('users.block', { user_id: a.id })
    const chatId = newSecretChatId(a.id, b.id)
    const before = await chatWrites(chatId)
    expect(await a1.call('secrets.create', { chat_id: chatId, random_id: 1, welcome: b64('w'), adds: [] })).toEqual({ ok: false, e: 'blocked' })
    expect(await chatWrites(chatId)).toBe(before)
  })
})

describe('secrets.send / edit / react / recall', () => {
  it('发送密文：ChatDO 写 2 行，对方对话行 1 行；摘要就是密文；纪元不对时 stale_epoch', async () => {
    const { a, b, a1, b1, chatId } = await secretPair()
    const before = { chat: await chatWrites(chatId), b: await userWrites(b.id) }
    const sent = await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('hello') })
    expect(sent).toMatchObject({ ok: true, r: { seq: 2 } })
    await eventually(() => expect(newMessages(b1.updates)).toHaveLength(2))
    expect(newMessages(b1.updates)[1]).toEqual({ chat_id: chatId, seq: 2, pts: 2, sender_id: a.id, date: expect.any(Number), kind: 'cipher', cipher: b64('hello') })
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(b.id)) - before.b).toBe(1)
    expect(dialogOf(b1.updates, chatId)?.top_preview).toMatchObject({ kind: 'cipher', cipher: b64('hello'), sender_id: a.id })

    expect(await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 2, cipher: b64('x') })).toEqual({
      ok: false,
      e: 'stale_epoch',
    })
    // 普通消息的方法不能用在秘密聊天里
    expect(await a1.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'plain' })).toEqual({ ok: false, e: 'bad_request' })
    expect(await a1.call('messages.react', { chat_id: chatId, seq: 2, emoji: '👍' })).toEqual({ ok: false, e: 'bad_request' })
    expect(await a1.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })).toEqual({ ok: false, e: 'forbidden' })
    expect(await a1.call('calls.start', { chat_id: chatId, call_id: 'A'.repeat(22) })).toEqual({ ok: false, e: 'bad_request' })
  })

  it('编辑整条换掉密文；回应每人一条加密的；撤回连同加密的媒体对象一起删除', async () => {
    const { a, b, a1, b1, chatId } = await secretPair()
    const pending = `test/p/${a.id}/${'k'.repeat(22)}/sealed`
    await env.MEDIA.put(pending, 'x')
    const sent = await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('m'), keys: [pending] })
    expect(sent.ok).toBe(true)
    expect(await env.MEDIA.head(sentKey(pending))).not.toBeNull()
    expect(await env.MEDIA.head(pending)).toBeNull()

    expect(await a1.call('secrets.edit', { chat_id: chatId, seq: 2, epoch: 1, cipher: b64('m2') })).toEqual({ ok: true, r: null })
    expect(await b1.call('secrets.edit', { chat_id: chatId, seq: 2, epoch: 1, cipher: b64('m3') })).toEqual({ ok: false, e: 'forbidden' })
    expect(await b1.call('secrets.react', { chat_id: chatId, seq: 2, epoch: 1, cipher: b64('r') })).toEqual({ ok: true, r: null })
    await eventually(() => expect(changed(b1.updates)).toHaveLength(2))
    expect(changed(b1.updates)[1]).toMatchObject({ seq: 2, kind: 'cipher', cipher: b64('m2'), edit_date: expect.any(Number), reactions: { [b.id]: b64('r') } })
    // 回应不改变摘要：对话行不写
    const before = await userWrites(a.id)
    await b1.call('secrets.react', { chat_id: chatId, seq: 2, epoch: 1, cipher: null })
    expect(await userWrites(a.id)).toBe(before)

    expect(await a1.call('messages.recall', { chat_id: chatId, seq: 2 })).toEqual({ ok: true, r: null })
    await eventually(async () => expect(await env.MEDIA.head(sentKey(pending))).toBeNull())
    const got = await b1.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ kind: 'recalled' })
  })

  it('拉黑期间双方都不能发送', async () => {
    const { b, a1, b1, chatId } = await secretPair()
    await a1.call('users.block', { user_id: b.id })
    expect(await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('x') })).toEqual({ ok: false, e: 'blocked' })
    expect(await b1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('x') })).toEqual({ ok: false, e: 'blocked' })
  })
})

describe('secrets.commit', () => {
  it('新设备上传 KeyPackage 后通知成员设备；成员领取它的 KeyPackage 并提交，写服务消息，旧纪元的提交被拒绝', async () => {
    const { b, a1, a2, b1, chatId } = await secretPair()
    const b2 = await device(b.id)
    await eventually(() => expect(a1.events).toContainEqual({ type: 'secret', chat_id: chatId }))
    const state = await a1.call('secrets.state', { chat_id: chatId })
    expect(state.ok && state.r.devices[b.id]).toEqual([b1.deviceId, b2.deviceId].sort())

    const claimed = await a1.call('secrets.claim', { chat_id: chatId, devices: [{ user_id: b.id, device_id: b2.deviceId }] })
    expect(claimed.ok && claimed.r.key_packages.map((k) => k.device_id)).toEqual([b2.deviceId])
    const before = await chatWrites(chatId)
    const adds = [{ user_id: b.id, device_id: b2.deviceId }]
    expect(await a1.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c2'), welcome: b64('w2'), adds, removes: [] })).toEqual({
      ok: true,
      r: null,
    })
    // 提交 1 行 + 成员状态 1 行 + 服务消息 2 行
    expect((await chatWrites(chatId)) - before).toBe(4)
    expect(await a2.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c2x'), adds: [], removes: [b1.deviceId] })).toEqual({
      ok: false,
      e: 'stale_epoch',
    })
    await eventually(() => expect(newMessages(b2.updates).at(-1)).toMatchObject({ kind: 'service', action: { type: 'secret_devices', user_ids: [b.id] } }))
    const forB2 = await b2.call('secrets.commits', { chat_id: chatId, after: 0 })
    expect(forB2.ok && forB2.r.commits.map((c) => [c.epoch, c.welcome ?? null])).toEqual([
      [1, null],
      [2, b64('w2')],
    ])
    expect(await b1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('x') })).toEqual({ ok: false, e: 'stale_epoch' })
  })

  it('加入的必须是现有的、还不在组里的设备；移除的必须在组里；不在组里的设备不能提交', async () => {
    const { a, b, a1, b1, chatId } = await secretPair()
    const stranger = { user_id: b.id, device_id: 'nope' }
    expect(await a1.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c'), welcome: b64('w'), adds: [stranger], removes: [] })).toEqual({
      ok: false,
      e: 'bad_request',
    })
    expect(
      await a1.call('secrets.commit', {
        chat_id: chatId,
        epoch: 2,
        commit: b64('c'),
        welcome: b64('w'),
        adds: [{ user_id: b.id, device_id: b1.deviceId }],
        removes: [],
      }),
    ).toEqual({ ok: false, e: 'bad_request' })
    expect(await a1.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c'), adds: [], removes: ['nope'] })).toEqual({
      ok: false,
      e: 'bad_request',
    })
    const outsider = await connect(a.id, await createSession(a.id))
    expect(await outsider.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c'), adds: [], removes: [b1.deviceId] })).toEqual({
      ok: false,
      e: 'forbidden',
    })
  })

  it('丢了本地状态的设备请求重新加入：成员在同一个提交里移除再加入它', async () => {
    const { b, a1, b1, chatId } = await secretPair()
    expect(await b1.call('secrets.reset', { chat_id: chatId })).toEqual({ ok: true, r: null })
    await eventually(() => expect(a1.events).toContainEqual({ type: 'secret', chat_id: chatId }))
    const state = await a1.call('secrets.state', { chat_id: chatId })
    expect(state.ok && state.r.resets).toEqual([b1.deviceId])
    const device = { user_id: b.id, device_id: b1.deviceId }
    expect(
      await a1.call('secrets.commit', { chat_id: chatId, epoch: 2, commit: b64('c'), welcome: b64('w'), adds: [device], removes: [b1.deviceId] }),
    ).toEqual({ ok: true, r: null })
    const after = await a1.call('secrets.state', { chat_id: chatId })
    expect(after.ok && after.r.resets).toEqual([])
    expect(after.ok && after.r.leaves.filter((l) => l.device_id === b1.deviceId)).toHaveLength(1)
  })

  it('移除设备后，ChatDO 得知对方现有的设备变了', async () => {
    const { a, a1, a2, chatId } = await secretPair()
    expect(await a1.call('devices.revoke', { device_id: a2.deviceId })).toEqual({ ok: true, r: null })
    await eventually(async () => {
      const state = await a1.call('secrets.state', { chat_id: chatId })
      expect(state.ok && state.r.devices[a.id]).toEqual([a1.deviceId])
    })
    await eventually(() => expect(a1.events).toContainEqual({ type: 'secret', chat_id: chatId }))
  })

  it('退出登录后，ChatDO 得知自己现有的设备变了', async () => {
    const { a, a1, b1, chatId } = await secretPair()
    const { session, cookie } = await login(a.id)
    await device(a.id, 2, session.id)
    await eventually(async () => {
      const state = await b1.call('secrets.state', { chat_id: chatId })
      expect(state.ok && state.r.devices[a.id]).toContain(session.id)
    })
    const origin = 'http://localhost:5173'
    const res = await SELF.fetch(`${origin}/api/auth/sign-out`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } })
    expect(res.status).toBe(200)
    await eventually(async () => {
      const state = await b1.call('secrets.state', { chat_id: chatId })
      expect(state.ok && state.r.devices[a.id]).not.toContain(session.id)
    })
    await eventually(() => expect(a1.events).toContainEqual({ type: 'secret', chat_id: chatId }))
  })

})

describe('删除秘密聊天', () => {
  it('对双方生效：双方的对话都成了墓碑，消息与提交删光，之后的请求都当它不存在', async () => {
    const { b1, a1, chatId } = await secretPair()
    await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('x') })
    expect(await b1.call('dialogs.delete', { chat_id: chatId })).toEqual({ ok: true, r: null })
    expect(dialogOf(b1.updates, chatId)?.status).toBe('deleted')
    await eventually(() => expect(dialogOf(a1.updates, chatId)?.status).toBe('deleted'))
    expect(await inChat(chatId, (o) => o.sql.one<{ n: number }>('SELECT count(*) AS n FROM messages')!.n)).toBe(0)
    expect(await a1.call('secrets.send', { chat_id: chatId, random_id: randomId(), epoch: 1, cipher: b64('x') })).toEqual({ ok: false, e: 'not_found' })
    expect(await a1.call('sync.chat', { chat_id: chatId, pts: 0, limit: 10 })).toEqual({ ok: false, e: 'forbidden' })
    expect(await a1.call('dialogs.delete', { chat_id: chatId })).toEqual({ ok: false, e: 'not_found' })
  })
})
