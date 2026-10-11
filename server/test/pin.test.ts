import { MAX_PINNED_MESSAGES, newGroupChatId, privateChatId, type Message, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, randomId, userWrites } from './helpers'

const chatEvents = (updates: Update[], type: 'new_message' | 'update_message'): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === type ? [u.ev.message] : []))

/** 群主与成员；成员先发两条消息 */
async function group() {
  const owner = await createUser()
  const member = await createUser()
  const chatId = newGroupChatId()
  const co = await connect(owner.id)
  const cm = await connect(member.id)
  await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })
  for (const text of ['first', 'second']) await cm.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
  await eventually(() => expect(chatEvents(co.updates, 'new_message').map((m) => m.seq)).toContain(3))
  return { owner, member, chatId, co, cm }
}

const pinned = async (client: Awaited<ReturnType<typeof connect>>, chatId: string) => {
  const r = await client.call('sync.chat', { chat_id: chatId, pts: 0, limit: 100 })
  return r.ok ? r.r.pinned : null
}

describe('messages.pin', () => {
  it('群主置顶：消息改写 3 行 + 服务消息 2 行；成员收到改写后的消息与服务消息，对话行各 1 行', async () => {
    const { owner, member, chatId, co, cm } = await group()
    const before = { chat: await chatWrites(chatId), owner: await userWrites(owner.id), member: await userWrites(member.id) }

    const res = await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })
    expect(res).toMatchObject({ ok: true, r: { seq: 4 } })
    await eventually(() => expect(chatEvents(cm.updates, 'new_message').map((m) => m.seq)).toContain(4))

    expect(chatEvents(cm.updates, 'update_message')).toMatchObject([{ seq: 2, text: 'first', pinned_at: expect.any(Number) }])
    expect(chatEvents(cm.updates, 'new_message').at(-1)).toMatchObject({
      seq: 4,
      kind: 'service',
      action: { type: 'message_pin', seq: 2, excerpt: { kind: 'text', text: 'first' } },
    })
    // 自己的设备也收到两者
    expect(chatEvents(co.updates, 'update_message')).toMatchObject([{ seq: 2, pinned_at: expect.any(Number) }])
    expect(chatEvents(co.updates, 'new_message').at(-1)).toMatchObject({ seq: 4, kind: 'service' })
    // 行本身 + pts 索引 + 置顶的部分索引；服务消息 2 行
    expect((await chatWrites(chatId)) - before.chat).toBe(5)
    expect((await userWrites(owner.id)) - before.owner).toBe(1)
    expect((await userWrites(member.id)) - before.member).toBe(1)
    expect(await pinned(cm, chatId)).toEqual([2])
  })

  it('群组只有群主能置顶与取消置顶；私聊双方都可以', async () => {
    const { chatId, co, cm } = await group()
    expect(await cm.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })).toEqual({ ok: false, e: 'forbidden' })
    await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })
    expect(await cm.call('messages.unpin', { chat_id: chatId, seq: 2 })).toEqual({ ok: false, e: 'forbidden' })

    const a = await createUser()
    const b = await createUser()
    const pair = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: pair, random_id: randomId(), text: 'hi' })
    expect(await cb.call('messages.pin', { chat_id: pair, random_id: randomId(), seq: 1 })).toMatchObject({ ok: true })
    expect(await ca.call('messages.unpin', { chat_id: pair, seq: 1 })).toEqual({ ok: true, r: null })
    expect(await pinned(cb, pair)).toEqual([])
  })

  it('已经置顶着时不写入；重放同一请求返回原来的服务消息；只能置顶文本与媒体消息', async () => {
    const { chatId, co } = await group()
    const rid = randomId()
    const first = await co.call('messages.pin', { chat_id: chatId, random_id: rid, seq: 2 })
    const before = await chatWrites(chatId)
    expect(await co.call('messages.pin', { chat_id: chatId, random_id: rid, seq: 2 })).toEqual(first)
    expect(await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(before)
    expect(await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 1 })).toEqual({ ok: false, e: 'bad_request' })
    expect(await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 99 })).toEqual({ ok: false, e: 'not_found' })
  })

  it(`最多 ${MAX_PINNED_MESSAGES} 条，后置顶的在前`, async () => {
    const { chatId, co } = await group()
    for (let i = 0; i < MAX_PINNED_MESSAGES; i++) await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: `m${i}` })
    // seq 4–13 是刚发的 10 条
    for (let seq = 4; seq < 4 + MAX_PINNED_MESSAGES; seq++) {
      expect(await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq })).toMatchObject({ ok: true })
    }
    expect(await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })).toEqual({ ok: false, e: 'pin_limit' })
    const list = await pinned(co, chatId)
    expect(list).toHaveLength(MAX_PINNED_MESSAGES)
    expect(list![0]).toBe(13)
  })

  it('取消置顶：消息改写 2 行，不产生服务消息，成员的对话行不写；没有置顶时不写入', async () => {
    const { member, chatId, co, cm } = await group()
    await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })
    await eventually(() => expect(chatEvents(cm.updates, 'update_message')).toHaveLength(1))
    const before = { chat: await chatWrites(chatId), member: await userWrites(member.id) }

    expect(await co.call('messages.unpin', { chat_id: chatId, seq: 2 })).toEqual({ ok: true, r: null })
    await eventually(() => expect(chatEvents(cm.updates, 'update_message')).toHaveLength(2))
    expect(chatEvents(cm.updates, 'update_message').at(-1)).not.toHaveProperty('pinned_at')
    // 行本身 + pts 索引；部分索引里删掉一项不计入写入（实测）
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect(await userWrites(member.id)).toBe(before.member)

    const again = await chatWrites(chatId)
    expect(await co.call('messages.unpin', { chat_id: chatId, seq: 2 })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(again)
  })

  it('撤回置顶着的消息即取消置顶', async () => {
    const { chatId, co, cm } = await group()
    await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 3 })
    await cm.call('messages.recall', { chat_id: chatId, seq: 3 })
    expect(await pinned(co, chatId)).toEqual([])
  })

  it('私聊拉黑期间不能置顶，可以取消置顶', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'one' })
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'two' })
    await ca.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 1 })
    await ca.call('users.block', { user_id: b.id })
    expect(await cb.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })).toEqual({ ok: false, e: 'blocked' })
    expect(await cb.call('messages.unpin', { chat_id: chatId, seq: 1 })).toEqual({ ok: true, r: null })
  })

  it('前成员的置顶列表只含离开前的消息', async () => {
    const { member, chatId, co, cm } = await group()
    await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })
    await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: member.id })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'later' })
    const later = chatEvents(co.updates, 'new_message').at(-1)!.seq
    await co.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: later })
    expect(await pinned(cm, chatId)).toEqual([2])
    expect(await pinned(co, chatId)).toEqual([later, 2])
  })
})
