import { env, SELF } from 'cloudflare:test'
import {
  MAX_VOICE_BYTES,
  newGroupChatId,
  privateChatId,
  sentKey,
  sentMedia,
  type MediaFile,
  type Photo,
  type UploadResponse,
  type Update,
  type Video,
  type Voice,
} from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { ownsKey, safeName } from '../src/media'
import { chatWrites, connect, createUser, eventually, inUser, login, randomId, stored, userWrites } from './helpers'

const origin = 'http://localhost:5173'
const PREFIX = 'test/'

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

/** 与服务端 newKey 格式一致的待发键 */
const key = (userId: string, name = 'photo.webp') => `${PREFIX}p/${userId}/${'A'.repeat(21)}${Math.floor(Math.random() * 10)}/${name}`

const photo = (userId: string): Photo => ({
  type: 'photo',
  key: key(userId),
  preview_key: key(userId, 'preview.webp'),
  w: 1600,
  h: 1200,
  size: 1000,
  thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
})

const file = (userId: string): MediaFile => ({
  type: 'file',
  key: key(userId, 'report.pdf'),
  name: '报告.pdf',
  mime: 'application/pdf',
  size: 5000,
})

const video = (userId: string): Video => {
  const k = key(userId, 'video.mp4')
  return {
    type: 'video',
    key: k,
    preview_key: k.replace(/video\.mp4$/, 'preview.webp'),
    w: 720,
    h: 1280,
    size: 9000,
    duration: 42,
    thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  }
}

/** 64 字节的波形 */
const WAVEFORM = btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, i) => i * 4)))

const voice = (userId: string): Voice => ({
  type: 'voice',
  key: key(userId, 'voice.webm'),
  mime: 'audio/webm',
  size: 40000,
  duration: 12,
  waveform: WAVEFORM,
})

async function pair() {
  const a = await createUser()
  const b = await createUser()
  return { a, b, chatId: privateChatId(a.id, b.id) }
}

