// 链接预览：发送方输入纯链接时，Worker 替它抓取网页的标题与 og:image，并取回图片交给它压缩上传。
// 接收方从不访问那个网站。见 docs/architecture/05-media.md § 链接预览
import { Hono } from 'hono'
import * as v from 'valibot'
import { LinkPreviewRequest, MAX_LINK_TITLE_LENGTH, type LinkMeta } from 'shared/protocol'
import { requestIdentity } from './auth'

/** 只读网页开头这么多字节：标题与 og 标签都在 <head> 里 */
const HTML_BYTES = 256 * 1024
/** 卡片图片的原图上限，客户端会再压缩 */
const IMAGE_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 4000
/** 抓取结果在 Cache API 里保留的时间；没抓到的保留短一些 */
const CACHE_TTL_S = 24 * 60 * 60
const MISS_TTL_S = 60 * 60
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
const USER_AGENT = 'Mozilla/5.0 (compatible; WebChatLinkPreview/1.0)'

/**
 * 能不能替用户抓取这个地址：只允许 https 与默认端口，拒绝 IP 字面量、本机与内网的保留域名、单段主机名，
 * 以及应用自己的域名（含子域名，例如媒体域名）。只看地址本身，DNS 解析到哪里由 Cloudflare 的出站网络负责
 */
export function checkTarget(raw: string, appHost: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[') || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return null
  if (!host.includes('.')) return null
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa|invalid|test|example)$/.test(host)) return null
  if (host === appHost || host.endsWith(`.${appHost}`)) return null
  return url
}

/** 逐跳跟随重定向，每一跳都重新检查；返回最终的响应与地址 */
async function safeFetch(start: URL, appHost: string, accept: string): Promise<{ res: Response; url: URL } | null> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status < 300 || res.status >= 400) return res.ok ? { res, url } : null
    await res.body?.cancel()
    const next = res.headers.get('Location')
    const checked = next ? checkTarget(new URL(next, url).href, appHost) : null
    if (!checked) return null
    url = checked
  }
  return null
}

/** 截断到前 limit 个字节；超过 limit 时 truncated 变为 true */
function capped(body: ReadableStream<Uint8Array>, limit: number) {
  let seen = 0
  const state = { truncated: false }
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (state.truncated) return
        const room = limit - seen
        if (chunk.byteLength > room) {
          controller.enqueue(chunk.subarray(0, room))
          state.truncated = true
          controller.terminate()
          return
        }
        seen += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  return { stream, state }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** HTMLRewriter 给出的文字与属性值都没有解码实体 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function cleanTitle(s: string | null): string | null {
  if (!s) return null
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, MAX_LINK_TITLE_LENGTH) : null
}

/**
 * 从网页的 <head> 里抽取标题与图片：og:title 优先于 twitter:title 与 <title>，og:image 优先于 twitter:image。
 * 图片地址按最终地址解析成绝对地址，只保留 https 的
 */
export async function parseHead(html: Response, base: URL): Promise<LinkMeta> {
  const found: Record<string, string> = {}
  let titleText = ''
  let inTitle = false
  let headDone = false
  const meta = (key: string) => ({
    element(el: Element) {
      if (headDone) return
      const value = el.getAttribute('content')
      if (value && !(key in found)) found[key] = value
    },
  })
  const rewritten = new HTMLRewriter()
    .on('meta[property="og:title"]', meta('og:title'))
    .on('meta[name="twitter:title"]', meta('twitter:title'))
    .on('meta[property="og:image"]', meta('og:image'))
    .on('meta[property="og:image:url"]', meta('og:image'))
    .on('meta[property="og:image:secure_url"]', meta('og:image'))
    .on('meta[name="twitter:image"]', meta('twitter:image'))
    .on('title', {
      element(el) {
        if (headDone || titleText) return
        inTitle = true
        el.onEndTag(() => {
          inTitle = false
        })
      },
      text(chunk) {
        if (inTitle) titleText += chunk.text
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag(() => {
          headDone = true
        })
      },
    })
    .on('body', {
      element() {
        headDone = true
      },
    })
    .transform(html)

  // <head> 结束就不再读剩下的部分
  const reader = rewritten.body!.getReader()
  while (!headDone) {
    const { done } = await reader.read()
    if (done) break
  }
  await reader.cancel().catch(() => {})

  const imageRaw = found['og:image'] ?? found['twitter:image'] ?? null
  let image: string | null = null
  if (imageRaw) {
    try {
      const url = new URL(decodeEntities(imageRaw).trim(), base)
      if (url.protocol === 'https:') image = url.href
    } catch {
      // 地址不合法：当作没有图
    }
  }
  return { title: cleanTitle(found['og:title'] ?? found['twitter:title'] ?? titleText), image }
}

