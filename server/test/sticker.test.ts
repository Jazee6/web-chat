import { env } from 'cloudflare:test'
import { MAX_STICKERS, newGroupChatId, privateChatId, savedKey, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { connect, createUser, eventually, inUser, randomId, userWrites } from './helpers'

const PREFIX = 'test/'
const THUMBHASH = 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw=='
const pendingKey = (userId: string, name = 'sticker.webp') => `${PREFIX}p/${userId}/${crypto.randomUUID().replace(/-/g, '').slice(0, 22)}/${name}`

const stickerEvents = (updates: Update[]) => updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'sticker' ? [u.ev] : []))

/** 模拟上传一张贴纸到待发区，再添加到我的贴纸；返回它在 s/ 下的键 */
async function addUploaded(client: Awaited<ReturnType<typeof connect>>, userId: string, name = 'sticker.webp') {
  const key = pendingKey(userId, name)
  await env.MEDIA.put(key, 'x')
  const res = await client.call('stickers.add', { from: 'upload', key, w: 512, h: 400, size: 1, thumbhash: THUMBHASH })
  expect(res).toEqual({ ok: true, r: null })
  return savedKey(key)
}

describe('stickers.add', () => {
  it('从图片添加：待发对象复制到 s/、删掉待发对象，1 行写入，推给自己的设备；重放不再写入', async () => {
    const a = await createUser()
    const [c1, c2] = await Promise.all([connect(a.id), connect(a.id)])
    const key = pendingKey(a.id, 'sticker.png')
    await env.MEDIA.put(key, 'x')
    const params = { from: 'upload' as const, key, w: 300, h: 512, size: 1, thumbhash: THUMBHASH }

    const before = await userWrites(a.id)
    expect(await c1.call('stickers.add', params)).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    const saved = savedKey(key)
    expect(await env.MEDIA.head(saved)).not.toBeNull()
    await eventually(async () => expect(await env.MEDIA.head(key)).toBeNull())
    await eventually(() =>
      expect(stickerEvents(c2.updates)).toMatchObject([
        { key: saved, sticker: { type: 'sticker', key: saved, mime: 'image/png', w: 300, h: 512, thumbhash: THUMBHASH } },
      ]),
    )

    // 确认丢了的重放：待发对象已经删了，s/ 在，不重复添加
    expect(await c1.call('stickers.add', params)).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)

    const sync = await c1.call('sync.user', { pts: 0 })
    expect(sync.ok && sync.r.stickers).toMatchObject([{ key: saved, sticker: { mime: 'image/png' } }])
  })

  it('格式由文件名决定，静态图长边不超过 512，键必须是自己的待发键；待发对象过期返回 media_expired', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const ca = await connect(a.id)
    const add = (key: string, w = 512) => ca.call('stickers.add', { from: 'upload', key, w, h: 100, size: 1, thumbhash: THUMBHASH })
    for (const key of [pendingKey(a.id, 'photo.webp'), pendingKey(b.id), `${PREFIX}m/${a.id}/${'A'.repeat(22)}/sticker.webp`]) {
      await env.MEDIA.put(key, 'x')
      expect(await add(key)).toEqual({ ok: false, e: 'bad_request' })
    }
    const big = pendingKey(a.id)
    await env.MEDIA.put(big, 'x')
    expect(await add(big, 513)).toEqual({ ok: false, e: 'bad_request' })
    // GIF 原样保留，尺寸可以更大
    const gif = pendingKey(a.id, 'sticker.gif')
    await env.MEDIA.put(gif, 'x')
    expect(await add(gif, 1000)).toEqual({ ok: true, r: null })
    expect(await add(pendingKey(a.id))).toEqual({ ok: false, e: 'media_expired' })
  })

  it(`已有 ${MAX_STICKERS} 张时返回 sticker_limit，并且不复制；移除一张后又可以添加`, async () => {
    const a = await createUser()
    const ca = await connect(a.id)
    const first = await addUploaded(ca, a.id)
    await inUser(a.id, (o) => {
      for (let i = 1; i < MAX_STICKERS; i++) {
        o.sql.run(
          "INSERT INTO stickers (key, mime, w, h, size, thumbhash, added_at, removed, pts) VALUES (?, 'image/webp', 1, 1, 1, '', 0, 0, 0)",
          `fill-${i}`,
        )
      }
    })
    const key = pendingKey(a.id)
    await env.MEDIA.put(key, 'x')
    const params = { from: 'upload' as const, key, w: 10, h: 10, size: 1, thumbhash: THUMBHASH }
    expect(await ca.call('stickers.add', params)).toEqual({ ok: false, e: 'sticker_limit' })
    expect(await env.MEDIA.head(savedKey(key))).toBeNull()

    expect(await ca.call('stickers.remove', { key: first })).toEqual({ ok: true, r: null })
    expect(await ca.call('stickers.add', params)).toEqual({ ok: true, r: null })
  })

  it('从贴纸消息添加：引用同一个对象，已经有的不重复添加；不是贴纸消息的拒绝', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const [ca, cb] = await Promise.all([connect(a.id), connect(b.id)])
    const chat = privateChatId(a.id, b.id)
    const key = await addUploaded(ca, a.id)
    await ca.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })
    await ca.call('messages.send', { chat_id: chat, random_id: randomId(), text: 'hi' })
    // 扇出在发送返回之后才到 b 的 UserDO：等它写完再计数
    await eventually(async () =>
      expect(await inUser(b.id, (o) => o.sql.one('SELECT top_seq FROM dialogs WHERE chat_id = ?', chat))).toEqual({ top_seq: 2 }),
    )

    const before = await userWrites(b.id)
    expect(await cb.call('stickers.add', { from: 'message', chat_id: chat, seq: 1 })).toEqual({ ok: true, r: null })
    expect(await cb.call('stickers.add', { from: 'message', chat_id: chat, seq: 1 })).toEqual({ ok: true, r: null })
    expect((await userWrites(b.id)) - before).toBe(1)
    const sync = await cb.call('sync.user', { pts: 0 })
    expect(sync.ok && sync.r.stickers).toMatchObject([{ key, sticker: { key, w: 512, h: 400 } }])

    expect(await cb.call('stickers.add', { from: 'message', chat_id: chat, seq: 2 })).toEqual({ ok: false, e: 'bad_request' })
    // 读不到的会话
    const c = await createUser()
    const cc = await connect(c.id)
    expect(await cc.call('stickers.add', { from: 'message', chat_id: chat, seq: 1 })).toEqual({ ok: false, e: 'forbidden' })
  })
})

