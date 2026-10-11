import { env, runDurableObjectAlarm } from 'cloudflare:test'
import {
  MAX_RECENT_CALLS,
  privateChatId,
  randomToken,
  type Call,
  type Dialog,
  type Message,
  type PushPayload,
  type PushSubscriptionKeys,
  type Transient,
  type Update,
} from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { STUN_ONLY } from '../src/calls'
import { chatWrites, connect, createSession, createUser, eventually, inChat, inUser, randomId, userWrites, type Client } from './helpers'

const callEvents = (events: Transient[]): Call[] => events.flatMap((e) => (e.type === 'call' ? [e.call] : []))
const lastCall = (c: Client) => callEvents(c.events).at(-1)
const signals = (c: Client) => c.events.flatMap((e) => (e.type === 'call_signal' ? [e.data] : []))
const records = (updates: Update[], chatId: string): Message[] =>
  updates.flatMap((u) =>
    u.k === 'chat' && u.chat_id === chatId && u.ev.type === 'new_message' && u.ev.message.kind === 'service' ? [u.ev.message] : [],
  )
const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)
const callMeta = (userId: string) =>
  inUser(userId, (o) => o.sql.one<{ value: string }>("SELECT value FROM meta WHERE key = 'call'")?.value ?? null)

/** 已经聊过一句的私聊：ChatDO 已初始化，双方的对话行都在，并且都读到了最新 */
async function pair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
  await eventually(() => expect(lastDialog(cb.updates, chatId)?.top_seq).toBe(1))
  await cb.call('messages.read', { chat_id: chatId, max_seq: 1 })
  return { a, b, chatId, ca, cb }
}

async function ringing() {
  const p = await pair()
  const callId = randomToken()
  const started = await p.ca.call('calls.start', { chat_id: p.chatId, call_id: callId })
  expect(started).toMatchObject({ ok: true, r: { call: { state: 'ringing', caller_id: p.a.id, callee_id: p.b.id } } })
  await eventually(() => expect(lastCall(p.cb)?.state).toBe('ringing'))
  return { ...p, callId }
}

async function active() {
  const r = await ringing()
  expect(await r.cb.call('calls.accept', { chat_id: r.chatId, call_id: r.callId })).toMatchObject({ ok: true })
  await eventually(() => expect(lastCall(r.ca)?.state).toBe('active'))
  return r
}

const record = async (c: Client, chatId: string) => {
  await eventually(() => expect(records(c.updates, chatId).some((m) => m.kind === 'service' && m.action.type === 'call')).toBe(true))
  const m = records(c.updates, chatId).at(-1)!
  return m.kind === 'service' ? m.action : null
}

