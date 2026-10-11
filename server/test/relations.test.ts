import { env, evictDurableObject } from 'cloudflare:test'
import { newGroupChatId, privateChatId, type Relation, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inChat, randomId, uid, userWrites } from './helpers'

const relations = (updates: Update[]): Relation[] =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'relation' ? [u.ev.relation] : []))

async function pair() {
  const a = await createUser()
  const b = await createUser()
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  return { a, b, ca, cb, chatId: privateChatId(a.id, b.id) }
}

describe('联系人', () => {
  it('添加、改备注名各写 1 行并同步到其他设备；没有变化时不写', async () => {
    const { a, b, ca } = await pair()
    const laptop = await connect(a.id)
    const before = await userWrites(a.id)

    expect(await ca.call('contacts.set', { user_id: b.id, alias: null })).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    await eventually(() =>
      expect(relations(laptop.updates).at(-1)).toEqual({ user_id: b.id, contact: true, alias: null, blocked: false }),
    )

    await ca.call('contacts.set', { user_id: b.id, alias: '  Bob  ' })
    expect((await userWrites(a.id)) - before).toBe(2)
    expect(relations(ca.updates).at(-1)).toMatchObject({ contact: true, alias: 'Bob' })

    await ca.call('contacts.set', { user_id: b.id, alias: 'Bob' })
    expect((await userWrites(a.id)) - before).toBe(2)
  })

  it('空的备注名等于不设', async () => {
    const { b, ca } = await pair()
    await ca.call('contacts.set', { user_id: b.id, alias: '   ' })
    expect(relations(ca.updates).at(-1)).toMatchObject({ contact: true, alias: null })
  })

  it('删除联系人保留墓碑供其他设备同步；sync.user 只返回变化的行', async () => {
    const { b, ca } = await pair()
    await ca.call('contacts.set', { user_id: b.id, alias: 'Bob' })
    const mid = await ca.call('sync.user', { pts: 0 })
    expect(mid.ok && mid.r.relations).toEqual([{ user_id: b.id, contact: true, alias: 'Bob', blocked: false }])

    await ca.call('contacts.remove', { user_id: b.id })
    const all = await ca.call('sync.user', { pts: 1 })
    expect(all.ok && all.r).toMatchObject({ relations: [{ user_id: b.id, contact: false, alias: null, blocked: false }], pts: 2 })
    expect(await ca.call('sync.user', { pts: 2 })).toMatchObject({ ok: true, r: { relations: [] } })
  })

  it('不能加自己，也不能加不存在的用户', async () => {
    const { a, ca } = await pair()
    expect(await ca.call('contacts.set', { user_id: a.id, alias: null })).toEqual({ ok: false, e: 'bad_request' })
    expect(await ca.call('contacts.set', { user_id: uid(), alias: null })).toEqual({ ok: false, e: 'not_found' })
  })

  it('冷启动后 user_pts 也从关系表恢复', async () => {
    const { a, b, ca } = await pair()
    await ca.call('contacts.set', { user_id: b.id, alias: null })
    await ca.call('contacts.set', { user_id: b.id, alias: 'x' })
    ca.close()

    await evictDurableObject(env.USER.getByName(a.id))
    const again = await connect(a.id)
    await again.call('contacts.set', { user_id: b.id, alias: 'y' })
    expect(again.updates.at(-1)).toMatchObject({ k: 'user', pts: 3 })
  })
})

