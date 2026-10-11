import {
  MUTE_FOREVER,
  newGroupChatId,
  privateChatId,
  type Dialog,
  type Message,
  type MessageEntity,
  type PushSubscriptionKeys,
  type Update,
} from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { connect, createSession, createUser, eventually, inUser, randomId, userWrites } from './helpers'

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)
const newMessages = (updates: Update[]): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

/** 文本里第一个 @name 的提及 */
const mention = (text: string, name: string, userId: string): MessageEntity => ({
  type: 'mention',
  offset: text.indexOf(`@${name}`),
  length: name.length + 1,
  user_id: userId,
})

/** 三人群：a 建群，b、c 是成员 */
async function trio() {
  const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()])
  const chatId = newGroupChatId()
  const [ca, cb, cc] = await Promise.all([connect(a.id), connect(b.id), connect(c.id)])
  await ca.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [b.id, c.id] })
  await eventually(() => expect(lastDialog(cb.updates, chatId)).toBeDefined())
  return { a, b, c, chatId, ca, cb, cc }
}

describe('提及', () => {
  it('提及成员：消息带实体，被提及的人记一条未读提及，不多花写入', async () => {
    const { b, chatId, ca, cb, cc } = await trio()
    const before = await userWrites(b.id)
    const text = 'hi @Bob'
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text, entities: [mention(text, 'Bob', b.id)] })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_seq).toBe(2))

    expect(newMessages(cb.updates).at(-1)).toMatchObject({ seq: 2, entities: [{ type: 'mention', offset: 3, length: 4, user_id: b.id }] })
    expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([2])
    await eventually(() => expect(lastDialog(cc.updates, chatId)?.top_seq).toBe(2))
    expect(lastDialog(cc.updates, chatId)?.unread_mentions).toEqual([])
    expect(lastDialog(ca.updates, chatId)?.unread_mentions).toEqual([])
    expect((await userWrites(b.id)) - before).toBe(1)
  })

  it('无效的提及去掉实体、保留文字：非成员、自己、越界、重叠；私聊里的提及一律去掉', async () => {
    const { a, b, chatId, ca } = await trio()
    const stranger = await createUser()
    const text = '@x @y @z'
    await ca.call('messages.send', {
      chat_id: chatId,
      random_id: randomId(),
      text,
      entities: [
        { type: 'mention', offset: 0, length: 2, user_id: stranger.id },
        { type: 'mention', offset: 3, length: 2, user_id: a.id },
        { type: 'mention', offset: 6, length: 9, user_id: b.id },
        { type: 'mention', offset: 3, length: 2, user_id: b.id },
        { type: 'mention', offset: 4, length: 2, user_id: b.id },
      ],
    })
    const got = await ca.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ text, entities: [{ offset: 3, length: 2, user_id: b.id }] })

    const pair = privateChatId(a.id, b.id)
    await ca.call('messages.send', { chat_id: pair, random_id: randomId(), text: '@b', entities: [mention('@b', 'b', b.id)] })
    const dm = await ca.call('messages.get', { chat_id: pair, seqs: [1] })
    expect(dm.ok && dm.r.messages[0]).not.toHaveProperty('entities')
  })

  it('回复我的消息也算提及；读到之后移除', async () => {
    const { b, chatId, ca, cb } = await trio()
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'question' })
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'answer', reply_to: 2 })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([3]))

    const before = await userWrites(b.id)
    await cb.call('messages.read', { chat_id: chatId, max_seq: 3 })
    expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([])
    expect((await userWrites(b.id)) - before).toBe(1)
  })

  it('自己发出消息即读到之前的提及', async () => {
    const { b, chatId, ca, cb } = await trio()
    const text = '@Bob'
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text, entities: [mention(text, 'Bob', b.id)] })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([2]))
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'yes?' })
    expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([])
  })

  it('提及我的消息被撤回：未读提及随之移除', async () => {
    const { b, chatId, ca, cb } = await trio()
    const text = '@Bob'
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text, entities: [mention(text, 'Bob', b.id)] })
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'later' })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([2]))
    await ca.call('messages.recall', { chat_id: chatId, seq: 2 })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([]))
  })

  it('编辑可以增删提及，但不产生未读提及', async () => {
    const { b, chatId, ca, cb } = await trio()
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hello' })
    await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_seq).toBe(2))
    const text = 'hello @Bob'
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 2, text, entities: [mention(text, 'Bob', b.id)] })).toEqual({
      ok: true,
      r: null,
    })
    const got = await cb.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ text, entities: [{ user_id: b.id }] })
    expect(lastDialog(cb.updates, chatId)?.unread_mentions).toEqual([])

    // 只改提及也算改动；去掉提及
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 2, text })).toEqual({ ok: true, r: null })
    const plain = await cb.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(plain.ok && plain.r.messages[0]).not.toHaveProperty('entities')
  })

  it('静音的群组只推送提及我的消息', async () => {
    const { b, chatId, ca } = await trio()
    const device = await createSession(b.id)
    const cb = await connect(b.id, device)
    const subscription: PushSubscriptionKeys = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${device}`,
      p256dh: `B${'A'.repeat(86)}`,
      auth: 'A'.repeat(22),
    }
    await cb.call('push.set', { subscription })
    await cb.call('dialogs.update', { chat_id: chatId, muted_until: MUTE_FOREVER })
    const bodies: string[] = []
    await inUser(b.id, (o) => {
      o.sendPush = async (_s, payload) => {
        bodies.push(payload.body)
        return 201
      }
    })

    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'plain' })
    const text = 'ping @Bob'
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text, entities: [mention(text, 'Bob', b.id)] })
    await eventually(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toContain('ping @Bob')
  })
})
