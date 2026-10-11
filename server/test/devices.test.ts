import { env } from 'cloudflare:test'
import { CLOSE_REVOKED } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { LOCATION_HEADER } from '../src/user-do'
import { connect, createSession, createUser, eventually, inUser, userWrites, type Client } from './helpers'

const location = (ip: string, country: string, city: string) => ({
  [LOCATION_HEADER]: encodeURIComponent(JSON.stringify({ ip, country, city })),
})

const sessionExists = async (id: string) =>
  (await env.DIRECTORY.prepare('SELECT 1 FROM session WHERE id = ?').bind(id).first()) !== null

const deviceRow = (userId: string, id: string) =>
  inUser(userId, (o) => o.sql.one<{ id: string }>('SELECT id FROM devices WHERE id = ?', id))

describe('设备列表', () => {
  it('以未过期的 session 为准：本机在前，在前台的设备为在线，位置取自最近一次连接', async () => {
    const a = await createUser()
    const laptop = await createSession(a.id, { userAgent: 'laptop-ua' })
    const phone = await createSession(a.id, { userAgent: 'phone-ua' })
    const idle = await createSession(a.id, { ipAddress: '' })
    await createSession(a.id, { expiresAt: Date.now() - 1000 })

    const cl = await connect(a.id, laptop, location('1.1.1.1', 'CN', '上海'))
    const cp = await connect(a.id, phone, location('2.2.2.2', 'US', 'Boston'))
    await cp.call('presence.update', { visible: true, viewing: [] })

    const r = await cl.call('devices.list', {})
    if (!r.ok) throw new Error(r.e)
    expect(r.r.devices.map((d) => d.id)).toEqual([laptop, phone, idle])
    expect(r.r.devices[0]).toMatchObject({ current: true, online: false, last_active: 0, user_agent: 'laptop-ua', city: '上海' })
    expect(r.r.devices[1]).toMatchObject({ current: false, online: true, ip: '2.2.2.2', country: 'US', city: 'Boston' })
    // 从没连接过：只有登录时间，空 IP 视为没有
    expect(r.r.devices[2]).toMatchObject({ online: false, last_active: 0, ip: null, country: null })
    expect(r.r.devices[2]!.created_at).toBeGreaterThan(0)
  })

  it('断开后保留最后活跃时间与位置；后台重连且位置不变时不写库', async () => {
    const a = await createUser()
    const me = await createSession(a.id)
    const phone = await createSession(a.id)

    const first = await connect(a.id, phone, location('2.2.2.2', 'US', 'Boston'))
    await first.call('presence.update', { visible: true, viewing: [] })
    await first.call('presence.update', { visible: false, viewing: [] })
    first.close()
    await eventually(async () => expect(await deviceRow(a.id, phone)).toBeDefined())

    const cm = await connect(a.id, me)
    const before = await userWrites(a.id)
    const again = await connect(a.id, phone, location('2.2.2.2', 'US', 'Boston'))
    const disconnect = async (c: Client) => {
      c.close()
      await eventually(async () => expect(await inUser(a.id, (_o, state) => state.getWebSockets(phone).length)).toBe(0))
    }
    await disconnect(again)
    expect(await userWrites(a.id)).toBe(before)
    // 对照：同样的等待方式下，位置变了就写 1 行，说明上面的 0 行不是因为还没处理断开
    await disconnect(await connect(a.id, phone, location('3.3.3.3', 'US', 'Boston')))
    expect(await userWrites(a.id)).toBe(before + 1)

    const r = await cm.call('devices.list', {})
    if (!r.ok) throw new Error(r.e)
    const device = r.r.devices.find((d) => d.id === phone)!
    expect(device).toMatchObject({ online: false, ip: '3.3.3.3', city: 'Boston' })
    expect(device.last_active).toBeGreaterThan(0)
  })

  it('清理 session 已不存在的设备行', async () => {
    const a = await createUser()
    const me = await createSession(a.id)
    const gone = await createSession(a.id)
    const cg = await connect(a.id, gone)
    cg.close()
    await eventually(async () => expect(await deviceRow(a.id, gone)).toBeDefined())
    await env.DIRECTORY.prepare('DELETE FROM session WHERE id = ?').bind(gone).run()

    const cm = await connect(a.id, me)
    await cm.call('devices.list', {})
    expect(await deviceRow(a.id, gone)).toBeUndefined()
  })
})

describe('移除设备', () => {
  it('删除 session 并以 CLOSE_REVOKED 断开该设备；它再连上来也被立即关闭且不写库', async () => {
    const a = await createUser()
    const me = await createSession(a.id)
    const phone = await createSession(a.id)
    const cm = await connect(a.id, me)
    const cp = await connect(a.id, phone)

    expect(await cm.call('devices.revoke', { device_id: phone })).toEqual({ ok: true, r: null })
    expect((await cp.closed).code).toBe(CLOSE_REVOKED)
    expect(await sessionExists(phone)).toBe(false)

    // cookie 缓存期内仍能通过 Worker 校验的重连
    const before = await userWrites(a.id)
    const retry = await connect(a.id, phone)
    expect((await retry.closed).code).toBe(CLOSE_REVOKED)
    await new Promise((r) => setTimeout(r, 50))
    expect(await userWrites(a.id)).toBe(before)

    const r = await cm.call('devices.list', {})
    expect(r.ok && r.r.devices.map((d) => d.id)).toEqual([me])
  })

  it('不能移除本机，也不能移除别人的设备', async () => {
    const a = await createUser()
    const b = await createUser()
    const me = await createSession(a.id)
    const theirs = await createSession(b.id)
    const cm = await connect(a.id, me)

    expect(await cm.call('devices.revoke', { device_id: me })).toEqual({ ok: false, e: 'bad_request' })
    expect(await cm.call('devices.revoke', { device_id: theirs })).toEqual({ ok: false, e: 'not_found' })
    expect(await sessionExists(me)).toBe(true)
    expect(await sessionExists(theirs)).toBe(true)
  })

  it('移除所有其他设备：只保留本机，其他在线设备都被断开', async () => {
    const a = await createUser()
    const b = await createUser()
    const me = await createSession(a.id)
    const phone = await createSession(a.id)
    const tablet = await createSession(a.id)
    const theirs = await createSession(b.id)
    const cm = await connect(a.id, me)
    const cp = await connect(a.id, phone)

    const before = await userWrites(a.id)
    expect(await cm.call('devices.revokeOthers', {})).toEqual({ ok: true, r: null })
    expect((await cp.closed).code).toBe(CLOSE_REVOKED)
    expect(await sessionExists(me)).toBe(true)
    expect(await sessionExists(phone)).toBe(false)
    expect(await sessionExists(tablet)).toBe(false)
    expect(await sessionExists(theirs)).toBe(true)
    // 每台被移除的设备记 1 行移除时间；被断开的连接没有新的活跃时间或位置，不再写
    await new Promise((r) => setTimeout(r, 50))
    expect((await userWrites(a.id)) - before).toBe(2)

    const retry = await connect(a.id, tablet)
    expect((await retry.closed).code).toBe(CLOSE_REVOKED)
    expect(cm.ws.readyState).toBe(WebSocket.OPEN)
  })
})