describe('messages.sendMedia', () => {
  it('相册：对方收到媒体消息，对话摘要只给出图片数；写入与文本消息相同', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(1))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const album = await stored([photo(a.id), photo(a.id), photo(a.id)])
    const res = await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: album, reply_to: 1 })
    expect(res).toMatchObject({ ok: true, r: { seq: 2 } })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(2))

    expect(newMessages(cb.updates)[1]).toMatchObject({ kind: 'media', media: sentMedia(album), reply_to: 1 })
    expect(cb.updates.at(-1)).toMatchObject({
      k: 'user',
      ev: { dialog: { top_seq: 2, top_preview: { kind: 'album', count: 3, sender_id: a.id } } },
    })
    // ChatDO：messages + messages_by_pts；双方 dialog 各 1 行
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)

    const history = await cb.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages[1]).toMatchObject({ kind: 'media', media: sentMedia(album), reply_to: 1 })
  })

  it('视频与混排的相册：对话摘要给出视频数，只有一个视频时给出时长；写入与图片相册相同', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(1))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const v = video(a.id)
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([v]) })).toMatchObject({ ok: true })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(2))
    expect(newMessages(cb.updates)[1]).toMatchObject({ kind: 'media', media: sentMedia([v]) })
    expect(cb.updates.at(-1)).toMatchObject({
      k: 'user',
      ev: { dialog: { top_preview: { kind: 'album', count: 1, videos: 1, duration: 42 } } },
    })
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)

    const mixed = await stored([photo(a.id), video(a.id), photo(a.id)])
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: mixed })).toMatchObject({ ok: true })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(3))
    expect(newMessages(cb.updates)[2]).toMatchObject({ kind: 'media', media: sentMedia(mixed) })
    // 混排时不给时长
    await eventually(() =>
      expect(cb.updates.at(-1)).toMatchObject({ k: 'user', ev: { dialog: { top_seq: 3, top_preview: { kind: 'album', count: 3, videos: 1 } } } }),
    )
    expect(cb.updates.at(-1)).not.toHaveProperty('ev.dialog.top_preview.duration')
  })

  it('拒绝封面属于别人、尺寸超过 1280、时长或格式不对的视频，以及和文件混发', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const send = (media: never) => ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media })
    const bad = { ok: false, e: 'bad_request' }
    const v = video(a.id)

    expect(await send([{ ...v, preview_key: key(b.id, 'preview.webp') }] as never)).toEqual(bad)
    expect(await send([{ ...v, key: key(b.id, 'video.mp4') }] as never)).toEqual(bad)
    expect(await send([{ ...v, w: 1281 }] as never)).toEqual(bad)
    expect(await send([{ ...v, duration: 0 }] as never)).toEqual(bad)
    expect(await send([{ ...v, duration: 2.5 }] as never)).toEqual(bad)
    expect(await send([{ ...v, size: 20 * 1024 * 1024 + 1 }] as never)).toEqual(bad)
    expect(await send([v, file(a.id)] as never)).toEqual(bad)
    expect(await send(Array.from({ length: 11 }, () => video(a.id)) as never)).toEqual(bad)
  })

  it('文件消息：对话摘要给出文件名', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const f = file(a.id)
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([f]) })).toMatchObject({ ok: true })
    await eventually(() =>
      expect(ca.updates.at(-1)).toMatchObject({ k: 'user', ev: { dialog: { top_preview: { kind: 'file', name: '报告.pdf' } } } }),
    )
  })

  it('语音消息：对话摘要与置顶摘要给出时长；写入与文件消息相同', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([file(a.id)]) })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(1))

    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const v = voice(a.id)
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([v]) })).toMatchObject({
      ok: true,
      r: { seq: 2 },
    })
    await eventually(() => expect(newMessages(cb.updates)).toHaveLength(2))
    expect(newMessages(cb.updates)[1]).toMatchObject({ kind: 'media', media: sentMedia([v]) })
    expect(cb.updates.at(-1)).toMatchObject({ k: 'user', ev: { dialog: { top_preview: { kind: 'voice', duration: 12 } } } })
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)

    await ca.call('messages.pin', { chat_id: chatId, random_id: randomId(), seq: 2 })
    await eventually(() =>
      expect(newMessages(cb.updates).at(-1)).toMatchObject({
        kind: 'service',
        action: { type: 'message_pin', seq: 2, excerpt: { kind: 'voice', duration: 12 } },
      }),
    )
  })

  it('拒绝时长、波形、格式或大小不对的语音，以及和别的媒体混发', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const send = (media: never) => ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media })
    const bad = { ok: false, e: 'bad_request' }
    const v = voice(a.id)

    expect(await send([{ ...v, duration: 301 }] as never)).toEqual(bad)
    expect(await send([{ ...v, duration: 0 }] as never)).toEqual(bad)
    expect(await send([{ ...v, duration: 1.5 }] as never)).toEqual(bad)
    expect(await send([{ ...v, waveform: btoa('short') }] as never)).toEqual(bad)
    expect(await send([{ ...v, mime: 'audio/ogg' }] as never)).toEqual(bad)
    expect(await send([{ ...v, size: MAX_VOICE_BYTES + 1 }] as never)).toEqual(bad)
    expect(await send([v, voice(a.id)] as never)).toEqual(bad)
    expect(await send([v, photo(a.id)] as never)).toEqual(bad)
    expect(await send([{ ...v, key: key(`${a.id}x`, 'voice.webm') }] as never)).toEqual(bad)
  })

  it('拒绝别人上传的对象、已发送的对象、格式不对的键、图片与文件混发、超过 10 张的相册', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const send = (media: never) => ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media })
    const bad = { ok: false, e: 'bad_request' }

    expect(await send([photo(b.id)] as never)).toEqual(bad)
    expect(await send([{ ...photo(a.id), preview_key: key(b.id) }] as never)).toEqual(bad)
    // 已发送的对象不能再发一次：两条消息共用一个对象时，撤回一条会删掉另一条的媒体
    expect(await send([{ ...photo(a.id), key: sentKey(key(a.id)) }] as never)).toEqual(bad)
    // 前缀相同但不是同一个用户：user_id 之后必须紧跟 /
    expect(await send([{ ...photo(a.id), key: `${PREFIX}p/${a.id}x/${'A'.repeat(22)}/photo.webp` }] as never)).toEqual(bad)
    expect(await send([{ ...photo(a.id), key: `${PREFIX}p/${a.id}/short/photo.webp` }] as never)).toEqual(bad)
    expect(await send([{ ...photo(a.id), key: `${PREFIX}p/${a.id}/${'A'.repeat(22)}/..` }] as never)).toEqual(bad)
    expect(await send([photo(a.id), file(a.id)] as never)).toEqual(bad)
    expect(await send([file(a.id), file(a.id)] as never)).toEqual(bad)
    expect(await send(Array.from({ length: 11 }, () => photo(a.id)) as never)).toEqual(bad)
  })

  it('撤回视频时删除视频与封面', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const v = video(a.id)
    await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([v]) })
    expect(await env.MEDIA.head(sentKey(v.key))).not.toBeNull()
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 1 })).toEqual({ ok: true, r: null })
    await eventually(async () => {
      expect(await env.MEDIA.head(sentKey(v.key))).toBeNull()
      expect(await env.MEDIA.head(sentKey(v.preview_key))).toBeNull()
    })
  })

  it('撤回语音消息时删除录音', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const v = voice(a.id)
    await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: await stored([v]) })
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 1 })).toEqual({ ok: true, r: null })
    await eventually(async () => expect(await env.MEDIA.head(sentKey(v.key))).toBeNull())
  })

  it('撤回媒体消息：内容清空并删除对象；媒体消息不能编辑', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    const album = await stored([photo(a.id), photo(a.id)])
    const keys = album.flatMap((p) => [sentKey(p.key), sentKey(p.preview_key)])

    await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: album })
    expect(await ca.call('messages.edit', { chat_id: chatId, seq: 1, text: 'x' })).toEqual({ ok: false, e: 'bad_request' })

    const before = await chatWrites(chatId)
    expect(await ca.call('messages.recall', { chat_id: chatId, seq: 1 })).toEqual({ ok: true, r: null })
    expect((await chatWrites(chatId)) - before).toBe(2)
    await eventually(() =>
      expect(cb.updates.some((u) => u.k === 'chat' && u.ev.type === 'update_message' && u.ev.message.kind === 'recalled')).toBe(true),
    )
    await eventually(async () => {
      for (const k of keys) expect(await env.MEDIA.head(k)).toBeNull()
    })
  })
})