describe('拉黑', () => {
  it('拉黑写 UserDO 1 行 + 私聊 ChatDO 1 行；重复拉黑不写', async () => {
    const { a, b, ca, chatId } = await pair()
    const before = { user: await userWrites(a.id), chat: await chatWrites(chatId) }

    expect(await ca.call('users.block', { user_id: b.id })).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before.user).toBe(1)
    expect((await chatWrites(chatId)) - before.chat).toBe(1)
    expect(relations(ca.updates).at(-1)).toEqual({ user_id: b.id, contact: false, alias: null, blocked: true })

    await ca.call('users.block', { user_id: b.id })
    expect((await userWrites(a.id)) - before.user).toBe(1)
    expect((await chatWrites(chatId)) - before.chat).toBe(1)
  })

  it('拉黑与联系人互相独立', async () => {
    const { b, ca } = await pair()
    await ca.call('contacts.set', { user_id: b.id, alias: 'Bob' })
    await ca.call('users.block', { user_id: b.id })
    expect(relations(ca.updates).at(-1)).toEqual({ user_id: b.id, contact: true, alias: 'Bob', blocked: true })
    await ca.call('users.unblock', { user_id: b.id })
    expect(relations(ca.updates).at(-1)).toEqual({ user_id: b.id, contact: true, alias: 'Bob', blocked: false })
  })

  it('被拉黑的人发私聊明确失败，不写任何行（会话还没初始化时也一样）', async () => {
    const { a, b, ca, cb, chatId } = await pair()
    await ca.call('users.block', { user_id: b.id })
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    expect(await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })).toEqual({
      ok: false,
      e: 'blocked',
    })
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(a.id)).toBe(before.a)
    expect(await userWrites(b.id)).toBe(before.b)
    expect(await inChat(chatId, (o) => o.sql.one('SELECT count(*) AS n FROM members'))).toEqual({ n: 0 })
  })

  it('拉黑方也要先解除拉黑才能发；解除后双方恢复', async () => {
    const { b, ca, cb, chatId } = await pair()
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'before' })
    await ca.call('users.block', { user_id: b.id })

    expect(await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'x' })).toEqual({ ok: false, e: 'blocked' })
    expect(await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'y' })).toEqual({ ok: false, e: 'blocked' })

    await ca.call('users.unblock', { user_id: b.id })
    expect(await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'z' })).toMatchObject({ ok: true })
  })

  it('拉黑之前已经写入的发送，重放时仍返回原来的结果', async () => {
    const { b, ca, cb, chatId } = await pair()
    const params = { chat_id: chatId, random_id: randomId(), text: 'hi' }
    const first = await cb.call('messages.send', params)
    await ca.call('users.block', { user_id: b.id })
    expect(await cb.call('messages.send', params)).toEqual(first)
  })

  it('拉黑期间不能编辑，但可以撤回', async () => {
    const { b, ca, cb, chatId } = await pair()
    const sent = await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    if (!sent.ok) throw new Error(sent.e)
    await ca.call('users.block', { user_id: b.id })

    expect(await cb.call('messages.edit', { chat_id: chatId, seq: sent.r.seq, text: 'edited' })).toEqual({ ok: false, e: 'blocked' })
    expect(await cb.call('messages.recall', { chat_id: chatId, seq: sent.r.seq })).toEqual({ ok: true, r: null })
  })

  it('被拉黑的人看拉黑者的在线状态总是"很久以前"；正在看的立即收到', async () => {
    const { a, b, ca, cb, chatId } = await pair()
    await ca.call('presence.update', { visible: true, viewing: [] })
    const seen = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(seen.ok && seen.r.peers).toEqual([{ user_id: a.id, presence: { status: 'online' } }])

    await ca.call('users.block', { user_id: b.id })
    await eventually(() =>
      expect(cb.events.at(-1)).toEqual({ type: 'presence', user_id: a.id, presence: { status: 'long' } }),
    )
    const r = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(r.ok && r.r.peers).toEqual([{ user_id: a.id, presence: { status: 'long' } }])

    // 上下线也不再推给他
    const count = cb.events.length
    await ca.call('presence.update', { visible: false, viewing: [] })
    await ca.call('presence.update', { visible: true, viewing: [] })
    expect(cb.events.length).toBe(count)
  })

  it('拉黑期间，被拉黑的人看不到拉黑者新的已读', async () => {
    const { a, b, ca, cb, chatId } = await pair()
    const sent = await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    if (!sent.ok) throw new Error(sent.e)
    await eventually(async () => {
      const r = await ca.call('sync.user', { pts: 0 })
      expect(r.ok && r.r.dialogs.find((d) => d.chat_id === chatId)?.top_seq).toBe(1)
    })
    await ca.call('users.block', { user_id: b.id })
    await ca.call('messages.read', { chat_id: chatId, max_seq: 1 })

    await new Promise((resolve) => setTimeout(resolve, 50))
    const r = await cb.call('sync.user', { pts: 0 })
    expect(r.ok && r.r.dialogs.find((d) => d.chat_id === chatId)?.peer_read_seq).toBe(0)
    expect(a.id).toBeDefined()
  })

  it('私聊里拉黑期间不转发输入中', async () => {
    const { b, ca, cb, chatId } = await pair()
    await ca.call('presence.update', { visible: true, viewing: [chatId] })
    await ca.call('users.block', { user_id: b.id })
    expect(await cb.call('presence.typing', { chat_id: chatId, action: 'typing' })).toEqual({ ok: true, r: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ca.events.filter((e) => e.type === 'typing')).toEqual([])
  })

  it('不能把拉黑了自己的人拉进群：整体失败并指出是谁，不写任何行', async () => {
    const { a, b, ca, cb } = await pair()
    const c = await createUser()
    await ca.call('users.block', { user_id: b.id })
    const chatId = newGroupChatId()
    const before = await chatWrites(chatId)

    expect(await cb.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [a.id, c.id] })).toEqual({
      ok: false,
      e: 'blocked',
      user_ids: [a.id],
    })
    expect(await chatWrites(chatId)).toBe(before)

    const created = await cb.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [c.id] })
    expect(created.ok).toBe(true)
    expect(await cb.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [a.id] })).toEqual({
      ok: false,
      e: 'blocked',
      user_ids: [a.id],
    })
  })

  it('拉黑方仍可以把被拉黑的人拉进群', async () => {
    const { b, ca } = await pair()
    await ca.call('users.block', { user_id: b.id })
    const res = await ca.call('chats.create', { chat_id: newGroupChatId(), random_id: randomId(), title: 'T', user_ids: [b.id] })
    expect(res.ok).toBe(true)
  })
})
