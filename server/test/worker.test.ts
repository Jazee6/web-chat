import { SELF } from 'cloudflare:test'
import { CLOSE_OUTDATED, PROTOCOL_VERSION, privateChatId, type ServerFrame } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { createUser, login } from './helpers'

const origin = 'http://localhost:5173'
const wsUrl = `${origin}/ws?v=${PROTOCOL_VERSION}`

describe('/ws 升级', () => {
  it('非 WebSocket 请求返回 426', async () => {
    expect((await SELF.fetch(wsUrl)).status).toBe(426)
  })

  it('Origin 不一致返回 403', async () => {
    const res = await SELF.fetch(wsUrl, { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  it('协议版本不一致时不鉴权，接受后立即以 CLOSE_OUTDATED 关闭', async () => {
    for (const url of [`${origin}/ws`, `${origin}/ws?v=${PROTOCOL_VERSION + 1}`]) {
      const res = await SELF.fetch(url, { headers: { Upgrade: 'websocket', Origin: origin } })
      expect(res.status).toBe(101)
      const ws = res.webSocket!
      const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))
      ws.accept()
      expect(await closed).toBe(CLOSE_OUTDATED)
    }
  })

  it('没有会话返回 401，伪造的身份 header 无效', async () => {
    const res = await SELF.fetch(wsUrl, {
      headers: { Upgrade: 'websocket', Origin: origin, 'X-Chat-User-Id': 'someone', 'X-Chat-Device-Id': 'd' },
    })
    expect(res.status).toBe(401)
  })

  it('有效会话升级成功，身份取自 session 而不是客户端 header', async () => {
    const me = await createUser()
    const peer = await createUser()
    const { cookie } = await login(me.id)
    const res = await SELF.fetch(wsUrl, {
      headers: { Upgrade: 'websocket', Origin: origin, Cookie: cookie, 'X-Chat-User-Id': 'forged' },
    })
    expect(res.status).toBe(101)

    const ws = res.webSocket!
    ws.accept()
    const reply = new Promise<ServerFrame>((resolve) =>
      ws.addEventListener('message', (e) => {
        const frame = JSON.parse(e.data as string) as ServerFrame
        if (frame.t === 'res') resolve(frame)
      }),
    )
    // 只有会话参与者才能发送；若身份被伪造成 'forged' 会返回 forbidden
    const chat_id = privateChatId(me.id, peer.id)
    ws.send(JSON.stringify({ t: 'req', id: 1, m: 'messages.send', p: { chat_id, random_id: 1, text: 'hi' } }))
    expect(await reply).toMatchObject({ t: 'res', id: 1, ok: true, r: { seq: 1 } })
    ws.close()
  })

  it('只带 cookie 缓存也能升级（不经过 better-auth）；篡改过的缓存被拒绝', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    // get-session 从库里取到会话后下发 compact 策略的 session_data cookie
    const res = await SELF.fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie, Origin: origin } })
    const cached = res.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_data='))!.split(';')[0]!
    expect(cached).toBeDefined()

    const upgrade = (c: string) => SELF.fetch(wsUrl, { headers: { Upgrade: 'websocket', Origin: origin, Cookie: c } })
    const ok = await upgrade(cached)
    expect(ok.status).toBe(101)
    ok.webSocket!.accept()
    ok.webSocket!.close()

    // 改动载荷中的用户 ID：签名不再匹配，又没有 session_token 可退回，只能 401
    const [name, value] = cached.split('=') as [string, string]
    const payload = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as { session: { user: { id: string } } }
    payload.session.user.id = 'forged'
    const forged = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect((await upgrade(`${name}=${forged}`)).status).toBe(401)
  })
})