describe('一对一通话', () => {
  it('发起：ChatDO 写 1 行，双方的 UserDO 各记 1 行；被叫方的所有设备响铃，返回 ICE 服务器', async () => {
    const { a, b, chatId, ca, cb } = await pair()
    const phone = await connect(b.id)
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    const res = await ca.call('calls.start', { chat_id: chatId, call_id: randomToken() })
    expect(res).toMatchObject({ ok: true, r: { call: { state: 'ringing' }, ice_servers: STUN_ONLY } })
    await eventually(() => expect(lastCall(phone)?.state).toBe('ringing'))
    expect(lastCall(cb)?.state).toBe('ringing')

    expect((await chatWrites(chatId)) - before.chat).toBe(1)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)
  })

  it('接听：其余设备停止响铃，主叫方收到接听的设备；信令只转给对方通话所在的设备，不写库', async () => {
    const { a, b, chatId, callId, ca, cb } = await ringing()
    const phone = await connect(b.id)
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    expect(await cb.call('calls.accept', { chat_id: chatId, call_id: callId })).toMatchObject({
      ok: true,
      r: { call: { state: 'active', device_id: cb.deviceId } },
    })
    await eventually(() => expect(lastCall(ca)).toMatchObject({ state: 'active', device_id: cb.deviceId }))
    await eventually(() => expect(lastCall(phone)).toMatchObject({ state: 'active', device_id: cb.deviceId }))
    expect((await chatWrites(chatId)) - before.chat).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)
    expect(await userWrites(a.id)).toBe(before.a)

    // 另一台设备再接听：已经被接走了
    expect(await phone.call('calls.accept', { chat_id: chatId, call_id: callId })).toEqual({ ok: false, e: 'call_ended' })

    const writes = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    expect(await ca.call('calls.signal', { chat_id: chatId, call_id: callId, data: 'offer' })).toEqual({ ok: true, r: { delivered: true } })
    expect(await cb.call('calls.signal', { chat_id: chatId, call_id: callId, data: 'answer' })).toEqual({ ok: true, r: { delivered: true } })
    await eventually(() => expect(signals(cb)).toEqual(['offer']))
    await eventually(() => expect(signals(ca)).toEqual(['answer']))
    expect(signals(phone)).toEqual([])
    // 不在通话里的设备不能发
    expect(await phone.call('calls.signal', { chat_id: chatId, call_id: callId, data: 'x' })).toEqual({ ok: false, e: 'call_ended' })
    expect(await chatWrites(chatId)).toBe(writes.chat)
    expect(await userWrites(a.id)).toBe(writes.a)
    expect(await userWrites(b.id)).toBe(writes.b)
  })

  it('接通后挂断：ChatDO 写 3 行（删除状态 + 通话记录），双方各 3 行（删除通话 + 对话行 + 最近通话）；记录带时长，读过之前的消息时这条也不算未读', async () => {
    const { a, b, chatId, callId, ca, cb } = await active()
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }

    expect(await ca.call('calls.end', { chat_id: chatId, call_id: callId })).toEqual({ ok: true, r: null })
    expect((await chatWrites(chatId)) - before.chat).toBe(3)
    expect(await record(ca, chatId)).toEqual({ type: 'call', call_id: callId, result: 'ended', duration: expect.any(Number) })
    expect(await record(cb, chatId)).toMatchObject({ result: 'ended' })
    await eventually(() => expect(lastCall(cb)).toMatchObject({ state: 'ended', result: 'ended' }))
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 2, last_read_seq: 2 }))
    expect(lastDialog(ca.updates, chatId)).toMatchObject({ top_seq: 2, last_read_seq: 2 })
    expect(await callMeta(a.id)).toBeNull()
    await eventually(async () => expect(await callMeta(b.id)).toBeNull())
    await eventually(async () => expect((await userWrites(a.id)) - before.a).toBe(3))
    await eventually(async () => expect((await userWrites(b.id)) - before.b).toBe(3))

    // 重复挂断不报错、不写入
    const after = await chatWrites(chatId)
    expect(await cb.call('calls.end', { chat_id: chatId, call_id: callId })).toEqual({ ok: true, r: null })
    expect(await chatWrites(chatId)).toBe(after)
  })

  it('被叫方拒绝：记录为 declined，不算未读；之前还有未读时照常计入', async () => {
    const { a, b, chatId, callId, ca, cb } = await ringing()
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    await cb.call('calls.end', { chat_id: chatId, call_id: callId })
    expect(await record(ca, chatId)).toMatchObject({ result: 'declined' })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 2, last_read_seq: 2 }))
    expect((await chatWrites(chatId)) - before.chat).toBe(3)
    await eventually(async () => expect((await userWrites(a.id)) - before.a).toBe(3))
    await eventually(async () => expect((await userWrites(b.id)) - before.b).toBe(3))

    // 有一条没读的消息之后再拒绝：已读位置不动
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'unread' })
    const next = randomToken()
    await ca.call('calls.start', { chat_id: chatId, call_id: next })
    await eventually(() => expect(lastCall(cb)).toMatchObject({ call_id: next, state: 'ringing' }))
    await cb.call('calls.end', { chat_id: chatId, call_id: next })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 4, last_read_seq: 2 }))
  })

  it('主叫方取消：被叫方收到未接来电，计入未读', async () => {
    const { a, b, chatId, callId, ca, cb } = await ringing()
    const before = { a: await userWrites(a.id), b: await userWrites(b.id) }
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    expect(await record(cb, chatId)).toMatchObject({ result: 'canceled' })
    await eventually(() => expect(lastCall(cb)).toMatchObject({ state: 'ended', result: 'canceled' }))
    expect(lastDialog(cb.updates, chatId)).toMatchObject({ top_seq: 2, last_read_seq: 1 })
    await eventually(async () => expect((await userWrites(a.id)) - before.a).toBe(3))
    await eventually(async () => expect((await userWrites(b.id)) - before.b).toBe(3))
  })

  it('主叫方的记录：通话期间对方发来的消息没读时，已读位置不动', async () => {
    const { chatId, callId, ca, cb } = await active()
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'during the call' })
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    await record(ca, chatId)
    expect(lastDialog(ca.updates, chatId)).toMatchObject({ top_seq: 3, last_read_seq: 1 })
  })

  it('响铃超时：Alarm 结束为未接来电', async () => {
    const { chatId, ca, cb } = await ringing()
    const before = await chatWrites(chatId)
    await inChat(chatId, async (o, state) => {
      const self = o as unknown as { call: { deadline: number } }
      self.call.deadline = Date.now() - 1
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(env.CHAT.getByName(chatId))).toBe(true)
    expect(await record(cb, chatId)).toMatchObject({ result: 'missed' })
    expect((await chatWrites(chatId)) - before).toBe(3)
    await eventually(() => expect(lastCall(ca)).toMatchObject({ state: 'ended', result: 'missed' }))
  })

  it('忙线：被叫方已在别的通话里时立即结束，被叫方收到未接来电', async () => {
    const { b } = await active()
    const c = await createUser()
    const cc = await connect(c.id)
    const chatCb = privateChatId(c.id, b.id)
    const res = await cc.call('calls.start', { chat_id: chatCb, call_id: randomToken() })
    expect(res).toMatchObject({ ok: true, r: { call: { state: 'ended', result: 'busy' } } })
    const cb2 = await connect(b.id)
    await eventually(async () => {
      const diff = await cb2.call('sync.chat', { chat_id: chatCb, pts: 0, limit: 10 })
      expect(diff.ok && !diff.r.too_long && diff.r.messages.at(-1)).toMatchObject({ kind: 'service', action: { result: 'busy' } })
    })
  })

  it('对方正好在呼叫我：返回对方的来电；响铃中的主叫方不能再呼叫别人', async () => {
    const { a, chatId, callId, cb } = await ringing()
    const res = await cb.call('calls.start', { chat_id: chatId, call_id: randomToken() })
    expect(res).toMatchObject({ ok: true, r: { call: { call_id: callId, caller_id: a.id, state: 'ringing' } } })

    // 主叫方在响铃期间给别人打：忙
    const c = await createUser()
    const ca2 = await connect(a.id)
    expect(await ca2.call('calls.start', { chat_id: privateChatId(a.id, c.id), call_id: randomToken() })).toEqual({ ok: false, e: 'busy' })
  })

  it('重放发起请求返回同一个通话；结束后重放返回结束的通话，不再响铃', async () => {
    const { chatId, callId, ca } = await ringing()
    expect(await ca.call('calls.start', { chat_id: chatId, call_id: callId })).toMatchObject({ ok: true, r: { call: { call_id: callId, state: 'ringing' } } })
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    const before = await chatWrites(chatId)
    expect(await ca.call('calls.start', { chat_id: chatId, call_id: callId })).toMatchObject({
      ok: true,
      r: { call: { call_id: callId, state: 'ended', result: 'canceled' } },
    })
    expect(await chatWrites(chatId)).toBe(before)
  })

  it('拉黑：不能呼叫；通话中拉黑即结束', async () => {
    const { a, chatId, callId, ca, cb } = await active()
    await cb.call('users.block', { user_id: a.id })
    expect(await record(ca, chatId)).toEqual({ type: 'call', call_id: callId, result: 'ended', duration: expect.any(Number) })
    expect(await ca.call('calls.start', { chat_id: chatId, call_id: randomToken() })).toEqual({ ok: false, e: 'blocked' })
  })

  it('第一次联系就打电话：ChatDO 随之初始化', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    expect(await ca.call('calls.start', { chat_id: chatId, call_id: randomToken() })).toMatchObject({ ok: true, r: { call: { state: 'ringing' } } })
    await eventually(() => expect(lastCall(cb)?.state).toBe('ringing'))
  })

  it('通话所在设备断线：认领期内重连即继续；超时按断线时刻结束', async () => {
    const { a, chatId, callId, ca, cb } = await active()
    const device = ca.deviceId
    ca.close()
    await eventually(async () =>
      expect(await inChat(chatId, (o) => (o as unknown as { call: { lost_at: number | null } }).call.lost_at)).not.toBeNull(),
    )

    const back = await connect(a.id, device)
    expect(await back.call('calls.current', {})).toMatchObject({ ok: true, r: { call: { call_id: callId, state: 'active' }, ice_servers: STUN_ONLY } })
    expect(await inChat(chatId, (o) => (o as unknown as { call: { lost_at: number | null } }).call.lost_at)).toBeNull()

    // 再断一次，这次不回来
    back.close()
    await eventually(async () =>
      expect(await inChat(chatId, (o) => (o as unknown as { call: { lost_at: number | null } }).call.lost_at)).not.toBeNull(),
    )
    await inChat(chatId, async (o, state) => {
      ;(o as unknown as { call: { deadline: number } }).call.deadline = Date.now() - 1
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(env.CHAT.getByName(chatId))).toBe(true)
    expect(await record(cb, chatId)).toMatchObject({ result: 'ended' })
  })

  it('等待掉线的一方重连时，任何一方重新呼叫：旧通话随即结束，新的照常响铃', async () => {
    const { a, chatId, callId, ca, cb } = await active()
    ca.close()
    await eventually(async () =>
      expect(await inChat(chatId, (o) => (o as unknown as { call: { lost_at: number | null } }).call.lost_at)).not.toBeNull(),
    )
    const laptop = await connect(a.id)
    const again = randomToken()
    expect(await laptop.call('calls.start', { chat_id: chatId, call_id: again })).toMatchObject({ ok: true, r: { call: { call_id: again, state: 'ringing' } } })
    await eventually(() => expect(lastCall(cb)).toMatchObject({ call_id: again, state: 'ringing' }))
    expect(await record(cb, chatId)).toMatchObject({ call_id: callId, result: 'ended' })
  })

  it('同一设备的新连接顶替旧连接：旧连接迟到的关闭不会让通话进入断线计时', async () => {
    const { a, chatId, callId, ca } = await active()
    const fresh = await connect(a.id, ca.deviceId)
    await ca.closed
    expect(await fresh.call('calls.current', {})).toMatchObject({ ok: true, r: { call: { call_id: callId, state: 'active' } } })
    await new Promise((r) => setTimeout(r, 100))
    expect(await inChat(chatId, (o) => (o as unknown as { call: { lost_at: number | null } }).call.lost_at)).toBeNull()
  })

  it('响铃中主叫方断线即取消', async () => {
    const { chatId, ca, cb } = await ringing()
    ca.close()
    expect(await record(cb, chatId)).toMatchObject({ result: 'canceled' })
  })

  it('calls.current：来电还在响时返回来电（不带 ICE 服务器），已结束的清掉', async () => {
    const { b, chatId, callId, ca } = await ringing()
    const phone = await connect(b.id)
    const res = await phone.call('calls.current', {})
    expect(res).toEqual({ ok: true, r: { call: expect.objectContaining({ call_id: callId, state: 'ringing' }) } })
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    await eventually(async () => expect(await phone.call('calls.current', {})).toEqual({ ok: true, r: { call: null } }))
  })
})

