import { env, SELF } from 'cloudflare:test'
import { newGroupChatId, sentKey, sentPreview, type LinkPreview, type Update } from 'shared/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheKey, checkTarget, parseHead } from '../src/link-preview'
import { ownsKey } from '../src/media'
import { chatWrites, connect, createUser, eventually, inUser, login, randomId, storedPreview } from './helpers'

const PREFIX = 'test/'
const URL_TEXT = 'https://example.com/article'

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

/** 卡片图片的待发键 */
const photoKey = (userId: string) => `${PREFIX}p/${userId}/${'L'.repeat(22)}/link.webp`
const card = (userId: string): LinkPreview => ({
  type: 'web',
  title: 'An article',
  photo: { key: photoKey(userId), w: 800, h: 420, thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==' },
})

async function setup() {
  const [a, b] = await Promise.all([createUser(), createUser()])
  const [ca, cb] = await Promise.all([connect(a.id), connect(b.id)])
  const chatId = newGroupChatId()
  await ca.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [b.id] })
  return { a, b, ca, cb, chatId }
}

describe('messages.send 带链接预览', () => {
  it('纯链接消息可以带卡片，写入行数与普通消息相同；卡片图片复制到发送后的键，接收方收到同样的卡片', async () => {
    const { a, ca, cb, chatId } = await setup()
    const before = await chatWrites(chatId)
    const preview = await storedPreview(card(a.id))
    const res = await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: ` ${URL_TEXT}\n`, preview })
    expect(res.ok).toBe(true)
    expect((await chatWrites(chatId)) - before).toBe(2)
    await eventually(() => expect(newMessages(cb.updates).at(-1)).toMatchObject({ kind: 'text', preview: sentPreview(preview) }))
    expect(await env.MEDIA.head(sentKey(photoKey(a.id)))).not.toBeNull()
    await eventually(async () => expect(await env.MEDIA.head(photoKey(a.id))).toBeNull())

    // 没抓到也是一张卡片：只有域名
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'http://example.com', preview: { type: 'web', title: null } })
    await eventually(() => expect(newMessages(cb.updates).at(-1)).toMatchObject({ preview: { type: 'web', title: null } }))
  })

  it('不是纯链接、图片不是自己上传的或已经发送过、邀请卡片不指向本站的邀请链接都被拒绝', async () => {
    const { b, ca, chatId } = await setup()
    const send = (text: string, preview: LinkPreview) => ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text, preview })
    expect(await send(`look ${URL_TEXT}`, { type: 'web', title: null })).toEqual({ ok: false, e: 'bad_request' })
    expect(await send('ftp://example.com', { type: 'web', title: null })).toEqual({ ok: false, e: 'bad_request' })
    expect(await send(URL_TEXT, card(b.id))).toEqual({ ok: false, e: 'bad_request' })
    expect(await send(URL_TEXT, sentPreview(card(b.id)))).toEqual({ ok: false, e: 'bad_request' })

    const invite: LinkPreview = { type: 'invite', title: 'Team', member_count: 3 }
    const code = `${'A'.repeat(22)}.${'B'.repeat(22)}`
    expect(await send(`https://evil.example/join/${code}`, invite)).toEqual({ ok: false, e: 'bad_request' })
    expect(await send('http://localhost:5173/join/nope', invite)).toEqual({ ok: false, e: 'bad_request' })
    expect(await send(`http://localhost:5173/join/${code}`, invite)).toMatchObject({ ok: true })
  })

  it('卡片图片过期被删：返回 media_expired，不写消息', async () => {
    const { a, ca, chatId } = await setup()
    const before = await chatWrites(chatId)
    expect(await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: URL_TEXT, preview: card(a.id) })).toEqual({
      ok: false,
      e: 'media_expired',
    })
    expect(await chatWrites(chatId)).toBe(before)
  })
})

describe('编辑与撤回', () => {
  it('编辑后链接没变则保留卡片，改成别的则去掉卡片并删除图片', async () => {
    const { a, ca, chatId } = await setup()
    const preview = await storedPreview(card(a.id))
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: URL_TEXT, preview })

    await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: `${URL_TEXT} ` })
    let got = await ca.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ preview: sentPreview(preview) })
    expect(await env.MEDIA.head(sentKey(photoKey(a.id)))).not.toBeNull()

    await ca.call('messages.edit', { chat_id: chatId, seq: 2, text: 'https://example.com/other' })
    got = await ca.call('messages.get', { chat_id: chatId, seqs: [2] })
    expect(got.ok && got.r.messages[0]).not.toHaveProperty('preview')
    await eventually(async () => expect(await env.MEDIA.head(sentKey(photoKey(a.id)))).toBeNull())
  })

  it('撤回时卡片图片一并删除', async () => {
    const { a, ca, chatId } = await setup()
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: URL_TEXT, preview: await storedPreview(card(a.id)) })
    await ca.call('messages.recall', { chat_id: chatId, seq: 2 })
    await eventually(async () => expect(await env.MEDIA.head(sentKey(photoKey(a.id)))).toBeNull())
  })
})