describe('发送时复制待发对象', () => {
  const exists = async (key: string) => (await env.MEDIA.head(key)) !== null

  it('复制到发送后的键，写入后删除待发对象；写入与以前相同', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    const before = { chat: await chatWrites(chatId), a: await userWrites(a.id), b: await userWrites(b.id) }
    const p = (await stored([photo(a.id)]))[0]!
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: [p] })).toMatchObject({ ok: true })
    expect(await exists(sentKey(p.key))).toBe(true)
    expect(await exists(sentKey(p.preview_key))).toBe(true)
    await eventually(async () => {
      expect(await exists(p.key)).toBe(false)
      expect(await exists(p.preview_key)).toBe(false)
    })
    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    expect((await userWrites(a.id)) - before.a).toBe(1)
    expect((await userWrites(b.id)) - before.b).toBe(1)
  })

  it('确认丢了的重放：待发对象已经删了，发送后的键还在，返回原来的结果、不再写入', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const media = await stored([voice(a.id)])
    const rid = randomId()
    const first = await ca.call('messages.sendMedia', { chat_id: chatId, random_id: rid, media })
    expect(first).toMatchObject({ ok: true })
    await eventually(async () => expect(await exists(media[0]!.key)).toBe(false))

    const before = await chatWrites(chatId)
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: rid, media })).toEqual(first)
    expect(await chatWrites(chatId)).toBe(before)
    expect(await exists(sentKey(media[0]!.key))).toBe(true)
  })

  it('待发对象过期被删：返回 media_expired，不写消息，已经复制出来的删掉', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const p = photo(a.id)
    // 预览图还在，大图已经被生命周期规则删掉
    await env.MEDIA.put(p.preview_key, 'x')
    const before = await chatWrites(chatId)
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: [p] })).toEqual({
      ok: false,
      e: 'media_expired',
    })
    expect(await chatWrites(chatId)).toBe(before)
    await eventually(async () => expect(await exists(sentKey(p.preview_key))).toBe(false))
  })

  it('复制出错（不是对象不存在）：整条失败，已经复制出来的删掉，待发对象保留', async () => {
    const { a, chatId } = await pair()
    const ca = await connect(a.id)
    const p = (await stored([photo(a.id)]))[0]!
    await inUser(a.id, (o) => {
      const copy = o.copyObject
      o.copyObject = async (src, dst) => {
        if (src === p.preview_key) throw new Error('copy failed: 500')
        return copy(src, dst)
      }
    })
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: [p] })).toEqual({ ok: false, e: 'internal' })
    await eventually(async () => expect(await exists(sentKey(p.key))).toBe(false))
    expect(await exists(p.key)).toBe(true)
    expect(await exists(p.preview_key)).toBe(true)
  })

  it('对方拉黑了自己：ChatDO 拒绝，删掉复制出来的，待发对象保留给"删除发送失败的消息"', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
    await cb.call('users.block', { user_id: a.id })
    const v = (await stored([voice(a.id)]))[0]!
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media: [v] })).toEqual({ ok: false, e: 'blocked' })
    await eventually(async () => expect(await exists(sentKey(v.key))).toBe(false))
    expect(await exists(v.key)).toBe(true)
  })

  it('自己拉黑了对方：复制之前就拒绝', async () => {
    const { a, b, chatId } = await pair()
    const ca = await connect(a.id)
    await ca.call('users.block', { user_id: b.id })
    let copied = 0
    await inUser(a.id, (o) => {
      o.copyObject = async () => {
        copied++
        return true
      }
    })
    const media = await stored([voice(a.id)])
    expect(await ca.call('messages.sendMedia', { chat_id: chatId, random_id: randomId(), media })).toEqual({ ok: false, e: 'blocked' })
    expect(copied).toBe(0)
  })

  it('ChatDO 先去重再校验成员：离开群组后重放仍返回原来的结果，不删已发送的对象', async () => {
    const { a, b } = await pair()
    const group = newGroupChatId()
    const ca = await connect(a.id)
    const cb = await connect(b.id)
    await ca.call('chats.create', { chat_id: group, random_id: randomId(), title: 'T', user_ids: [b.id] })
    const media = await stored([voice(b.id)])
    const rid = randomId()
    const first = await cb.call('messages.sendMedia', { chat_id: group, random_id: rid, media })
    expect(first).toMatchObject({ ok: true })
    await cb.call('chats.leave', { chat_id: group, random_id: randomId() })
    expect(await cb.call('messages.sendMedia', { chat_id: group, random_id: rid, media })).toEqual(first)
    expect(await exists(sentKey(media[0]!.key))).toBe(true)
  })
})

