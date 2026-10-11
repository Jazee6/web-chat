import { env, evictDurableObject } from 'cloudflare:test'
import { privateChatId, type Presence, type Transient } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { connect, createUser, eventually, inUser, randomId, userWrites } from './helpers'

const presences = (events: Transient[], userId: string): Presence[] =>
  events.flatMap((e) => (e.type === 'presence' && e.user_id === userId ? [e.presence] : []))

describe('settings.set', () => {
  it('改动的项写 1 行并同步到其他设备；没有变化时不写入', async () => {
    const a = await createUser()
    const phone = await connect(a.id)
    const laptop = await connect(a.id)

    const before = await userWrites(a.id)
    expect(await phone.call('settings.set', { last_seen: 'nobody' })).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    await eventually(() =>
      expect(laptop.updates.at(-1)).toMatchObject({ k: 'user', ev: { type: 'settings', settings: { last_seen: 'nobody' } } }),
    )

    expect(await phone.call('settings.set', { last_seen: 'nobody' })).toEqual({ ok: true, r: null })
    expect(await phone.call('settings.set', {})).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
  })

  it('sync.user 在设置有变化时返回完整设置', async () => {
    const a = await createUser()
    const ca = await connect(a.id)
    expect(await ca.call('sync.user', { pts: 0 })).toEqual({ ok: true, r: { dialogs: [], relations: [], settings: null, calls: [], stickers: [], pts: 0 } })

    await ca.call('settings.set', { last_seen: 'nobody' })
    const all = await ca.call('sync.user', { pts: 0 })
    expect(all).toEqual({ ok: true, r: { dialogs: [], relations: [], settings: { last_seen: 'nobody', notification_preview: true }, calls: [], stickers: [], pts: 1 } })
    expect(await ca.call('sync.user', { pts: 1 })).toMatchObject({ ok: true, r: { settings: null } })
  })

  it('冷启动后 user_pts 从对话与设置两张表恢复', async () => {
    const a = await createUser()
    const b = await createUser()
    const ca = await connect(a.id)
    await ca.call('messages.send', { chat_id: privateChatId(a.id, b.id), random_id: randomId(), text: 'x' })
    await ca.call('settings.set', { last_seen: 'nobody' })
    ca.close()

    await evictDurableObject(env.USER.getByName(a.id))
    const again = await connect(a.id)
    await again.call('settings.set', { last_seen: 'everyone' })
    expect(again.updates.at(-1)).toMatchObject({ k: 'user', pts: 3 })
  })

  it('没有设置过时，冷启动后 user_pts 仍从对话表恢复', async () => {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'x' })
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'y' })
    ca.close()

    await evictDurableObject(env.USER.getByName(a.id))
    const again = await connect(a.id)
    await again.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'z' })
    expect(again.updates.at(-1)).toMatchObject({ k: 'user', pts: 3 })
  })
})

describe('上线隐私', () => {
  async function watching() {
    const a = await createUser()
    const b = await createUser()
    const chatId = privateChatId(a.id, b.id)
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    return { a, b, chatId, ca, cb }
  }

  it('对方选"没有人"：只看到大致范围，也收不到上线推送', async () => {
    const { b, chatId, ca, cb } = await watching()
    await cb.call('settings.set', { last_seen: 'nobody' })
    await cb.call('presence.update', { visible: true, viewing: [] })

    const r = await ca.call('presence.update', { visible: true, viewing: [chatId] })
    expect(r.ok && r.r.peers).toEqual([{ user_id: b.id, presence: { status: 'recently' } }])

    await cb.call('presence.update', { visible: false, viewing: [] })
    await cb.call('presence.update', { visible: true, viewing: [] })
    expect(presences(ca.events, b.id)).toEqual([])
  })

  it('对等：自己选"没有人"，也看不到别人的精确状态', async () => {
    const { chatId, ca, cb } = await watching()
    await ca.call('settings.set', { last_seen: 'nobody' })
    await cb.call('presence.update', { visible: true, viewing: [] })

    const r = await ca.call('presence.update', { visible: true, viewing: [chatId] })
    expect(r.ok && r.r.peers[0]?.presence).toEqual({ status: 'recently' })
  })

  it('大致范围按最后上线时间分档', async () => {
    const { b, chatId, ca, cb } = await watching()
    await cb.call('settings.set', { last_seen: 'nobody' })
    cb.close()
    await eventually(async () =>
      expect(await inUser(b.id, (o) => o.sql.one("SELECT 1 AS x FROM meta WHERE key = 'last_seen'"))).toBeDefined(),
    )

    const day = 24 * 60 * 60 * 1000
    for (const [ago, status] of [
      [2 * day, 'recently'],
      [5 * day, 'week'],
      [20 * day, 'month'],
      [60 * day, 'long'],
    ] as const) {
      await inUser(b.id, (o) => o.sql.run("UPDATE meta SET value = ? WHERE key = 'last_seen'", Date.now() - ago))
      const r = await ca.call('presence.update', { visible: true, viewing: [chatId] })
      expect(r.ok && r.r.peers[0]?.presence).toEqual({ status })
    }
  })
})
