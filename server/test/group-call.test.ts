import { env, runDurableObjectAlarm } from 'cloudflare:test'
import {
  newGroupChatId,
  privateChatId,
  randomToken,
  type Message,
  type PushPayload,
  type PushSubscriptionKeys,
  type Transient,
  type Update,
} from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { STUN_ONLY } from '../src/calls'
import type { SessionDescription } from '../src/sfu'
import { chatWrites, connect, createSession, createUser, eventually, inChat, inUser, randomId, userWrites, type Client } from './helpers'

/** 替身 SFU：记下每次调用，session 与 mid 依次编号 */
class FakeSfu {
  configured = true
  calls: { op: string; session: string; args: unknown }[] = []
  private sessions = 0
  private mids = new Map<string, number>()

  private nextMid(session: string) {
    const n = this.mids.get(session) ?? 0
    this.mids.set(session, n + 1)
    return String(n)
  }
  async newSession() {
    const session = `s${++this.sessions}`
    this.calls.push({ op: 'new', session, args: null })
    return session
  }
  async publish(session: string, offer: SessionDescription, tracks: { mid: string; name: string }[]) {
    this.calls.push({ op: 'publish', session, args: { sdp: offer.sdp, tracks } })
    return { type: 'answer', sdp: `answer:${offer.sdp}` } as SessionDescription
  }
  async pull(session: string, tracks: { session: string; name: string; rid?: string }[]) {
    this.calls.push({ op: 'pull', session, args: tracks })
    return { offer: { type: 'offer', sdp: `offer:${tracks.length}` } as SessionDescription, mids: tracks.map(() => this.nextMid(session)) }
  }
  async renegotiate(session: string, answer: SessionDescription) {
    this.calls.push({ op: 'renegotiate', session, args: answer.sdp })
  }
  async unpublish(session: string, offer: SessionDescription, mids: string[]) {
    this.calls.push({ op: 'unpublish', session, args: { sdp: offer.sdp, mids } })
    return { type: 'answer', sdp: 'closed' } as SessionDescription
  }
  async layer(session: string, mid: string, remote: { session: string; name: string }, rid: string) {
    this.calls.push({ op: 'layer', session, args: { mid, remote, rid } })
  }
  async closeAll(session: string) {
    this.calls.push({ op: 'closeAll', session, args: null })
  }
  ops = (op: string) => this.calls.filter((c) => c.op === op)
}

/** 客户端发 SDP 前做的压缩 */
async function pack(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return btoa(String.fromCharCode(...new Uint8Array(await new Response(stream).arrayBuffer())))
}

const groupEvents = (c: Client) => c.events.flatMap((e) => (e.type === 'group_call' ? [e] : [])) as Extract<Transient, { type: 'group_call' }>[]
const lastGroupCall = (c: Client) => groupEvents(c).at(-1)
const serviceMessages = (updates: Update[], chatId: string): Message[] =>
  updates.flatMap((u) =>
    u.k === 'chat' && u.chat_id === chatId && u.ev.message.kind === 'service' && u.ev.message.action.type === 'group_call' ? [u.ev.message] : [],
  )
const callMeta = (userId: string) =>
  inUser(userId, (o) => o.sql.one<{ value: string }>("SELECT value FROM meta WHERE key = 'call'")?.value ?? null)

/** 三人的群组，三人都在线；ChatDO 换上替身 SFU */
async function group() {
  const a = await createUser()
  const b = await createUser()
  const c = await createUser()
  const chatId = newGroupChatId()
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  const cc = await connect(c.id)
  expect(await ca.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'Team', user_ids: [b.id, c.id] })).toMatchObject({ ok: true })
  const sfu = new FakeSfu()
  await inChat(chatId, (o) => {
    o.sfu = sfu as never
  })
  return { a, b, c, chatId, ca, cb, cc, sfu }
}

/** a 发起，b 加入 */
async function inCall() {
  const g = await group()
  const callId = randomToken()
  const started = await g.ca.call('group_calls.join', { chat_id: g.chatId, call_id: callId })
  expect(started).toMatchObject({ ok: true })
  expect(await g.cb.call('group_calls.join', { chat_id: g.chatId, call_id: randomToken() })).toMatchObject({ ok: true, r: { call: { call_id: callId } } })
  await eventually(() => expect(lastGroupCall(g.ca)?.call?.participants).toHaveLength(2))
  return { ...g, callId }
}