describe('对象键', () => {
  it('文件名只保留 URL 安全的字符，纯点号改为 file', () => {
    expect(safeName('季度 报告(终).pdf')).toBe('_.pdf')
    expect(safeName('..')).toBe('file')
    expect(safeName('a/b.txt')).toBe('a_b.txt')
  })

  it('归属校验要求完整匹配，并区分待发与已发送', () => {
    const k = `${PREFIX}p/u1/${'A'.repeat(22)}/photo.webp`
    expect(ownsKey(k, PREFIX, 'u1', 'p')).toBe(true)
    expect(ownsKey(k, PREFIX, 'u1', 'm')).toBe(false)
    expect(ownsKey(k, PREFIX, 'u', 'p')).toBe(false)
    expect(ownsKey(k, '', 'u1', 'p')).toBe(false)
    expect(ownsKey(`${k}/x`, PREFIX, 'u1', 'p')).toBe(false)
  })

  it('发送后的键与待发键同一目录，只换掉 p', () => {
    expect(sentKey(`${PREFIX}p/u1/${'A'.repeat(22)}/photo.webp`)).toBe(`${PREFIX}m/u1/${'A'.repeat(22)}/photo.webp`)
    expect(sentKey(`p/u1/${'A'.repeat(22)}/p`)).toBe(`m/u1/${'A'.repeat(22)}/p`)
    expect(() => sentKey(`${PREFIX}m/u1/${'A'.repeat(22)}/photo.webp`)).toThrow()
  })
})