describe('messages.forward', () => {
  it('转发时复制卡片图片到转发者名下', async () => {
    const { a, b, ca, cb, chatId } = await setup()
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: URL_TEXT, preview: await storedPreview(card(a.id)) })
    const copies: [string, string][] = []
    await inUser(b.id, (o) => {
      o.copyObject = async (src, dst) => {
        copies.push([src, dst])
        return true
      }
    })
    const res = await cb.call('messages.forward', { from_chat_id: chatId, seq: 2, to_chat_id: chatId, random_id: randomId() })
    expect(res.ok).toBe(true)
    expect(copies.map(([src]) => src)).toEqual([sentKey(photoKey(a.id))])
    expect(ownsKey(copies[0]![1], PREFIX, b.id, 'm')).toBe(true)
    const got = await cb.call('messages.get', { chat_id: chatId, seqs: [3] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ preview: { type: 'web', title: 'An article', photo: { key: copies[0]![1] } } })
  })
})

describe('checkTarget', () => {
  const ok = (url: string) => checkTarget(url, 'chat.jaze.top')?.href ?? null
  it('只允许 https 与默认端口的公网域名', () => {
    expect(ok('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(ok('http://example.com')).toBeNull()
    expect(ok('https://example.com:8443/')).toBeNull()
    expect(ok('https://user:pw@example.com/')).toBeNull()
    expect(ok('javascript:alert(1)')).toBeNull()
    expect(ok('not a url')).toBeNull()
  })
  it('拒绝 IP 字面量、本机与内网域名、单段主机名和应用自己的域名', () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://[::1]/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://localhost/',
      'https://foo.localhost/',
      'https://printer.local/',
      'https://db.internal/',
      'https://intranet/',
      'https://chat.jaze.top/join/x',
      'https://r2.chat.jaze.top/m/x',
    ]) {
      expect(ok(url), url).toBeNull()
    }
  })
})

describe('parseHead', () => {
  const parse = (html: string, base = 'https://example.com/a/b') =>
    parseHead(new Response(html, { headers: { 'Content-Type': 'text/html' } }), new URL(base))

  it('og 标签优先，图片地址解析为绝对地址，实体解码', async () => {
    expect(
      await parse(`<html><head><title>Plain</title>
        <meta property="og:title" content="Tom &amp; Jerry &#8212; &quot;Hi&quot;">
        <meta property="og:image" content="/img/cover.png"></head><body>x</body></html>`),
    ).toEqual({ title: 'Tom & Jerry — "Hi"', image: 'https://example.com/img/cover.png' })
  })

  it('没有 og 标签时用 twitter 标签与 <title>；只保留 https 的图片', async () => {
    expect(
      await parse(`<head><title>
        Some   page </title><meta name="twitter:image" content="http://cdn.example.com/x.jpg"></head>`),
    ).toEqual({ title: 'Some page', image: null })
    expect(await parse('<head><meta name="twitter:title" content="T"></head>')).toEqual({ title: 'T', image: null })
  })

  it('<body> 里的标签不算；什么都没有时都为 null', async () => {
    expect(await parse('<head></head><body><meta property="og:title" content="late"><title>late</title></body>')).toEqual({
      title: null,
      image: null,
    })
    expect(await parse('')).toEqual({ title: null, image: null })
  })
})

describe('POST /api/link-preview', () => {
  const origin = 'http://localhost:5173'
  const call = (path: string, url: string, headers: Record<string, string>) =>
    SELF.fetch(`${origin}/api/link-preview${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ url }),
    })
  afterEach(() => vi.restoreAllMocks())

  it('要求本站 Origin 与登录会话', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    for (const path of ['', '/image']) {
      expect((await call(path, URL_TEXT, { Origin: 'https://evil.example', Cookie: cookie })).status).toBe(403)
      expect((await call(path, URL_TEXT, { Origin: origin })).status).toBe(401)
    }
  })

  it('抓到的结果进缓存；超时、错误状态等临时失败不缓存', async () => {
    const me = await createUser()
    const h = { Origin: origin, Cookie: (await login(me.id)).cookie }
    const page = new URL(`https://news.example.com/${crypto.randomUUID()}`)
    const failing = new URL(`https://news.example.com/${crypto.randomUUID()}`)
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const href = input instanceof Request ? input.url : String(input)
      if (href === page.href) {
        return new Response('<head><meta property="og:title" content="Hello"></head>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (href === failing.href) return new Response('busy', { status: 503 })
      return real(input, init)
    })

    expect(await (await call('', page.href, h)).json()).toEqual({ title: 'Hello', image: null })
    expect(await (await call('', failing.href, h)).json()).toEqual({ title: null, image: null })
    await eventually(async () => expect(await caches.default.match(cacheKey(page))).toBeDefined())
    expect(await caches.default.match(cacheKey(failing))).toBeUndefined()
  })
})