describe('群组通话', () => {
  it('发起：写通话记录与房间状态，发起者开麦；成员收到"发起了群组通话"，返回 ICE 服务器', async () => {
    const { a, chatId, ca, cc } = await group()
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id) }
    const callId = randomToken()
    const res = await ca.call('group_calls.join', { chat_id: chatId, call_id: callId })
    expect(res).toMatchObject({
      ok: true,
      r: { call: { call_id: callId, started_by: a.id, participants: [{ user_id: a.id, muted: false, tracks: {} }] }, ice_servers: STUN_ONLY },
    })
    expect(lastGroupCall(ca)).toMatchObject({ call: { call_id: callId }, mine: true })
    await eventually(() => expect(serviceMessages(cc.updates, chatId)).toHaveLength(1))
    expect(serviceMessages(cc.updates, chatId)[0]).toMatchObject({ sender_id: a.id, action: { type: 'group_call', call_id: callId } })
    // 通话记录 2 行（行本身 + pts 索引）+ 房间状态 1 行
    expect((await chatWrites(chatId)) - before.chat).toBe(3)
    // 记下通话 1 行 + 自己的对话行 1 行
    await eventually(async () => expect((await userWrites(a.id)) - before.a).toBe(2))
    expect(JSON.parse((await callMeta(a.id))!)).toEqual({ chat_id: chatId, call_id: callId, device_id: ca.deviceId })
  })

  it('加入：静音，只写 1 行；正在查看群组的成员看到参与者，没有查看的不打扰', async () => {
    const { b, chatId, ca, cb, cc } = await group()
    await cc.call('presence.update', { visible: true, viewing: [chatId] })
    const callId = randomToken()
    await ca.call('group_calls.join', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(lastGroupCall(cc)?.call?.participants).toHaveLength(1))
    const before = await chatWrites(chatId)
    const res = await cb.call('group_calls.join', { chat_id: chatId, call_id: randomToken() })
    expect(res.ok && res.r.call.participants.find((p) => p.user_id === b.id)).toMatchObject({ muted: true })
    expect((await chatWrites(chatId)) - before).toBe(1)
    await eventually(() => expect(lastGroupCall(cc)?.call?.participants).toHaveLength(2))
    expect(lastGroupCall(cc)?.mine).toBe(false)
  })

  it('打开群组时从 presence.update 拿到进行中的通话（横条）', async () => {
    const { chatId, ca, cc } = await group()
    const callId = randomToken()
    await ca.call('group_calls.join', { chat_id: chatId, call_id: callId })
    const res = await cc.call('presence.update', { visible: true, viewing: [chatId] })
    expect(res).toMatchObject({ ok: true, r: { group_calls: [{ call_id: callId, chat_id: chatId }] } })
  })

  it('发布：第一次建 SFU session，写 1 行；track 名由服务端起，参与者收到，查看的非参与者不收', async () => {
    const { a, chatId, callId, ca, cb, cc, sfu } = await inCall()
    await cc.call('presence.update', { visible: true, viewing: [chatId] })
    const seen = groupEvents(cc).length
    const before = await chatWrites(chatId)
    const res = await ca.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('v=0 offer'), tracks: [{ mid: '0', slot: 'mic' }] })
    expect(res).toEqual({ ok: true, r: { sdp: 'answer:v=0 offer' } })
    expect(sfu.ops('new')).toHaveLength(1)
    expect((await chatWrites(chatId)) - before).toBe(1)
    await eventually(() => expect(lastGroupCall(cb)?.call?.participants.find((p) => p.user_id === a.id)?.tracks.mic).toMatch(/^mic-/))
    await new Promise((r) => setTimeout(r, 50))
    expect(groupEvents(cc).length).toBe(seen)
  })

  it('拉取：客户端只说拉谁的哪路，服务端换成 session 与 track；摄像头默认拉 h 层，不在发的标为 gone', async () => {
    const { a, b, chatId, callId, ca, cb, sfu } = await inCall()
    await ca.call('group_calls.publish', {
      chat_id: chatId,
      call_id: callId,
      sdp: await pack('offer'),
      tracks: [
        { mid: '0', slot: 'mic' },
        { mid: '1', slot: 'camera' },
      ],
    })
    const names = (await eventually(() => {
      const tracks = lastGroupCall(cb)?.call?.participants.find((p) => p.user_id === a.id)?.tracks
      expect(tracks?.camera).toBeDefined()
      return tracks!
    })) as Record<string, string>
    const before = await chatWrites(chatId)
    const res = await cb.call('group_calls.pull', {
      chat_id: chatId,
      call_id: callId,
      tracks: [
        { user_id: a.id, slot: 'mic' },
        { user_id: a.id, slot: 'camera' },
        { user_id: a.id, slot: 'screen' },
        { user_id: b.id, slot: 'mic' },
      ],
    })
    expect(res).toEqual({
      ok: true,
      r: {
        sdp: 'offer:2',
        tracks: [
          { user_id: a.id, slot: 'mic', track: names.mic, mid: '0' },
          { user_id: a.id, slot: 'camera', track: names.camera, mid: '1' },
          { user_id: a.id, slot: 'screen', error: 'gone' },
          { user_id: b.id, slot: 'mic', error: 'gone' },
        ],
      },
    })
    const pull = sfu.ops('pull')[0]!
    expect(pull.session).toBe('s2')
    expect(pull.args).toEqual([
      { session: 's1', name: names.mic },
      { session: 's1', name: names.camera, rid: 'h' },
    ])
    // b 第一次拉取时建 session：1 行
    expect((await chatWrites(chatId)) - before).toBe(1)

    expect(await cb.call('group_calls.answer', { chat_id: chatId, call_id: callId, sdp: await pack('answer') })).toEqual({ ok: true, r: null })
    expect(sfu.ops('renegotiate')[0]).toMatchObject({ session: 's2', args: 'answer' })
    expect(await cb.call('group_calls.layer', { chat_id: chatId, call_id: callId, mid: '1', user_id: a.id, rid: 'f' })).toEqual({ ok: true, r: null })
    expect(sfu.ops('layer')[0]).toMatchObject({ session: 's2', args: { mid: '1', remote: { session: 's1', name: names.camera }, rid: 'f' } })
    // 之后的拉取与换层都不写库
    expect((await chatWrites(chatId)) - before).toBe(1)
  })

  it('停止发布：按 slot 换成 mid 交给 SFU，参与者看到摄像头没了', async () => {
    const { a, chatId, callId, ca, cb, sfu } = await inCall()
    await ca.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('o1'), tracks: [{ mid: '0', slot: 'mic' }] })
    await ca.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('o2'), tracks: [{ mid: '1', slot: 'camera' }] })
    await eventually(() => expect(lastGroupCall(cb)?.call?.participants.find((p) => p.user_id === a.id)?.tracks.camera).toBeDefined())
    const res = await ca.call('group_calls.unpublish', { chat_id: chatId, call_id: callId, sdp: await pack('o3'), slots: ['camera'] })
    expect(res).toEqual({ ok: true, r: { sdp: 'closed' } })
    expect(sfu.ops('unpublish')[0]).toMatchObject({ session: 's1', args: { sdp: 'o3', mids: ['1'] } })
    await eventually(() => expect(Object.keys(lastGroupCall(cb)!.call!.participants.find((p) => p.user_id === a.id)!.tracks)).toEqual(['mic']))
  })

  it('只有通话所在的设备能操作 SFU', async () => {
    const { a, chatId, callId } = await inCall()
    const phone = await connect(a.id)
    const res = await phone.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('x'), tracks: [{ mid: '0', slot: 'mic' }] })
    expect(res).toEqual({ ok: false, e: 'call_ended' })
  })

  it('开关麦克风：写 1 行，只告诉参与者；没有变化不写', async () => {
    const { b, chatId, callId, ca, cb } = await inCall()
    const before = await chatWrites(chatId)
    await cb.call('group_calls.mute', { chat_id: chatId, call_id: callId, muted: false })
    await eventually(() => expect(lastGroupCall(ca)?.call?.participants.find((p) => p.user_id === b.id)?.muted).toBe(false))
    await cb.call('group_calls.mute', { chat_id: chatId, call_id: callId, muted: false })
    expect((await chatWrites(chatId)) - before).toBe(1)
  })

  it('最后一人离开时结束：通话记录改写为带时长的，加入过的人记进最近通话，关掉 SFU session', async () => {
    const { a, b, c, chatId, callId, ca, cb, cc, sfu } = await inCall()
    await ca.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('o'), tracks: [{ mid: '0', slot: 'mic' }] })
    await cb.call('group_calls.pull', { chat_id: chatId, call_id: callId, tracks: [{ user_id: a.id, slot: 'mic' }] })
    expect(await cb.call('group_calls.leave', { chat_id: chatId, call_id: callId })).toEqual({ ok: true, r: null })
    expect(await callMeta(b.id)).toBeNull()
    await eventually(() => expect(lastGroupCall(ca)?.call?.participants.map((p) => p.user_id)).toEqual([a.id]))
    await eventually(() => expect(sfu.ops('closeAll').map((op) => op.session)).toEqual(['s2']))
    await ca.call('group_calls.leave', { chat_id: chatId, call_id: callId })
    await eventually(() => expect(lastGroupCall(ca)?.call).toBeNull())

    const ended = (u: Update[]) => serviceMessages(u, chatId).filter((m) => m.kind === 'service' && m.action.type === 'group_call' && m.action.duration !== undefined)
    await eventually(() => expect(ended(cc.updates)).toHaveLength(1))
    expect(ended(cc.updates)[0]).toMatchObject({ action: { type: 'group_call', call_id: callId, duration: expect.any(Number), joined: [a.id, b.id] } })
    expect(ended(cc.updates)[0]).not.toHaveProperty('edit_date')

    const logOf = (updates: Update[]) => updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'call' ? [u.ev.call] : []))
    await eventually(() => expect(logOf(cb.updates)).toHaveLength(1))
    expect(logOf(cb.updates)[0]).toMatchObject({ call_id: callId, chat_id: chatId, peer_id: a.id, caller_id: a.id, result: 'ended' })
    await eventually(() => expect(logOf(ca.updates)).toHaveLength(1))
    expect(logOf(cc.updates)).toHaveLength(0)
    expect(await inChat(chatId, (o) => o.sql.one("SELECT 1 AS x FROM info WHERE key = 'group_call'"))).toBeUndefined()
    await eventually(() => expect(sfu.ops('closeAll').map((op) => op.session)).toEqual(['s2', 's1']))
    void c
  })

  it('一个人同一时间只在一个通话里：群组通话中的人被呼叫是忙线，一对一通话中加入群组通话也是忙线', async () => {
    const { a, b, c, chatId, ca, cc } = await inCall()
    const outsider = await createUser()
    const co = await connect(outsider.id)
    const res = await co.call('calls.start', { chat_id: privateChatId(outsider.id, a.id), call_id: randomToken() })
    expect(res).toMatchObject({ ok: true, r: { call: { state: 'ended', result: 'busy' } } })

    // c 在一对一通话里（还在响也算）
    await co.call('calls.start', { chat_id: privateChatId(outsider.id, c.id), call_id: randomToken() })
    await eventually(async () => expect(await callMeta(c.id)).not.toBeNull())
    expect(await cc.call('group_calls.join', { chat_id: chatId, call_id: randomToken() })).toEqual({ ok: false, e: 'busy' })
    void b
    void ca
  })

  it('被移出群组或退群即离开通话，SFU session 随即关掉', async () => {
    const { a, b, chatId, callId, ca, cb, sfu } = await inCall()
    await cb.call('group_calls.mute', { chat_id: chatId, call_id: callId, muted: false })
    await cb.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('o'), tracks: [{ mid: '0', slot: 'mic' }] })
    await ca.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: b.id })
    await eventually(() => expect(lastGroupCall(ca)?.call?.participants.map((p) => p.user_id)).toEqual([a.id]))
    await eventually(() => expect(lastGroupCall(cb)?.call?.participants.map((p) => p.user_id)).toEqual([a.id]))
    expect(lastGroupCall(cb)?.mine).toBe(false)
    await eventually(async () => expect(await callMeta(b.id)).toBeNull())
    await eventually(() => expect(sfu.ops('closeAll').map((op) => op.session)).toEqual(['s1']))
    expect(await cb.call('group_calls.join', { chat_id: chatId, call_id: callId })).toEqual({ ok: false, e: 'forbidden' })
  })

  it('所在设备断线：认领期内重连即继续；超时离开，最后一人掉线时按掉线时刻结束', async () => {
    const { a, chatId, callId, ca, cb } = await group().then(async (g) => {
      const callId = randomToken()
      await g.ca.call('group_calls.join', { chat_id: g.chatId, call_id: callId })
      return { ...g, callId }
    })
    const lostAt = () => inChat(chatId, (o) => (JSON.parse(o.sql.one<{ value: string }>("SELECT value FROM info WHERE key = 'group_call'")!.value) as { participants: Record<string, { lost_at: number | null }> }).participants[a.id]?.lost_at)
    ca.close()
    await eventually(async () => expect(await lostAt()).not.toBeNull())

    const back = await connect(a.id, ca.deviceId)
    expect(await back.call('calls.current', {})).toMatchObject({ ok: true, r: { call: null, group_call: { call_id: callId }, ice_servers: STUN_ONLY } })
    expect(await lostAt()).toBeNull()

    back.close()
    await eventually(async () => expect(await lostAt()).not.toBeNull())
    await inChat(chatId, async (o, state) => {
      const g = (o as unknown as { groupCall: { participants: Record<string, { lost_at: number }> } }).groupCall
      g.participants[a.id]!.lost_at = Date.now() - 31_000
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(env.CHAT.getByName(chatId))).toBe(true)
    const ended = () => serviceMessages(cb.updates, chatId).filter((m) => m.kind === 'service' && m.action.type === 'group_call' && m.action.duration !== undefined)
    await eventually(() => expect(ended()).toHaveLength(1))
  })

  it('在另一台设备上加入：通话转过去，原来那台的 SFU session 关掉并得知不再是本机', async () => {
    const { a, chatId, callId, ca, sfu } = await inCall()
    await ca.call('group_calls.publish', { chat_id: chatId, call_id: callId, sdp: await pack('o'), tracks: [{ mid: '0', slot: 'mic' }] })
    const phone = await connect(a.id)
    const res = await phone.call('group_calls.join', { chat_id: chatId, call_id: randomToken() })
    expect(res).toMatchObject({ ok: true, r: { call: { call_id: callId } } })
    expect(res.ok && res.r.call.participants.find((p) => p.user_id === a.id)).toMatchObject({ muted: false, tracks: {} })
    await eventually(() => expect(lastGroupCall(ca)?.mine).toBe(false))
    expect(lastGroupCall(phone)?.mine).toBe(true)
    await eventually(() => expect(sfu.ops('closeAll').map((op) => op.session)).toEqual(['s1']))
    expect(JSON.parse((await callMeta(a.id))!).device_id).toBe(phone.deviceId)
  })

  it('重放已经结束的那次发起：call_ended，不会再开一次', async () => {
    const { chatId, ca } = await group()
    const callId = randomToken()
    await ca.call('group_calls.join', { chat_id: chatId, call_id: callId })
    await ca.call('group_calls.leave', { chat_id: chatId, call_id: callId })
    expect(await ca.call('group_calls.join', { chat_id: chatId, call_id: callId })).toEqual({ ok: false, e: 'call_ended' })
  })
})

