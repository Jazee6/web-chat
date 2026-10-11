import { newGroupChatId, privateChatId, type Message, type PushPayload, type PushSubscriptionKeys, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import type { PushOptions } from '../src/push/webpush'
import { connect, createSession, createUser, eventually, inUser, randomId, stored, userWrites } from './helpers'

type Sent = { subscription: PushSubscriptionKeys; payload: PushPayload; options: PushOptions }

const subscription = (name: string): PushSubscriptionKeys => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  p256dh: `B${'A'.repeat(86)}`,
  auth: 'A'.repeat(22),
})

const pushOf = (userId: string, deviceId: string) =>
  inUser(userId, (o) => o.sql.one<{ push: string | null }>('SELECT push FROM devices WHERE id = ?', deviceId)?.push ?? null)

const newMessages = (updates: Update[], chatId: string): Message[] =>
  updates.flatMap((u) => (u.k === 'chat' && u.chat_id === chatId && u.ev.type === 'new_message' ? [u.ev.message] : []))

/**
 * 一台已订阅推送、连接着但不在前台的设备；推送由假的发送函数记录。
 * 推送的判定在 onChatEvents 返回前就已做出（在任何 await 之前），所以设备收到更新时，该推不该推已经确定
 */
async function subscribedDevice(userId: string, status = 201) {
  const device = await createSession(userId)
  const client = await connect(userId, device)
  expect(await client.call('push.set', { subscription: subscription(device) })).toEqual({ ok: true, r: null })
  const sent: Sent[] = []
  await inUser(userId, (o) => {
    o.sendPush = async (s, payload, options) => {
      sent.push({ subscription: s, payload, options })
      return status
    }
  })
  return { device, client, sent }
}

async function privatePair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const send = (text: string) => ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text })
  return { a, b, chatId, ca, send }
}

