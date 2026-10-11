import { env, evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { newGroupChatId, privateChatId, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inChat, randomId, uid, userWrites } from './helpers'

async function pair() {
  const a = await createUser()
  const b = await createUser()
  return { a, b, chatId: privateChatId(a.id, b.id) }
}

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

describe('messages.send', () => {
  it('私聊发送：对方实时收到，稳态每条消息写入 4 行', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)

    const first = await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    expect(first).toMatchObject({ ok: true, r: { seq: 1, pts: 1 } })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(1))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const second = await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'second' })
    expect(second).toMatchObject({ ok: true, r: { seq: 2, pts: 2 } })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(2))

    // ChatDO：messages 1 行 + messages_by_pts 索引 1 行；双方 dialog 各 1 行
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)

    const received = newMessages(cb.updates)[1]!
    expect(received).toMatchObject({ chat_id: chatId, seq: 2, sender_id: a.id, text: 'second' })
    expect(received.random_id).toBeUndefined()
    expect(cb.updates.at(-1)).toMatchObject({ k: 'user', ev: { dialog: { chat_id: chatId, top_seq: 2, last_read_seq: 0 } } })
  })

  it('同一 random_id 重复提交返回第一次的结果，不重复写入', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const rid = randomId()

    const first = await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'once' })
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id) }
    const again = await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'once' })

    expect(again).toEqual(first)
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(a.id)).toBe(before.a)
  })

  it('冷启动后仍能去重，并从 max() 恢复序号', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const rid = randomId()
    const first = await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })

    await evictDurableObject(env.CHAT.getByName(chatId))

    expect(await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })).toEqual(first)
    expect(await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'y' })).toMatchObject({
      ok: true,
      r: { seq: 2, pts: 2 },
    })
  })

  it('发送者的其他设备收到回显（带 random_id），发送者本人发送即已读', async () => {
    const { a, chatId } = await pair()
    const phone = await connect(a.id)
    const laptop = await connect(a.id)
    const rid = randomId()

    await phone.call('messages.send', { chat_id: chatId, random_id: rid, text: 'echo' })

    await eventually(() => expect(newMessages(laptop.updates)).toHaveLength(1))
    expect(newMessages(laptop.updates)[0]).toMatchObject({ random_id: rid, text: 'echo' })
    expect(laptop.updates.at(-1)).toMatchObject({ k: 'user', ev: { dialog: { top_seq: 1, last_read_seq: 1 } } })
  })

  it('拒绝给自己发消息、不属于自己的会话、不存在的对方', async () => {
    const { a, b } = await pair()
    const c = await createUser()
    const ca = await connect(a.id)
    const send = (chat_id: string) => ca.call('messages.send', { chat_id, random_id: randomId(), text: 'x' })

    expect(await send(`p:${a.id}:${a.id}`)).toEqual({ ok: false, e: 'self_chat' })
    expect(await send(privateChatId(b.id, c.id))).toEqual({ ok: false, e: 'forbidden' })
    expect(await send(privateChatId(a.id, uid()))).toEqual({ ok: false, e: 'not_found' })
    expect(await send('g:whatever')).toEqual({ ok: false, e: 'bad_request' })
    expect(await send(newGroupChatId())).toEqual({ ok: false, e: 'not_found' })
  })

  it('两条首条消息并发到达时只初始化一次', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)

    const results = await Promise.all([
      ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'a' }),
      cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'b' }),
    ])

    expect(results.map((r) => r.ok && r.r.seq).sort()).toEqual([1, 2])
    const members = await inChat(chatId, (o) => o.sql.all('SELECT user_id FROM members'))
    expect(members).toHaveLength(2)
  })
})

