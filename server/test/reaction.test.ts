import { newGroupChatId, privateChatId, type Message, type PushSubscriptionKeys, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createSession, createUser, eventually, inUser, randomId, userWrites } from './helpers'

const changed = (updates: Update[]): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'update_message' ? [u.ev.message] : []))
const dialogUpdates = (updates: Update[]) => updates.filter((u) => u.k === 'user' && u.ev.type === 'dialog')
const reactionsOf = (m: Message | undefined) => (m && (m.kind === 'text' || m.kind === 'media') ? m.reactions : undefined)

async function privatePair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  for (const text of ['one', 'two']) await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
  await eventually(() => expect(cb.updates.some((u) => u.k === 'chat' && u.ev.message.seq === 2)).toBe(true))
  return { a, b, chatId, ca, cb }
}

async function group() {
  const owner = await createUser()
  const member = await createUser()
  const chatId = newGroupChatId()
  const co = await connect(owner.id)
  const cm = await connect(member.id)
  await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })
  await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
  await eventually(() => expect(cm.updates.some((u) => u.k === 'chat' && u.ev.message.seq === 2)).toBe(true))
  return { owner, member, chatId, co, cm }
}

describe('messages.react', () => {
  it('回应最后一条：ChatDO 写 2 行，双方都不写对话行；对方收到变更后的消息', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const dialogs = { a: dialogUpdates(ca.updates).length, b: dialogUpdates(cb.updates).length }

    expect(await cb.call('messages.react', { chat_id: chatId, seq: 2, emoji: '👍' })).toEqual({ ok: true, r: null })
    await eventually(() => expect(changed(ca.updates)).toHaveLength(1))

    expect(changed(ca.updates)[0]).toMatchObject({ seq: 2, pts: 3, text: 'two', reactions: { '👍': [b.id] } })
    expect(changed(cb.updates)).toMatchObject([{ seq: 2, reactions: { '👍': [b.id] } }])
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect(await userWrites(a.id)).toBe(before.a)
    expect(await userWrites(b.id)).toBe(before.b)
    expect(dialogUpdates(ca.updates)).toHaveLength(dialogs.a)
    expect(dialogUpdates(cb.updates)).toHaveLength(dialogs.b)
  })

  it('每人一个：点别的替换，传 null 取消；没有变化时不写入', async () => {
    const { a, b, chatId, ca, cb } = await privatePair()
    await ca.call('messages.react', { chat_id: chatId, seq: 1, emoji: '🔥' })
    await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '❤️' })
    await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '👍' })
    const got = await ca.call('messages.get', { chat_id: chatId, seqs: [1] })
    // 按 REACTIONS 的顺序，不按回应的先后
    expect(got.ok && got.r.messages[0]).toMatchObject({ reactions: { '👍': [b.id], '🔥': [a.id] } })
    expect(Object.keys(reactionsOf(got.ok ? got.r.messages[0] : undefined) ?? {})).toEqual(['👍', '🔥'])

    const before = await chatWrites(chatId)
    expect(await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '👍' })).toEqual({ ok: true, r: null })
    expect(await cb.call('messages.react', { chat_id: chatId, seq: 2, emoji: null })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(before)

    await ca.call('messages.react', { chat_id: chatId, seq: 1, emoji: null })
    await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: null })
    const cleared = await ca.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(cleared.ok && cleared.r.messages[0]).not.toHaveProperty('reactions')
  })

  it('只能回应文本与媒体消息；只读对话不能回应；不在 emoji 白名单里的拒绝', async () => {
    const { member, chatId, co, cm } = await group()
    expect(await cm.call('messages.react', { chat_id: chatId, seq: 1, emoji: '👍' })).toEqual({ ok: false, e: 'bad_request' })
    expect(await cm.call('messages.react', { chat_id: chatId, seq: 9, emoji: '👍' })).toEqual({ ok: false, e: 'not_found' })
    expect(await cm.raw({ t: 'req', id: 99, m: 'messages.react', p: { chat_id: chatId, seq: 2, emoji: '🍕' } })).toEqual({
      ok: false,
      e: 'bad_request',
    })

    await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: member.id })
    expect(await cm.call('messages.react', { chat_id: chatId, seq: 2, emoji: '👍' })).toEqual({ ok: false, e: 'forbidden' })
  })

  it('私聊拉黑期间双方都不能回应，不写入', async () => {
    const { b, chatId, ca, cb } = await privatePair()
    await ca.call('users.block', { user_id: b.id })
    const before = await chatWrites(chatId)
    expect(await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '👍' })).toEqual({ ok: false, e: 'blocked' })
    expect(await ca.call('messages.react', { chat_id: chatId, seq: 2, emoji: '👍' })).toEqual({ ok: false, e: 'blocked' })
    expect(await chatWrites(chatId)).toBe(before)
    await ca.call('users.unblock', { user_id: b.id })
    expect(await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '👍' })).toEqual({ ok: true, r: null })
  })

  it('别人回应之后，去重窗口内重放原来的发送请求：推回自己设备的消息仍带 random_id，供发件箱对账', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    const rid = randomId()
    await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })
    await cb.call('messages.react', { chat_id: chatId, seq: 1, emoji: '❤️' })
    const sent = ca.updates.length
    expect(await ca.call('messages.send', { chat_id: chatId, random_id: rid, text: 'x' })).toMatchObject({
      ok: true,
      r: { seq: 1, pts: 2 },
    })
    const replayed = ca.updates.slice(sent).flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))
    expect(replayed).toMatchObject([{ seq: 1, random_id: rid, reactions: { '❤️': [b.id] } }])
  })

  it('撤回时回应一起清空', async () => {
    const { chatId, ca, cb } = await privatePair()
    await cb.call('messages.react', { chat_id: chatId, seq: 2, emoji: '😂' })
    await ca.call('messages.recall', { chat_id: chatId, seq: 2 })
    const got = await cb.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).toEqual(expect.objectContaining({ kind: 'recalled' }))
    expect(got.ok && got.r.messages[0]).not.toHaveProperty('reactions')
    expect(await cb.call('messages.react', { chat_id: chatId, seq: 2, emoji: '👍' })).toEqual({ ok: false, e: 'bad_request' })
  })

  it('回应进入 sync.chat：离线的设备打开会话时补齐', async () => {
    const { member, chatId, co, cm } = await group()
    await cm.call('messages.react', { chat_id: chatId, seq: 2, emoji: '🙏' })
    const diff = await co.call('sync.chat', { chat_id: chatId, pts: 2, limit: 10 })
    expect(diff.ok && !diff.r.too_long && diff.r.messages).toMatchObject([{ seq: 2, pts: 3, reactions: { '🙏': [member.id] } }])
  })

  it('回应别人未读的最后一条消息不推送，也不静默替换通知', async () => {
    const { b, chatId, ca } = await privatePair()
    const device = await createSession(b.id)
    const cb = await connect(b.id, device)
    const subscription: PushSubscriptionKeys = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
      p256dh: `B${'A'.repeat(86)}`,
      auth: 'A'.repeat(22),
    }
    await cb.call('push.set', { subscription })
    let pushes = 0
    await inUser(b.id, (o) => {
      o.sendPush = async () => {
        pushes++
        return 201
      }
    })
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'three' })
    await eventually(() => expect(pushes).toBe(1))

    await ca.call('messages.react', { chat_id: chatId, seq: 3, emoji: '👍' })
    await eventually(() => expect(changed(cb.updates)).toHaveLength(1))
    // 推送的判定在 onChatEvents 返回前就已做出
    expect(pushes).toBe(1)
  })
})