describe('stickers.remove', () => {
  it('只留墓碑并推给其他设备，不删对象；已经发出的贴纸消息照常，移除后不能再发', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const [c1, c2] = await Promise.all([connect(a.id), connect(a.id)])
    const chat = privateChatId(a.id, b.id)
    const key = await addUploaded(c1, a.id)
    await c1.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })

    const before = await userWrites(a.id)
    expect(await c1.call('stickers.remove', { key })).toEqual({ ok: true, r: null })
    expect(await c1.call('stickers.remove', { key })).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    await eventually(() => expect(stickerEvents(c2.updates).at(-1)).toEqual({ type: 'sticker', key, sticker: null }))
    expect(await env.MEDIA.head(key)).not.toBeNull()

    const sync = await c1.call('sync.user', { pts: 0 })
    expect(sync.ok && sync.r.stickers).toEqual([{ key, sticker: null }])
    expect(await c1.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })).toEqual({ ok: false, e: 'not_found' })
  })
})

describe('messages.sendSticker', () => {
  it('发出贴纸消息：引用同一个对象、不复制，格式与尺寸取自收藏；摘要为 sticker；撤回不删对象', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const [ca, cb] = await Promise.all([connect(a.id), connect(b.id)])
    const chat = privateChatId(a.id, b.id)
    const key = await addUploaded(ca, a.id, 'sticker.gif')
    let copies = 0
    await inUser(a.id, (o) => {
      o.copyObject = async () => {
        copies++
        return true
      }
    })

    const rid = randomId()
    const before = await userWrites(a.id)
    const res = await ca.call('messages.sendSticker', { chat_id: chat, random_id: rid, key })
    expect(res).toMatchObject({ ok: true, r: { seq: 1 } })
    // 与发一条文本相同：自己的 dialog 1 行（私聊第一条另有建会话的行，这里只看 UserDO）
    expect((await userWrites(a.id)) - before).toBe(1)
    expect(await ca.call('messages.sendSticker', { chat_id: chat, random_id: rid, key })).toEqual(res)
    expect(copies).toBe(0)
    const got = await cb.call('messages.get', { chat_id: chat, seqs: [1] })
    expect(got.ok && got.r.messages[0]).toMatchObject({
      sender_id: a.id,
      kind: 'media',
      media: [{ type: 'sticker', key, mime: 'image/gif', w: 512, h: 400, size: 1, thumbhash: THUMBHASH }],
    })
    await eventually(() =>
      expect(
        cb.updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' ? [u.ev.dialog.top_preview] : [])).at(-1),
      ).toMatchObject({ kind: 'sticker' }),
    )

    expect(await ca.call('messages.recall', { chat_id: chat, seq: 1 })).toEqual({ ok: true, r: null })
    await new Promise((r) => setTimeout(r, 50))
    expect(await env.MEDIA.head(key)).not.toBeNull()
  })

  it('发贴纸不清空草稿', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const ca = await connect(a.id)
    const chat = privateChatId(a.id, b.id)
    await ca.call('messages.send', { chat_id: chat, random_id: randomId(), text: 'hi' })
    const draft = { text: 'typing…', reply_to: null }
    await ca.call('dialogs.update', { chat_id: chat, draft })
    const key = await addUploaded(ca, a.id)
    await ca.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })
    const sync = await ca.call('sync.user', { pts: 0 })
    expect(sync.ok && sync.r.dialogs[0]).toMatchObject({ top_seq: 2, draft })
  })

  it('只能发自己贴纸里的；拉黑时拒绝', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const [ca, cb] = await Promise.all([connect(a.id), connect(b.id)])
    const chat = privateChatId(a.id, b.id)
    const key = await addUploaded(ca, a.id)
    expect(await cb.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })).toEqual({ ok: false, e: 'not_found' })
    await ca.call('users.block', { user_id: b.id })
    expect(await ca.call('messages.sendSticker', { chat_id: chat, random_id: randomId(), key })).toEqual({ ok: false, e: 'blocked' })
  })

  it('转发贴纸消息：不复制，引用同一个对象', async () => {
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()])
    const [ca, cb] = await Promise.all([connect(a.id), connect(b.id)])
    const group = newGroupChatId()
    await ca.call('chats.create', { chat_id: group, random_id: randomId(), title: 'T', user_ids: [b.id] })
    const key = await addUploaded(ca, a.id)
    await ca.call('messages.sendSticker', { chat_id: group, random_id: randomId(), key })
    let copies = 0
    await inUser(b.id, (o) => {
      o.copyObject = async () => {
        copies++
        return true
      }
    })
    const dm = privateChatId(b.id, c.id)
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toMatchObject({
      ok: true,
    })
    expect(copies).toBe(0)
    const got = await cb.call('messages.get', { chat_id: dm, seqs: [1] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ kind: 'media', media: [{ type: 'sticker', key }], fwd_from: { user_id: a.id } })
  })
})
