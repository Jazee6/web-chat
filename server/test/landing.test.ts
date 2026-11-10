import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { mirrorSignedIn, SIGNED_IN_COOKIE, wantsShell } from '../src/landing'
import { createUser, login } from './helpers'

const root = new URL('http://localhost:5173/')

describe('根地址分流', () => {
  it('没有 cookie 时发介绍页', () => {
    expect(wantsShell(root, undefined)).toBe(false)
    expect(wantsShell(root, 'theme=dark; other=1')).toBe(false)
  })

  it('有标记或会话 cookie 时发外壳', () => {
    expect(wantsShell(root, `${SIGNED_IN_COOKIE}=1`)).toBe(true)
    expect(wantsShell(root, 'a=1; better-auth.session_token=x.y')).toBe(true)
    expect(wantsShell(root, '__Secure-better-auth.session_token=x.y')).toBe(true)
    // 名字只是包含时不算
    expect(wantsShell(root, 'not_signed_in=1')).toBe(false)
  })

  it('?shell 总是发外壳（Service Worker 预缓存）', () => {
    expect(wantsShell(new URL('/?shell', root), undefined)).toBe(true)
  })

  it('/en 跳回根地址，不依赖必填配置', async () => {
    const res = await SELF.fetch('http://localhost:5173/en', { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(new URL(res.headers.get('Location')!, root).pathname).toBe('/')
  })
})

describe('/.well-known', () => {
  it('没有的文件返回 404，而不是 SPA 的 HTML', async () => {
    const res = await SELF.fetch('http://localhost:5173/.well-known/ai-catalog.json')
    expect(res.status).toBe(404)
  })
})

describe('标记 cookie 跟随会话 cookie', () => {
  const marker = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SIGNED_IN_COOKIE}=`))

  it('设置会话时一并设置 Lax 标记', () => {
    const res = mirrorSignedIn(
      new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': '__Secure-better-auth.session_token=abc.sig; Max-Age=5184000; Path=/; HttpOnly; Secure; SameSite=Strict' } }),
      true,
    )
    expect(res.status).toBe(302)
    expect(marker(res)).toMatch(/^signed_in=1; Max-Age=\d+; Path=\/; SameSite=Lax; Secure$/)
  })

  it('清除会话时一并清除标记', () => {
    const res = mirrorSignedIn(
      Response.json({ success: true }, { headers: { 'Set-Cookie': 'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' } }),
      false,
    )
    expect(marker(res)).toBe('signed_in=; Max-Age=0; Path=/; SameSite=Lax')
  })

  it('真实的退出登录清除标记，会话 cookie 的名字与这里认的一致', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    expect(wantsShell(root, cookie)).toBe(true)
    const res = await SELF.fetch('http://localhost:5173/api/auth/sign-out', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(marker(res)).toBe('signed_in=; Max-Age=0; Path=/; SameSite=Lax')
  })

  it('没有动会话 cookie 的响应原样返回', () => {
    const original = Response.json({ ok: true }, { headers: { 'Set-Cookie': 'better-auth.state=x; Path=/' } })
    expect(mirrorSignedIn(original, true)).toBe(original)
  })
})
