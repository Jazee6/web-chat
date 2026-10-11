import { newGroupChatId, privateChatId, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, randomId, userWrites } from './helpers'

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

describe('回复', () => {
  it('回复带上 reply_to，对方与历史都能看到；写入与普通发送相同', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'question' })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(1))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    expect(await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'answer', reply_to: 1 })).toMatchObject({
      ok: true,
      r: { seq: 2 },
    })
    await eventually(() => expect(newMessages(ca.updates).at(-1)).toMatchObject({ seq: 2, text: 'answer', reply_to: 1 }))
    // ChatDO：messages + messages_by_pts；双方 dialog 各 1 行
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)

    const history = await ca.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages.map((m) => (m.kind === 'text' ? m.reply_to : null))).toEqual([undefined, 1])
  })

  it('不能回复尚不存在的消息', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'x' })
    expect(await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'y', reply_to: 5 })).toEqual({
      ok: false,
      e: 'bad_request',
    })
  })
})

describe('messages.get', () => {
  it('按 seq 取消息；前成员只能取到离开为止', async () => {
    const owner = await createUser()
    const member = await createUser()
    const chatId = newGroupChatId()
    const co = await connect(owner.id)
    const cm = await connect(member.id)
    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'before' })
    await cm.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'after' })

    const all = await co.call('messages.get', { chat_id: chatId, seqs: [4, 2, 2, 99] })
    expect(all.ok && all.r.messages.map((m) => m.seq)).toEqual([2, 4])

    const limited = await cm.call('messages.get', { chat_id: chatId, seqs: [2, 3, 4] })
    expect(limited.ok && limited.r.messages.map((m) => m.seq)).toEqual([2, 3])

    const stranger = await connect((await createUser()).id)
    expect(await stranger.call('messages.get', { chat_id: chatId, seqs: [1] })).toEqual({ ok: false, e: 'forbidden' })
  })
})