describe('/api/media', () => {
  const upload = (body: unknown, headers: Record<string, string>) =>
    SELF.fetch(`${origin}/api/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('要求本站 Origin 与登录会话', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const body = { media: [{ type: 'file', name: 'a.txt', mime: 'text/plain', size: 1 }] }
    expect((await upload(body, { Origin: 'https://evil.example', Cookie: cookie })).status).toBe(403)
    expect((await upload(body, { Origin: origin })).status).toBe(401)
  })

  it('为图片签发大图与预览图，为文件签发附件；大小与类型都签进签名', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const res = await upload(
      {
        media: [
          { type: 'photo', mime: 'image/webp', size: 1234, preview_mime: 'image/jpeg', preview_size: 99 },
          { type: 'file', name: '季度报告.pdf', mime: 'application/pdf', size: 5000 },
        ],
      },
      { Origin: origin, Cookie: cookie },
    )
    expect(res.status).toBe(200)
    const { media } = await res.json<UploadResponse>()
    const [p, f] = media as [UploadResponse['media'][number], UploadResponse['media'][number]]

    expect(ownsKey(p.main.key, PREFIX, me.id, 'p')).toBe(true)
    expect(p.main.key).toMatch(/\/photo\.webp$/)
    expect(p.preview!.key).toBe(p.main.key.replace(/photo\.webp$/, 'preview.jpg'))
    expect(f.main.key).toMatch(/\/_\.pdf$/)
    expect(f.main.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('季度报告.pdf')}`)
    expect(f.main.headers['content-length']).toBeUndefined()

    const url = new URL(p.main.url)
    expect(url.origin).toBe(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    expect(url.pathname).toBe(`/${env.R2_BUCKET}/${p.main.key}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host')
    expect(new URL(f.main.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'cache-control;content-disposition;content-length;content-type;host',
    )
  })

  it('链接预览卡片的图片只签一个对象', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const res = await upload({ media: [{ type: 'link', mime: 'image/webp', size: 321 }] }, { Origin: origin, Cookie: cookie })
    expect(res.status).toBe(200)
    const [l] = (await res.json<UploadResponse>()).media
    expect(ownsKey(l!.main.key, PREFIX, me.id, 'p')).toBe(true)
    expect(l!.main.key).toMatch(/\/link\.webp$/)
    expect(l!.preview).toBeUndefined()
    expect(new URL(l!.main.url).searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host')
  })

  it('语音只签一个对象，不作为附件下载', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const res = await upload(
      {
        media: [
          { type: 'voice', mime: 'audio/webm', size: 4000 },
          { type: 'voice', mime: 'audio/mp4', size: 4000 },
        ],
      },
      { Origin: origin, Cookie: cookie },
    )
    expect(res.status).toBe(200)
    const [w, m] = (await res.json<UploadResponse>()).media
    expect(ownsKey(w!.main.key, PREFIX, me.id, 'p')).toBe(true)
    expect(w!.main.key).toMatch(/\/voice\.webm$/)
    expect(m!.main.key).toMatch(/\/voice\.m4a$/)
    expect(w!.preview).toBeUndefined()
    expect(w!.main.headers['content-type']).toBe('audio/webm')
    expect(new URL(w!.main.url).searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host')
  })

  it('视频签发 MP4 与封面，不作为附件下载', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const res = await upload(
      { media: [{ type: 'video', size: 9000, preview_mime: 'image/webp', preview_size: 120 }] },
      { Origin: origin, Cookie: cookie },
    )
    expect(res.status).toBe(200)
    const [v] = (await res.json<UploadResponse>()).media
    expect(ownsKey(v!.main.key, PREFIX, me.id, 'p')).toBe(true)
    expect(v!.main.key).toMatch(/\/video\.mp4$/)
    expect(v!.preview!.key).toBe(v!.main.key.replace(/video\.mp4$/, 'preview.webp'))
    expect(v!.main.headers['content-type']).toBe('video/mp4')
    expect(v!.main.headers['content-disposition']).toBeUndefined()
    expect(new URL(v!.main.url).searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host')
    const h = { Origin: origin, Cookie: cookie }
    expect((await upload({ media: [{ type: 'video', size: 20 * 1024 * 1024 + 1, preview_mime: 'image/webp', preview_size: 1 }] }, h)).status).toBe(400)
    expect((await upload({ media: [{ type: 'video', size: 1, preview_mime: 'image/gif', preview_size: 1 }] }, h)).status).toBe(400)
  })

  it('秘密聊天的加密对象只按大小签发，键名与类型不透露内容', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const h = { Origin: origin, Cookie: cookie }
    const res = await upload({ media: [{ type: 'sealed', size: 1028, preview_size: 128 }, { type: 'sealed', size: 29 }] }, h)
    expect(res.status).toBe(200)
    const [album, file] = (await res.json<UploadResponse>()).media
    expect(ownsKey(album!.main.key, PREFIX, me.id, 'p')).toBe(true)
    expect(album!.main.key).toMatch(/\/sealed\.bin$/)
    expect(album!.preview!.key).toBe(album!.main.key.replace(/sealed\.bin$/, 'preview.bin'))
    expect(album!.main.headers['content-type']).toBe('application/octet-stream')
    expect(album!.main.headers['content-disposition']).toBeUndefined()
    expect(file!.preview).toBeUndefined()
    expect(new URL(file!.main.url).searchParams.get('X-Amz-SignedHeaders')).toBe('cache-control;content-length;content-type;host')
    // 上限是 MAX_MEDIA_BYTES 加上加密的开销；连开销都不够的不是加密对象
    expect((await upload({ media: [{ type: 'sealed', size: 20 * 1024 * 1024 + 28 }] }, h)).status).toBe(200)
    expect((await upload({ media: [{ type: 'sealed', size: 20 * 1024 * 1024 + 29 }] }, h)).status).toBe(400)
    expect((await upload({ media: [{ type: 'sealed', size: 28 }] }, h)).status).toBe(400)
  })

  it('拒绝超过 8MB 的语音与不支持的录音格式', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const h = { Origin: origin, Cookie: cookie }
    expect((await upload({ media: [{ type: 'voice', mime: 'audio/webm', size: MAX_VOICE_BYTES + 1 }] }, h)).status).toBe(400)
    expect((await upload({ media: [{ type: 'voice', mime: 'audio/webm;codecs=opus', size: 1 }] }, h)).status).toBe(400)
    expect((await upload({ media: [{ type: 'voice', mime: 'audio/ogg', size: 1 }] }, h)).status).toBe(400)
  })

  it('拒绝超过 20MB、不支持的图片格式与超过 10 项', async () => {
    const me = await createUser()
    const { cookie } = await login(me.id)
    const h = { Origin: origin, Cookie: cookie }
    const f = { type: 'file', name: 'a.bin', mime: 'application/octet-stream', size: 1 }
    expect((await upload({ media: [{ ...f, size: 20 * 1024 * 1024 + 1 }] }, h)).status).toBe(400)
    expect(
      (await upload({ media: [{ type: 'photo', mime: 'image/png', size: 1, preview_mime: 'image/webp', preview_size: 1 }] }, h))
        .status,
    ).toBe(400)
    expect((await upload({ media: Array.from({ length: 11 }, () => f) }, h)).status).toBe(400)
  })

  it('只能删除自己的待发对象：别人的、已发送的都不行', async () => {
    const me = await createUser()
    const other = await createUser()
    const { cookie } = await login(me.id)
    const mine = key(me.id)
    const theirs = key(other.id)
    const sent = sentKey(key(me.id))
    for (const k of [mine, theirs, sent]) await env.MEDIA.put(k, 'x')
    const del = (keys: string[]) =>
      SELF.fetch(`${origin}/api/media`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
        body: JSON.stringify({ keys }),
      })

    expect((await del([mine, theirs])).status).toBe(403)
    expect((await del([sent])).status).toBe(403)
    expect(await env.MEDIA.head(sent)).not.toBeNull()
    expect(await env.MEDIA.head(mine)).not.toBeNull()
    expect((await del([mine])).status).toBe(204)
    expect(await env.MEDIA.head(mine)).toBeNull()
    expect(await env.MEDIA.head(theirs)).not.toBeNull()
  })
})