/**
 * 抓取一个网页的标题与图片地址。拿到了网页（哪怕不是 HTML、什么都没抽到）返回结果，可以缓存；
 * 超时、网络错误、对方返回错误状态（例如 429、503）或重定向到不允许的地址时抛出，不缓存，下次再试
 */
async function fetchMeta(url: URL, appHost: string): Promise<LinkMeta> {
  const got = await safeFetch(url, appHost, 'text/html,application/xhtml+xml')
  if (!got) throw new Error('fetch failed')
  const contentType = got.res.headers.get('Content-Type') ?? ''
  const type = contentType.split(';')[0]?.trim().toLowerCase()
  if ((type !== 'text/html' && type !== 'application/xhtml+xml') || !got.res.body) {
    await got.res.body?.cancel()
    return { title: null, image: null }
  }
  const { stream } = capped(got.res.body, HTML_BYTES)
  // 原样带上 Content-Type：HTMLRewriter 按其中的 charset 解码（例如 GBK 的中文网站）
  return parseHead(new Response(stream, { headers: { 'Content-Type': contentType } }), got.url)
}

/** Cache API 的键：去掉 #片段，其余保持原样 */
export function cacheKey(url: URL) {
  const u = new URL(url)
  u.hash = ''
  return new Request(`https://link-preview.cache/?url=${encodeURIComponent(u.href)}`)
}

export const linkPreview = new Hono<{ Bindings: Env }>()

// 与 /api/media 相同：只接受本站发起的请求，身份沿用 cookie 缓存校验
linkPreview.use(async (c, next) => {
  if (c.req.header('Origin') !== new URL(c.env.BETTER_AUTH_URL).origin) return c.text('forbidden', 403)
  if (!(await requestIdentity(c.req.raw.headers))) return c.text('unauthorized', 401)
  await next()
})

linkPreview.post('/', async (c) => {
  const body = v.safeParse(LinkPreviewRequest, await c.req.json().catch(() => null))
  if (!body.success) return c.text('bad request', 400)
  const appHost = new URL(c.env.BETTER_AUTH_URL).hostname
  const url = checkTarget(body.output.url, appHost)
  if (!url) return c.json({ title: null, image: null } satisfies LinkMeta)

  const key = cacheKey(url)
  const cached = await caches.default.match(key)
  if (cached) return c.json((await cached.json()) as LinkMeta)

  let meta: LinkMeta
  try {
    meta = await fetchMeta(url, appHost)
  } catch (e) {
    // 临时失败不缓存：否则一次超时会让所有人一小时内都只看到域名
    console.error('link preview failed', { error: String(e) })
    return c.json({ title: null, image: null } satisfies LinkMeta)
  }
  const ttl = meta.title || meta.image ? CACHE_TTL_S : MISS_TTL_S
  c.executionCtx.waitUntil(
    caches.default.put(key, new Response(JSON.stringify(meta), { headers: { 'Cache-Control': `max-age=${ttl}` } })),
  )
  return c.json(meta)
})

/** 取回卡片图片：只接受常见的位图格式；内容从不在本站直接显示，响应头也禁止浏览器把它当成别的东西 */
linkPreview.post('/image', async (c) => {
  const body = v.safeParse(LinkPreviewRequest, await c.req.json().catch(() => null))
  if (!body.success) return c.text('bad request', 400)
  const url = checkTarget(body.output.url, new URL(c.env.BETTER_AUTH_URL).hostname)
  if (!url) return c.text('forbidden', 403)

  let got: Awaited<ReturnType<typeof safeFetch>>
  try {
    got = await safeFetch(url, new URL(c.env.BETTER_AUTH_URL).hostname, 'image/*')
  } catch {
    return c.text('bad gateway', 502)
  }
  if (!got?.res.body) return c.text('not found', 404)
  const type = got.res.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const length = Number(got.res.headers.get('Content-Length') ?? 0)
  if (!IMAGE_TYPES.has(type) || length > IMAGE_BYTES) {
    await got.res.body.cancel()
    return c.text('unsupported', 415)
  }
  const { stream, state } = capped(got.res.body, IMAGE_BYTES + 1)
  const bytes = await new Response(stream).arrayBuffer()
  if (state.truncated || bytes.byteLength > IMAGE_BYTES) return c.text('too large', 413)
  return c.body(bytes, 200, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  })
})
