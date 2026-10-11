import { newGroupChatId, privateChatId, type Dialog, type Message, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inChat, inUser, randomId, userWrites } from './helpers'

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)
const changed = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'update_message' ? [u.ev.message] : []))

async function privatePair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  for (const text of ['one', 'two']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
  await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_seq).toBe(2))
  return { a, b, chatId, ca, cb }
}

/** 把消息的发送时间往前拨，模拟超过时限 */
const age = (chatId: string, seq: number, ms: number) =>
  inChat(chatId, (o) => o.sql.run('UPDATE messages SET date = date - ? WHERE seq = ?', ms, seq))

describe('messages.edit', () => {
  it('编辑最后一条：ChatDO 写 2 行，双方对话行各 1 行，摘要随之更新', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'two!' })).toEqual({ ok: true, r: null })
    await eventually(() => expect(changed(cb.updates)).toHaveLength(1))

    const edited = changed(cb.updates)[0]!
    expect(edited).toMatchObject({ seq: 2, pts: 3, kind: 'text', text: 'two!' })
    expect(edited.kind === 'text' && edited.edit_date).toBeGreaterThan(0)
    expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 2, chat_pts: 3, top_preview: { kind: 'text', text: 'two!' } })
    expect(lastDialog(ca.updates, chatId)).toMatchObject({ top_preview: { text: 'two!' } })
    // 行本身 1 行 + pts 索引 1 行（实测，与新消息相同）
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)
  })

  it('编辑更早的消息：只推送，不写对话行', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    const before = { a: await userWrites(a.id), b: await userWrites(b.id) }

    await ca.call('messages.edit', { chat_id: chatId, seq: 1, text: 'one!' })
    await eventually(() => expect(changed(cb.updates)).toMatchObject([{ seq: 1, text: 'one!' }]))
    expect(changed(ca.updates)).toMatchObject([{ seq: 1, text: 'one!' }])
    expect(await userWrites(a.id)).toBe(before.a)
    expect(await userWrites(b.id)).toBe(before.b)
  })

  it('只能编辑自己的文本消息，1 小时内有效；内容没变时不写入', async () => {
    const { a, chatId, ca, cb } = await privatePair()
    expect(await cb.call('messages.edit', { chat_id: chatId, seq: 1, text: 'x' })).toEqual({ ok: false, e: 'forbidden' })
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 9, text: 'x' })).toEqual({ ok: false, e: 'not_found' })

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id) }
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 1, text: 'one' })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(a.id)).toBe(before.a)

    await age(chatId, 1, 60 * 60 * 1000 + 1)
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 1, text: 'late' })).toEqual({ ok: false, e: 'expired' })
  })

  it('服务消息不能编辑；前成员不能编辑', async () => {
    const owner = await createUser()
    const member = await createUser()
    const chatId = newGroupChatId()
    const co = await connect(owner.id)
    const cm = await connect(member.id)
    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })
    await cm.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'mine' })
    expect(await co.call('messages.edit', { chat_id: chatId, seq: 1, text: 'x' })).toEqual({ ok: false, e: 'bad_request' })

    await cm.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    expect(await cm.call('messages.edit', { chat_id: chatId, seq: 2, text: 'x' })).toEqual({ ok: false, e: 'forbidden' })
  })

  it('迟到的原消息重试不会把旧内容写回摘要', async () => {
    const { b, chatId, ca, cb } = await privatePair()
    const original = (await ca.call('messages.history', { chat_id: chatId, limit: 10 })) as { ok: true; r: { messages: Message[] } }
    const stale = { ...original.r.messages[1]!, random_id: undefined }

    await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'fresh' })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_preview).toMatchObject({ text: 'fresh' }))

    await inUser(b.id, (o) => o.onChatEvents(chatId, b.id, [{ type: 'new_message', message: stale }], { kind: 'private', title: null }))
    const synced = await cb.call('sync.user', { pts: 0 })
    expect(synced.ok && synced.r.dialogs.find((d) => d.chat_id === chatId)?.top_preview).toMatchObject({ text: 'fresh' })
  })

  it('去重窗口内重放原来的发送请求，返回的是编辑后的序号', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const rid = randomId()
    await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })
    await ca.call('messages.edit', { chat_id: chatId, seq: 1, text: 'y' })
    expect(await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })).toMatchObject({
      ok: true,
      r: { seq: 1, pts: 2 },
    })
  })
})

describe('messages.recall', () => {
  it('撤回最后一条：内容清空、摘要变为撤回占位；重复撤回不写入', async () => {
    const { a, chatId, ca, cb } = await privatePair()
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 2 })).toEqual({ ok: true, r: null })
    await eventually(() => expect(changed(cb.updates)).toMatchObject([{ seq: 2, kind: 'recalled' }]))
    expect(changed(cb.updates)[0]).not.toHaveProperty('text')
    expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 2, top_preview: { kind: 'recalled', sender_id: a.id } })

    const history = await cb.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages.map((m) => m.kind)).toEqual(['text', 'recalled'])

    const before = await chatWrites(chatId)
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 2 })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(before)
    // 撤回后不能再编辑
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'x' })).toEqual({ ok: false, e: 'bad_request' })
  })

  it('只能撤回自己的消息，2 分钟内有效', async () => {
    const { chatId, ca, cb } = await privatePair()
    expect(await cb.call('messages.recall', { chat_id: chatId, seq: 1 })).toEqual({ ok: false, e: 'forbidden' })
    await age(chatId, 1, 2 * 60 * 1000 + 1)
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 1 })).toEqual({ ok: false, e: 'expired' })
  })

  it('回复被撤回的消息后，引用读到的是撤回状态', async () => {
    const { chatId, ca, cb } = await privatePair()
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'reply', reply_to: 2 })
    await ca.call('messages.recall', { chat_id: chatId, seq: 2 })
    const got = await cb.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages).toMatchObject([{ seq: 2, kind: 'recalled' }])
  })
})