describe('来电推送', () => {
  type Sent = { payload: PushPayload }
  const subscription = (name: string): PushSubscriptionKeys => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: `B${'A'.repeat(86)}`,
    auth: 'A'.repeat(22),
  })

  async function offlineCallee() {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const device = await createSession(b.id)
    const cb = await connect(b.id, device)
    await cb.call('push.set', { subscription: subscription(device) })
    const sent: Sent[] = []
    await inUser(b.id, (o) => {
      o.sendPush = async (_s, payload) => {
        sent.push({ payload })
        return 201
      }
    })
    return { a, b, chatId, ca, cb, sent }
  }

  it('没有设备在前台时推送来电（记下推过，多 1 行）；取消后用未接来电替换（同一个会话的通知）', async () => {
    const { b, chatId, ca, sent } = await offlineCallee()
    const callId = randomToken()
    const before = await userWrites(b.id)
    await ca.call('calls.start', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(sent.at(-1)?.payload).toMatchObject({ chat_id: chatId, body: 'Incoming call', ring: true, silent: false }))
    // 记下来电 1 行 + 记下推过 1 行
    expect((await userWrites(b.id)) - before).toBe(2)
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(sent.at(-1)?.payload).toMatchObject({ chat_id: chatId, body: 'Missed call', silent: false }))
  })

  it('静音的对话照样推送来电；未接来电不推，只静默替换掉来电通知', async () => {
    const { chatId, ca, cb, sent } = await offlineCallee()
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await eventually(() => expect(sent.length).toBe(1))
    await cb.call('dialogs.update', { chat_id: chatId, muted_until: Number.MAX_SAFE_INTEGER })

    const callId = randomToken()
    await ca.call('calls.start', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(sent.at(-1)?.payload).toMatchObject({ ring: true }))
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(sent.at(-1)?.payload).toMatchObject({ body: 'Missed call', silent: true }))
    expect(sent).toHaveLength(3)
  })
})