describe('群组通话的推送', () => {
  const subscription = (name: string): PushSubscriptionKeys => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: `B${'A'.repeat(86)}`,
    auth: 'A'.repeat(22),
  })

  it('发起时推给不在前台的成员（不响铃）；静音的不推', async () => {
    const { b, c, chatId, ca, cb, cc } = await group()
    const sent = new Map<string, PushPayload[]>()
    for (const [user, client] of [
      [b, cb],
      [c, cc],
    ] as const) {
      const device = await createSession(user.id)
      const phone = await connect(user.id, device)
      await phone.call('push.set', { subscription: subscription(device) })
      await client.call('presence.update', { visible: false, viewing: [] })
      await phone.call('presence.update', { visible: false, viewing: [] })
      sent.set(user.id, [])
      await inUser(user.id, (o) => {
        o.sendPush = async (_s, payload) => {
          sent.get(user.id)!.push(payload)
          return 201
        }
      })
    }
    await cc.call('dialogs.update', { chat_id: chatId, muted_until: Number.MAX_SAFE_INTEGER })
    await ca.call('group_calls.join', { chat_id: chatId, call_id: randomToken() })
    await eventually(() => expect(sent.get(b.id)!.at(-1)).toMatchObject({ chat_id: chatId, silent: false }))
    expect(sent.get(b.id)!.at(-1)!.body).toContain('started a group call')
    expect(sent.get(b.id)!.at(-1)!.ring).toBeUndefined()
    await new Promise((r) => setTimeout(r, 50))
    expect(sent.get(c.id)).toHaveLength(0)
  })
})