describe('push.set', () => {
  it('首次写 1 行，没有变化不写，清除写 1 行；只接受推送服务的地址', async () => {
    const a = await createUser()
    const device = await createSession(a.id)
    const c = await connect(a.id, device)

    let before = await userWrites(a.id)
    await c.call('push.set', { subscription: subscription('x') })
    expect((await userWrites(a.id)) - before).toBe(1)
    expect(JSON.parse((await pushOf(a.id, device))!)).toEqual(subscription('x'))

    before = await userWrites(a.id)
    await c.call('push.set', { subscription: subscription('x') })
    expect((await userWrites(a.id)) - before).toBe(0)

    await c.call('push.set', { subscription: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    expect(await pushOf(a.id, device)).toBeNull()
    await c.call('push.set', { subscription: null })
    expect((await userWrites(a.id)) - before).toBe(1)

    const evil = { ...subscription('x'), endpoint: 'https://evil.example.com/fcm.googleapis.com' }
    expect(await c.call('push.set', { subscription: evil })).toEqual({ ok: false, e: 'bad_request' })
  })
})

describe('推送', () => {
  it('发送者是有备注名的联系人时，通知用备注名', async () => {
    const { a, b, send } = await privatePair()
    const { client, sent } = await subscribedDevice(b.id)
    await client.call('contacts.set', { user_id: a.id, alias: 'Alice (work)' })

    await send('hello')
    await eventually(() => expect(sent.at(-1)?.payload).toMatchObject({ title: 'Alice (work)', body: 'hello' }))
  })

  it('私聊新消息推给不在前台的设备：标题为发送者，角标为未读总数，不额外写库', async () => {
    const { a, b, chatId, send } = await privatePair()
    const { device, sent } = await subscribedDevice(b.id)

    await send('hello')
    // 发送返回时扇出还在进行：等第一条落地后再记写入数
    await eventually(() => expect(sent).toHaveLength(1))
    const before = await userWrites(b.id)
    await send('again')
    await eventually(() => expect(sent).toHaveLength(2))

    const last = sent[1]!
    expect(last.subscription).toEqual(subscription(device))
    expect(last.payload).toEqual({ chat_id: chatId, seq: 2, title: `name-${a.id.slice(0, 8)}`, body: 'again', badge: 2, silent: false })
    expect(last.options).toMatchObject({ urgency: 'high', ttl: 86400 })
    expect(last.options.topic).toMatch(/^[A-Za-z0-9_-]{32}$/)
    // 只有对话行 1 行
    expect((await userWrites(b.id)) - before).toBe(1)
  })

  it('语音消息的正文给出时长', async () => {
    const { a, b, chatId, ca } = await privatePair()
    const { sent } = await subscribedDevice(b.id)
    const voice = {
      type: 'voice' as const,
      key: `test/p/${a.id}/${'D'.repeat(22)}/voice.webm`,
      mime: 'audio/webm' as const,
      size: 4000,
      duration: 72,
      waveform: btoa('\0'.repeat(64)),
    }
    await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([voice]) })
    await eventually(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.payload.body).toBe('Voice message (1:12)')
  })

  it('有设备在前台时不推送', async () => {
    const { b, chatId, send } = await privatePair()
    const { client, sent } = await subscribedDevice(b.id)
    const other = await connect(b.id)
    await other.call('presence.update', { visible: true, viewing: [] })

    await send('seen')
    await eventually(() => expect(newMessages(client.updates, chatId)).toHaveLength(1))
    await other.call('presence.update', { visible: false, viewing: [] })
    await send('missed')
    await eventually(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.payload.body).toBe('missed')
  })

  it('群组：被拉进群推送，改名不推送；正文带发送者', async () => {
    const a = await createUser()
    const b = await createUser()
    const { client, sent } = await subscribedDevice(b.id)
    const ca = await connect(a.id)
    const chatId = newGroupChatId()
    await ca.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'Team', user_ids: [b.id] })
    await eventually(() => expect(sent).toHaveLength(1))
    const actor = `name-${a.id.slice(0, 8)}`
    expect(sent[0]!.payload).toMatchObject({ title: 'Team', body: `${actor} created the group “Team”`, badge: 1 })

    await ca.call('chats.editTitle', { chat_id: chatId, random_id: randomId(), title: 'Crew' })
    await eventually(() => expect(newMessages(client.updates, chatId)).toHaveLength(2))
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await eventually(() => expect(sent).toHaveLength(2))
    expect(sent[1]!.payload).toMatchObject({ title: 'Crew', body: `${actor}: hi`, badge: 3 })
  })

  it('关闭通知预览：正文只写 New message，撤回不再推送', async () => {
    const { chatId, ca, b, send } = await privatePair()
    const { client, sent } = await subscribedDevice(b.id)
    await client.call('settings.set', { notification_preview: false })

    await send('secret')
    await eventually(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.payload.body).toBe('New message')

    await ca.call('messages.recall', { chat_id: chatId, seq: 1 })
    await send('next')
    await eventually(() => expect(sent).toHaveLength(2))
    expect(sent[1]!.payload.seq).toBe(2)
  })

  it('撤回、编辑最后一条未读消息时静默替换；已读之后不再推送', async () => {
    const { a, chatId, ca, b, send } = await privatePair()
    const { client, sent } = await subscribedDevice(b.id)

    await send('one')
    await eventually(() => expect(sent).toHaveLength(1))
    await ca.call('messages.recall', { chat_id: chatId, seq: 1 })
    await eventually(() => expect(sent).toHaveLength(2))
    expect(sent[1]!.payload).toMatchObject({ seq: 1, body: `name-${a.id.slice(0, 8)} recalled a message`, silent: true })
    expect(sent[1]!.options.urgency).toBe('normal')

    await send('two')
    await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'two!' })
    await eventually(() => expect(sent).toHaveLength(4))
    expect(sent[3]!.payload).toMatchObject({ seq: 2, body: 'two!', silent: true })

    await client.call('messages.read', { chat_id: chatId, max_seq: 2 })
    await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'two!!' })
    await send('three')
    await eventually(() => expect(sent).toHaveLength(5))
    expect(sent[4]!.payload).toMatchObject({ seq: 3, body: 'three', badge: 1, silent: false })
  })

  it('扇出重试的事件不重复推送', async () => {
    const { chatId, b, send } = await privatePair()
    const { client, sent } = await subscribedDevice(b.id)
    await send('once')
    await eventually(() => expect(sent).toHaveLength(1))

    const [message] = newMessages(client.updates, chatId)
    await inUser(b.id, (o) => o.onChatEvents(chatId, b.id, [{ type: 'new_message', message: message! }], { kind: 'private', title: null }))
    await send('twice')
    await eventually(() => expect(sent).toHaveLength(2))
    expect(sent[1]!.payload.body).toBe('twice')
  })

  it('推送服务报告订阅失效（410）时清除订阅', async () => {
    const { b, send } = await privatePair()
    const { device, sent } = await subscribedDevice(b.id, 410)
    await send('gone')
    await eventually(() => expect(sent).toHaveLength(1))
    await eventually(async () => expect(await pushOf(b.id, device)).toBeNull())
  })

  it('session 已失效的设备不推送，并清除订阅', async () => {
    const { b, send } = await privatePair()
    const expired = await createSession(b.id, { expiresAt: Date.now() - 1000 })
    const c = await connect(b.id, expired)
    await c.call('push.set', { subscription: subscription(expired) })
    const { device, sent } = await subscribedDevice(b.id)

    await send('hi')
    await eventually(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.subscription).toEqual(subscription(device))
    await eventually(async () => expect(await pushOf(b.id, expired)).toBeNull())
  })

  it('移除设备时清除它的订阅', async () => {
    const a = await createUser()
    const me = await connect(a.id, await createSession(a.id))
    const { device } = await subscribedDevice(a.id)
    await me.call('devices.revoke', { device_id: device })
    expect(await pushOf(a.id, device)).toBeNull()
  })
})
