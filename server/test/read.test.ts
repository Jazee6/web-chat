import { newGroupChatId, privateChatId, type Dialog, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, randomId, userWrites } from './helpers'

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

async function privatePair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  for (const text of ['1', '2', '3']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
  await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_seq).toBe(3))
  return { a, b, chatId, ca, cb }
}

describe('messages.read', () => {
  it('私聊：自己的对话行、ChatDO 成员行、对方的 peer_read_seq 各写 1 行', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    const laptop = await connect(b.id)
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    expect(await cb.call('messages.read', { chat_id: chatId, max_seq: 2 })).toEqual({ ok: true, r: null })

    // 自己的其他设备同步已读位置
    await eventually(() => expect(lastDialog(laptop.updates, chatId)).toMatchObject({ last_read_seq: 2, peer_read_seq: 0 }))
    // 对方收到已读回执
    await eventually(() => expect(lastDialog(ca.updates, chatId)).toMatchObject({ last_read_seq: 3, peer_read_seq: 2 }))
    expect((await userWrites(b.id)) - before.b).toBe(1)
    expect((await chatWrites(chatId)) - before.chat).toBe(1)
    expect((await userWrites(a.id)) - before.a).toBe(1)
  })

  it('不前移的已读不写入；超过最新一条时截到 top_seq', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    await cb.call('messages.read', { chat_id: chatId, max_seq: 99 })
    await eventually(() => expect(lastDialog(ca.updates, chatId)?.peer_read_seq).toBe(3))
    expect(lastDialog(cb.updates, chatId)?.last_read_seq).toBe(3)

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    expect(await cb.call('messages.read', { chat_id: chatId, max_seq: 3 })).toEqual({ ok: true, r: null })
    expect(await cb.call('messages.read', { chat_id: chatId, max_seq: 1 })).toEqual({ ok: true, r: null })
    expect(await userWrites(b.id)).toBe(before.b)
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(a.id)).toBe(before.a)
  })

  it('新消息重建对话行时保留 peer_read_seq', async () => {
    const { chatId, ca, cb } = await privatePair()
    await cb.call('messages.read', { chat_id: chatId, max_seq: 3 })
    await eventually(() => expect(lastDialog(ca.updates, chatId)?.peer_read_seq).toBe(3))

    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: '4' })
    expect(lastDialog(ca.updates, chatId)).toMatchObject({ top_seq: 4, last_read_seq: 4, peer_read_seq: 3 })
    const synced = await ca.call('sync.user', { pts: 0 })
    expect(synced.ok && synced.r.dialogs.find((d) => d.chat_id === chatId)).toMatchObject({ peer_read_seq: 3 })
  })

  it('群组只写自己的对话行，不请求 ChatDO、不扇出', async () => {
    const owner = await createUser()
    const member = await createUser()
    const chatId = newGroupChatId()
    const co = await connect(owner.id)
    const cm = await connect(member.id)
    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await eventually(() => expect(lastDialog(cm.updates, chatId)?.top_seq).toBe(2))

    const before = { chat: await chatWrites(chatId), owner: await userWrites(owner.id), member: await userWrites(member.id) }
    const seen = co.updates.length
    expect(await cm.call('messages.read', { chat_id: chatId, max_seq: 2 })).toEqual({ ok: true, r: null })
    expect(lastDialog(cm.updates, chatId)).toMatchObject({ last_read_seq: 2 })
    expect((await userWrites(member.id)) - before.member).toBe(1)
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(owner.id)).toBe(before.owner)
    expect(co.updates.length).toBe(seen)
  })

  it('没有对话行时返回 not_found', async () => {
    const a = await createUser()
    const b = await createUser()
    const ca = await connect(a.id)
    expect(await ca.call('messages.read', { chat_id: privateChatId(a.id, b.id), max_seq: 1 })).toEqual({
      ok: false,
      e: 'not_found',
    })
  })
})
