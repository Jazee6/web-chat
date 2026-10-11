import { env, evictDurableObject } from 'cloudflare:test'
import { newGroupChatId, privateChatId, type Presence, type Transient } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inUser, randomId, userWrites } from './helpers'

const presences = (events: Transient[], userId: string): Presence[] =>
  events.flatMap((e) => (e.type === 'presence' && e.user_id === userId ? [e.presence] : []))
const typings = (events: Transient[]) => events.filter((e) => e.type === 'typing')

async function pair() {
  const a = await createUser()
  const b = await createUser()
  return { a, b, chatId: privateChatId(a.id, b.id) }
}

describe('在线状态', () => {
  it('查看私聊时拿到对方状态；对方上线、下线实时推送；切换可见性不写库', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)

    // A 已连接但还没上报可见：不算在线
    const first = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(first.ok && first.r.peers).toMatchObject([{ user_id: a.id, presence: { status: 'offline' } }])

    const before = await userWrites(a.id)
    await ca.call('presence.update', { visible: true, viewing: [] })
    await eventually(() => expect(presences(cb.events, a.id).at(-1)).toEqual({ status: 'online' }))

    const hiddenAt = Date.now()
    await ca.call('presence.update', { visible: false, viewing: [] })
    await eventually(() => expect(presences(cb.events, a.id).at(-1)?.status).toBe('offline'))
    const last = presences(cb.events, a.id).at(-1) as Extract<Presence, { status: 'offline' }>
    expect(last.last_seen).toBeGreaterThanOrEqual(hiddenAt)
    expect(await userWrites(a.id)).toBe(before)
  })

  it('多台设备中任意一台可见即在线', async () => {
    const { a, b, chatId } = await pair()
    const phone = await connect(a.id)
    const laptop = await connect(a.id)
    const cb = await connect(b.id)
    await phone.call('presence.update', { visible: true, viewing: [] })
    await laptop.call('presence.update', { visible: false, viewing: [] })

    const r = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(r.ok && r.r.peers[0]?.presence).toEqual({ status: 'online' })

    await laptop.call('presence.update', { visible: true, viewing: [] })
    await phone.call('presence.update', { visible: false, viewing: [] })
    expect(presences(cb.events, a.id).every((p) => p.status === 'online')).toBe(true)
  })

  it('后台重连的设备不刷新最后上线时间', async () => {
    const { a, b, chatId } = await pair()
    const phone = await connect(a.id)
    await phone.call('presence.update', { visible: true, viewing: [] })
    await phone.call('presence.update', { visible: false, viewing: [] })
    const cb = await connect(b.id)
    const seen = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    if (!seen.ok) throw new Error(seen.e)
    const lastSeen = seen.r.peers[0]!.presence

    await new Promise((r) => setTimeout(r, 20))
    const laptop = await connect(a.id)
    const again = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(again.ok && again.r.peers[0]?.presence).toEqual(lastSeen)

    // 后台连接最后断开，落盘的仍是真正的最后上线时间
    phone.close()
    laptop.close()
    await eventually(async () =>
      expect(await inUser(a.id, (o) => o.sql.one<{ value: number }>("SELECT value FROM meta WHERE key = 'last_seen'"))).toEqual({
        value: (lastSeen as { last_seen: number }).last_seen,
      }),
    )
  })

  it('最后一条连接断开时落盘最后上线时间与设备最后活跃（共 2 行）', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    await ca.call('presence.update', { visible: true, viewing: [] })
    const before = await userWrites(a.id)
    ca.close()

    await eventually(async () => expect((await userWrites(a.id)) - before).toBe(2))
    const stored = await inUser(a.id, (o) => o.sql.one<{ value: number }>("SELECT value FROM meta WHERE key = 'last_seen'"))
    expect(stored?.value).toBeGreaterThan(0)

    const cb = await connect(b.id)
    const r = await cb.call('presence.update', { visible: true, viewing: [chatId] })
    expect(r.ok && r.r.peers[0]?.presence).toEqual({ status: 'offline', last_seen: stored!.value })
  })
})

describe('输入中', () => {
  it('只推给正在查看该会话的设备，不写库', async () => {
    const { a, b, chatId } = await pair()
    const viewing = await connect(a.id)
    const elsewhere = await connect(a.id)
    const cb = await connect(b.id)
    await viewing.call('presence.update', { visible: true, viewing: [chatId] })
    await elsewhere.call('presence.update', { visible: true, viewing: [] })

    const before = { a: await userWrites(a.id), chat: await chatWrites(chatId) }
    expect(await cb.call('presence.typing', { chat_id: chatId, action: 'typing' })).toEqual({ ok: true, r: null })
    await eventually(() => expect(typings(viewing.events)).toEqual([{ type: 'typing', chat_id: chatId, user_id: b.id, action: 'typing' }]))
    expect(typings(elsewhere.events)).toEqual([])
    expect(typings(cb.events)).toEqual([])
    expect(await userWrites(a.id)).toBe(before.a)
    expect(await chatWrites(chatId)).toBe(before.chat)
  })

  it('录音时转发录音动作', async () => {
    const { a, b, chatId } = await pair()
    const viewing = await connect(a.id)
    const cb = await connect(b.id)
    await viewing.call('presence.update', { visible: true, viewing: [chatId] })

    expect(await cb.call('presence.typing', { chat_id: chatId, action: 'recording' })).toEqual({ ok: true, r: null })
    await eventually(() =>
      expect(typings(viewing.events)).toEqual([{ type: 'typing', chat_id: chatId, user_id: b.id, action: 'recording' }]),
    )
  })

  it('ChatDO 被逐出、查看者名单丢失后，输入中仍能送达', async () => {
    const { a, b, chatId } = await pair()
    const viewing = await connect(a.id)
    const elsewhere = await connect(a.id)
    const cb = await connect(b.id)
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await viewing.call('presence.update', { visible: true, viewing: [chatId] })
    await elsewhere.call('presence.update', { visible: true, viewing: [] })

    await evictDurableObject(env.CHAT.getByName(chatId))
    await cb.call('presence.typing', { chat_id: chatId, action: 'typing' })
    await eventually(() => expect(typings(viewing.events)).toHaveLength(1))
    expect(typings(elsewhere.events)).toEqual([])
  })

  it('群组：非成员不能上报，也不能登记为查看者', async () => {
    const owner = await createUser()
    const member = await createUser()
    const stranger = await createUser()
    const chatId = newGroupChatId()
    const co = await connect(owner.id)
    const cm = await connect(member.id)
    const cs = await connect(stranger.id)
    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [member.id] })

    await cm.call('presence.update', { visible: true, viewing: [chatId] })
    await cs.call('presence.update', { visible: true, viewing: [chatId] })
    expect(await cs.call('presence.typing', { chat_id: chatId, action: 'typing' })).toEqual({ ok: false, e: 'forbidden' })

    await co.call('presence.typing', { chat_id: chatId, action: 'typing' })
    await eventually(() => expect(typings(cm.events)).toHaveLength(1))
    expect(typings(cs.events)).toEqual([])
  })
})
