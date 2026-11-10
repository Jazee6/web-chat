// 根地址的分流：已登录返回应用外壳，否则返回介绍页。见 ADR-0015
import type { Context } from 'hono'

/**
 * 「登录过」的标记 cookie。会话 cookie 是 SameSite=Strict，从别的站点点进来（搜索结果、跨站 IdP 回调后的跳转）时不会发出，
 * 只看它会把已登录的人送到介绍页；标记是 Lax，跨站的顶层导航也带着。它不是凭据，只决定发哪份静态 HTML：
 * 标记还在而会话已失效时，外壳照常发现未登录并去登录
 */
export const SIGNED_IN_COOKIE = 'signed_in'
/** 与会话有效期（auth/options.ts 的 expiresIn）一致；会话每次续期都重新写一次 */
const SIGNED_IN_MAX_AGE = 60 * 60 * 24 * 60

/** better-auth 的会话 cookie，https 下带 __Secure- 前缀 */
const SESSION_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token']
const SESSION_COOKIE = /^(?:__Secure-)?better-auth\.session_token=([^;]*)/

/** 英文介绍页构建在 /en（en.html），只经这里发出；直接访问时跳回根地址，免得出现两个地址 */
const LANDING_EN = '/en'

/** 请求的 cookie 里有没有某个名字 */
function hasCookie(header: string | undefined, name: string): boolean {
  return !!header && header.split(';').some((part) => part.trimStart().startsWith(`${name}=`))
}

/** 根地址该发外壳还是介绍页。`?shell`：Service Worker 预缓存外壳时用，那时可能还没登录 */
export function wantsShell(url: URL, cookie: string | undefined): boolean {
  if (url.searchParams.has('shell')) return true
  return [SIGNED_IN_COOKIE, ...SESSION_NAMES].some((name) => hasCookie(cookie, name))
}

/** 标记 cookie 的属性；secure 跟随请求的协议 */
function signedInCookie(signedIn: boolean, secure: boolean): string {
  const attrs = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
  return signedIn ? `${SIGNED_IN_COOKIE}=1; Max-Age=${SIGNED_IN_MAX_AGE}; ${attrs}` : `${SIGNED_IN_COOKIE}=; Max-Age=0; ${attrs}`
}

/** GET / */
export async function serveRoot(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url)
  const cookie = c.req.header('Cookie')
  const path = wantsShell(url, cookie) ? '/' : LANDING_EN
  const res = await c.env.ASSETS.fetch(new Request(new URL(path, url), c.req.raw))
  const out = new Response(res.body, res)
  // 同一个地址按 cookie 有两种内容
  out.headers.set('Cache-Control', 'private, no-cache')
  out.headers.append('Vary', 'Cookie')
  // 有会话却没有标记（标记出现之前就登录了）：补上，免得要等会话续期
  if (!hasCookie(cookie, SIGNED_IN_COOKIE) && SESSION_NAMES.some((name) => hasCookie(cookie, name))) {
    out.headers.append('Set-Cookie', signedInCookie(true, url.protocol === 'https:'))
  }
  return out
}

/** GET /en */
export function redirectLandingEn(c: Context): Response {
  return c.redirect('/', 301)
}

/**
 * better-auth 的响应设置会话 cookie 时同时设置标记，清除会话 cookie（退出登录）时一并清除。
 * 原响应的 header 可能是只读的（重定向），复制一份再改
 */
export function mirrorSignedIn(res: Response, secure: boolean): Response {
  let signedIn: boolean | null = null
  for (const line of res.headers.getSetCookie()) {
    const m = SESSION_COOKIE.exec(line)
    if (!m) continue
    signedIn = m[1] !== '' && !/;\s*max-age=0(?:;|$)/i.test(line)
  }
  if (signedIn === null) return res
  const out = new Response(res.body, res)
  out.headers.append('Set-Cookie', signedInCookie(signedIn, secure))
  return out
}