describe('最近通话', () => {
  it('通话结束后双方各记一条，经 user 更新与 sync.user 同步；重复投递不重复记', async () => {
    const { a, b, chatId, callId, ca, cb } = await active()
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    const logOf = (updates: Update[]) => updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'call' ? [u.ev.call] : []))
    await eventually(() => expect(logOf(cb.updates)).toHaveLength(1))
    await eventually(() => expect(logOf(ca.updates)).toHaveLength(1))
    expect(logOf(ca.updates)[0]).toMatchObject({ call_id: callId, chat_id: chatId, peer_id: b.id, caller_id: a.id, result: 'ended', seq: 2 })
    expect(logOf(cb.updates)[0]).toMatchObject({ call_id: callId, peer_id: a.id, caller_id: a.id })

    const synced = await cb.call('sync.user', { pts: 0 })
    expect(synced.ok && synced.r.calls.map((c) => c.call_id)).toEqual([callId])

    // 扇出重试再投递一次：已经记过，不写
    const recordEvent = cb.updates.find((u) => u.k === 'chat' && u.ev.type === 'new_message' && u.ev.message.kind === 'service')!
    const before = await userWrites(b.id)
    if (recordEvent.k !== 'chat') throw new Error('unreachable')
    await env.USER.getByName(b.id).onChatEvents(chatId, b.id, [recordEvent.ev], { kind: 'private', title: null })
    expect(await userWrites(b.id)).toBe(before)
  })

  it('只保留最近 MAX_RECENT_CALLS 条', async () => {
    const { b, chatId, callId, ca } = await ringing()
    await inUser(b.id, (o) => {
      for (let i = 0; i < MAX_RECENT_CALLS; i++) {
        o.sql.run(
          "INSERT INTO calls (call_id, chat_id, seq, peer_id, caller_id, result, duration, date, pts) VALUES (?, 'x', 1, 'x', 'x', 'missed', 0, ?, 0)",
          `old-${i}`, i,
        )
      }
    })
    await ca.call('calls.end', { chat_id: chatId, call_id: callId })
    await eventually(async () => expect(await inUser(b.id, (o) => o.sql.one<{ n: number }>('SELECT count(*) AS n FROM calls')!.n)).toBe(MAX_RECENT_CALLS))
    expect(await inUser(b.id, (o) => o.sql.one('SELECT 1 AS x FROM calls WHERE call_id = ?', callId))).toBeDefined()
    expect(await inUser(b.id, (o) => o.sql.one('SELECT 1 AS x FROM calls WHERE call_id = ?', 'old-0'))).toBeUndefined()
  })
})