describe('同步', () => {
  it('sync.user 返回变化的对话，sync.chat 返回增量或 too_long', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    for (const text of ['1', '2', '3']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })

    const cb = await connect(b.id)
    const user = await eventually(async () => {
      const res = await cb.call('sync.user', { pts: 0 })
      expect(res.ok && res.r.dialogs[0]?.top_seq).toBe(3)
      return res
    })
    expect(user).toMatchObject({
      ok: true,
      r: { dialogs: [{ chat_id: chatId, top_seq: 3, chat_pts: 3, last_read_seq: 0, top_preview: { text: '3', sender_id: a.id } }] },
    })
    const userPts = user.ok ? user.r.pts : 0
    expect(await cb.call('sync.user', { pts: userPts })).toEqual({ ok: true, r: { dialogs: [], relations: [], settings: null, calls: [], stickers: [], pts: userPts } })

    const diff = await cb.call('sync.chat', { chat_id: chatId, pts: 1, limit: 100 })
    expect(diff).toMatchObject({ ok: true, r: { too_long: false, pts: 3, messages: [{ seq: 2 }, { seq: 3 }] } })
    expect(await cb.call('sync.chat', { chat_id: chatId, pts: 0, limit: 2 })).toEqual({
      ok: true,
      r: { too_long: true, top_seq: 3, pts: 3, pinned: [] },
    })
  })

  it('messages.history 向上分页，random_id 只对发送者可见', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    for (const text of ['1', '2', '3']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })

    const page = await cb.call('messages.history', { chat_id: chatId, before_seq: 3, limit: 1 })
    expect(page).toMatchObject({ ok: true, r: { messages: [{ seq: 2, text: '2' }] } })
    expect(page.ok && page.r.messages[0]?.random_id).toBeUndefined()

    const mine = await ca.call('messages.history', { chat_id: chatId, limit: 100 })
    expect(mine.ok && mine.r.messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(mine.ok && mine.r.messages.every((m) => typeof m.random_id === 'number')).toBe(true)
  })

  it('只读路径不写库：sync.user、sync.chat、messages.history、messages.get、users.get', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    for (const text of ['1', '2', '3']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(3))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    for (const c of [ca, cb]) {
      expect(await c.call('sync.user', { pts: 0 })).toMatchObject({ ok: true })
      expect(await c.call('sync.chat', { chat_id: chatId, pts: 0, limit: 100 })).toMatchObject({ ok: true })
      expect(await c.call('messages.history', { chat_id: chatId, before_seq: 3, limit: 100 })).toMatchObject({ ok: true })
      expect(await c.call('messages.get', { chat_id: chatId, seqs: [1, 2] })).toMatchObject({ ok: true })
      expect(await c.call('users.get', { ids: [a.id, b.id] })).toMatchObject({ ok: true })
    }
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(a.id)).toBe(before.a)
    expect(await userWrites(b.id)).toBe(before.b)
  })

  it('会话尚无消息时 history 返回空，外人被拒绝', async () => {
    const { a, b, chatId } = await pair()
    const c = await createUser()
    expect(await (await connect(a.id)).call('messages.history', { chat_id: chatId, limit: 10 })).toEqual({
      ok: true,
      r: { messages: [] },
    })
    expect(await (await connect(c.id)).call('sync.chat', { chat_id: chatId, pts: 0, limit: 10 })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    void b
  })
})

describe('扇出重试', () => {
  it('Alarm 重投 fanout_outbox 中的事件，成功后删除', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'first' })
    const cb = await connect(b.id)
    await eventually(async () => expect((await cb.call('sync.user', { pts: 0 })).ok).toBe(true))

    // 模拟一次失败的扇出：事件进入重试队列
    const chat = env.CHAT.getByName(chatId)
    const lost = {
      type: 'new_message',
      message: { chat_id: chatId, seq: 99, pts: 99, sender_id: a.id, date: Date.now(), kind: 'text', text: 'lost' },
    }
    await inChat(chatId, async (o, state) => {
      o.sql.run('INSERT INTO fanout_outbox (user_id, events, attempts, next_at) VALUES (?, ?, 1, 0)', b.id, JSON.stringify([lost]))
      // 定在未来，避免运行时自行触发；由 runDurableObjectAlarm 立即执行
      await state.storage.setAlarm(Date.now() + 60_000)
    })

    expect(await runDurableObjectAlarm(chat)).toBe(true)
    await eventually(() => expect(newMessages(cb.updates).map((m) => m.kind === 'text' && m.text)).toContain('lost'))
    const dialog = await cb.call('sync.user', { pts: 0 })
    expect(dialog).toMatchObject({ ok: true, r: { dialogs: [{ top_seq: 99, chat_pts: 99 }] } })
    expect(await inChat(chatId, (o) => o.sql.all('SELECT * FROM fanout_outbox'))).toEqual([])

    // 重复投递是幂等的：不写入、不推送
    const before = await userWrites(b.id)
    await env.USER.getByName(b.id).onChatEvents(chatId, b.id, [lost as never], { kind: 'private', title: null })
    expect(await userWrites(b.id)).toBe(before)
  })
})

describe('协议', () => {
  it('未知方法、参数错误返回错误码；非法 JSON 关闭连接', async () => {
    const a = await createUser()
    const ca = await connect(a.id)
    expect(await ca.raw({ t: 'req', id: 1, m: 'nope', p: {} })).toEqual({ ok: false, e: 'unknown_method' })
    expect(await ca.raw({ t: 'req', id: 2, m: 'messages.send', p: { chat_id: 'x' } })).toEqual({
      ok: false,
      e: 'bad_request',
    })
    ca.ws.send('{not json')
    expect((await ca.closed).code).toBe(1007)
  })

  it('同一设备重连时关闭旧连接', async () => {
    const a = await createUser()
    const old = await connect(a.id, 'device-1')
    await connect(a.id, 'device-1')
    expect((await old.closed).code).toBe(4000)
  })
})

describe('users', () => {
  it('users.resolve 按邮箱忽略大小写精确匹配，users.get 不返回邮箱', async () => {
    const target = await createUser(`Mixed.${uid()}@Example.com`)
    const me = await createUser()
    const cm = await connect(me.id)

    const found = await cm.call('users.resolve', { email: target.email.toUpperCase() })
    expect(found).toEqual({ ok: true, r: { user: { id: target.id, name: expect.any(String), image: null } } })
    expect(await cm.call('users.resolve', { email: `nobody-${uid()}@example.com` })).toEqual({ ok: false, e: 'not_found' })

    const got = await cm.call('users.get', { ids: [target.id, me.id, target.id] })
    expect(got.ok && got.r.users.map((u) => u.id).sort()).toEqual([target.id, me.id].sort())
    expect(got.ok && got.r.users.every((u) => !('email' in u))).toBe(true)
  })
})
