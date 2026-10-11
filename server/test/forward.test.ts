import { env } from 'cloudflare:test'
import { newGroupChatId, privateChatId, sentKey, sentMedia, type MessageEntity, type Photo, type Update, type Video, type Voice } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { ownsKey } from '../src/media'
import { chatWrites, connect, createUser, eventually, inUser, randomId, stored, userWrites } from './helpers'

const PREFIX = 'test/'
const lastDialog = (updates: Update[], chatId: string) =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

const photo = (userId: string): Photo => ({
  type: 'photo',
  key: `${PREFIX}p/${userId}/${'B'.repeat(22)}/photo.webp`,
  preview_key: `${PREFIX}p/${userId}/${'B'.repeat(22)}/preview.webp`,
  w: 1600,
  h: 1200,
  size: 1000,
  thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
})

/** a 在群里发消息，b 是成员；b 与 c 有私聊 */
async function setup() {
  const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()])
  const group = newGroupChatId()
  const [ca, cb, cc] = await Promise.all([connect(a.id), connect(b.id), connect(c.id)])
  await ca.call('chats.create', { chat_id: group, random_id: randomId(), title: 'T', user_ids: [b.id] })
  return { a, b, c, group, dm: privateChatId(b.id, c.id), ca, cb, cc }
}

describe('messages.forward', () => {
  it('转发文本：成为转发者的新消息，带最初的来源；写入与发送相同；提及原样保留但不算提及', async () => {
    const { a, b, c, group, dm, ca, cb, cc } = await setup()
    const text = 'hi @B'
    const entities: MessageEntity[] = [{ type: 'mention', offset: 3, length: 2, user_id: b.id }]
    await ca.call('messages.send', { chat_id: group, random_id: randomId(), text, entities })
    const original = await cb.call('messages.get', { chat_id: group, seqs: [2] })
    const date = original.ok ? original.r.messages[0]!.date : 0

    const before = { b: await userWrites(b.id), c: await userWrites(c.id) }
    const res = await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })
    expect(res).toMatchObject({ ok: true, r: { seq: 1 } })
    await eventually(() => expect(lastDialog(cc.updates, dm)?.top_seq).toBe(1))
    const got = await cc.call('messages.get', { chat_id: dm, seqs: [1] })
    expect(got.ok && got.r.messages[0]).toMatchObject({
      sender_id: b.id,
      kind: 'text',
      text,
      entities,
      fwd_from: { user_id: a.id, date },
    })
    expect(got.ok && got.r.messages[0]).not.toHaveProperty('reply_to')
    expect((await userWrites(b.id)) - before.b).toBe(1)
    expect((await userWrites(c.id)) - before.c).toBe(1)

    // 再转回群里：来源不变，提及不产生未读提及
    await cc.call('messages.forward', { from_chat_id: dm, seq: 1, to_chat_id: dm, random_id: randomId() })
    const again = await cc.call('messages.get', { chat_id: dm, seqs: [2] })
    expect(again.ok && again.r.messages[0]).toMatchObject({ sender_id: c.id, fwd_from: { user_id: a.id, date } })
    await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: group, random_id: randomId() })
    await eventually(() => expect(lastDialog(cb.updates, group)?.top_seq).toBe(3))
    expect(lastDialog(cb.updates, group)?.unread_mentions).toEqual([])
  })

  it('转发媒体：在服务端复制到转发者名下；重放同一请求复制到同样的键、不产生第二条消息', async () => {
    const { a, b, group, dm, ca, cb } = await setup()
    const pending = await stored([photo(a.id)])
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: pending })
    const album = sentMedia(pending) as Photo[]
    const copies: [string, string][] = []
    await inUser(b.id, (o) => {
      o.copyObject = async (src, dst) => {
        copies.push([src, dst])
        return true
      }
    })

    const rid = randomId()
    const first = await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: rid })
    expect(first).toMatchObject({ ok: true, r: { seq: 1 } })
    expect(copies.map(([src]) => src)).toEqual([album[0]!.key, album[0]!.preview_key])
    for (const [, dst] of copies) expect(ownsKey(dst, PREFIX, b.id, 'm')).toBe(true)

    const got = await cb.call('messages.get', { chat_id: dm, seqs: [1] })
    const sent = got.ok ? got.r.messages[0] : undefined
    expect(sent).toMatchObject({ kind: 'media', fwd_from: { user_id: a.id } })
    const media = sent?.kind === 'media' ? (sent.media[0] as Photo) : undefined
    expect([media?.key, media?.preview_key]).toEqual(copies.map(([, dst]) => dst))

    const before = await chatWrites(dm)
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: rid })).toEqual(first)
    expect(copies.slice(2).map(([, dst]) => dst)).toEqual(copies.slice(0, 2).map(([, dst]) => dst))
    expect(await chatWrites(dm)).toBe(before)
  })

  it('转发语音消息：只复制录音一个对象', async () => {
    const { a, b, group, dm, ca, cb } = await setup()
    const voice: Voice = {
      type: 'voice',
      key: `${PREFIX}p/${a.id}/${'C'.repeat(22)}/voice.webm`,
      mime: 'audio/webm',
      size: 4000,
      duration: 3,
      waveform: btoa('\0'.repeat(64)),
    }
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([voice]) })
    const copies: [string, string][] = []
    await inUser(b.id, (o) => {
      o.copyObject = async (src, dst) => {
        copies.push([src, dst])
        return true
      }
    })

    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toMatchObject({
      ok: true,
    })
    expect(copies.map(([src]) => src)).toEqual([sentKey(voice.key)])
    expect(copies[0]![1]).toMatch(/\/voice\.webm$/)
    const got = await cb.call('messages.get', { chat_id: dm, seqs: [1] })
    expect(got.ok && got.r.messages[0]).toMatchObject({ kind: 'media', media: [{ ...voice, key: copies[0]![1] }] })
  })

  it('转发视频：复制视频与封面两个对象', async () => {
    const { a, b, group, dm, ca, cb } = await setup()
    const dir = `${PREFIX}p/${a.id}/${'D'.repeat(22)}`
    const video: Video = {
      type: 'video',
      key: `${dir}/video.mp4`,
      preview_key: `${dir}/preview.webp`,
      w: 1280,
      h: 720,
      size: 9000,
      duration: 42,
      thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
    }
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([video]) })
    const copies: [string, string][] = []
    await inUser(b.id, (o) => {
      o.copyObject = async (src, dst) => {
        copies.push([src, dst])
        return true
      }
    })

    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toMatchObject({
      ok: true,
    })
    expect(copies.map(([src]) => src)).toEqual([sentKey(video.key), sentKey(video.preview_key)])
    for (const [, dst] of copies) expect(ownsKey(dst, PREFIX, b.id, 'm')).toBe(true)
    const got = await cb.call('messages.get', { chat_id: dm, seqs: [1] })
    expect(got.ok && got.r.messages[0]).toMatchObject({
      kind: 'media',
      media: [{ ...video, key: copies[0]![1], preview_key: copies[1]![1] }],
    })
  })

  it('复制失败时整个转发失败，不写消息', async () => {
    const { a, b, group, dm, ca, cb } = await setup()
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([photo(a.id)]) })
    await inUser(b.id, (o) => {
      o.copyObject = async () => {
        throw new Error('copy failed')
      }
    })
    const before = await chatWrites(dm)
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'internal',
    })
    expect(await chatWrites(dm)).toBe(before)
  })

  it('复制到一半失败：等其余复制结束后一并删掉复制出来的', async () => {
    const { a, b, group, dm, ca, cb } = await setup()
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([photo(a.id)]) })
    const copies: string[] = []
    await inUser(b.id, (o) => {
      const copy = o.copyObject
      o.copyObject = async (src, dst) => {
        if (src.endsWith('/preview.webp')) throw new Error('copy failed: 500')
        // 大图比预览图晚完成：失败时它还在复制
        await new Promise((r) => setTimeout(r, 50))
        copies.push(dst)
        return copy(src, dst)
      }
    })
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'internal',
    })
    expect(copies).toHaveLength(1)
    await eventually(async () => expect(await env.MEDIA.head(copies[0]!)).toBeNull())
  })

  it('只能转发自己读得到的文本与媒体消息；前成员可以转发离开前的历史', async () => {
    const { b, group, dm, ca, cb, cc } = await setup()
    await ca.call('messages.send', { chat_id: group, random_id: randomId(), text: 'before' })
    // 服务消息
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 1, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'bad_request',
    })
    // c 不在群里
    expect(await cc.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    await ca.call('chats.removeMember', { chat_id: group, random_id: randomId(), user_id: b.id })
    await ca.call('messages.send', { chat_id: group, random_id: randomId(), text: 'after' })
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toMatchObject({
      ok: true,
    })
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 4, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'not_found',
    })
  })

  it('转发来的消息不能编辑，可以撤回；撤回的消息不能再转发', async () => {
    const { group, dm, ca, cb } = await setup()
    await ca.call('messages.send', { chat_id: group, random_id: randomId(), text: 'x' })
    await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })
    expect(await cb.call('messages.edit', { chat_id: dm, seq: 1, text: 'y' })).toEqual({ ok: false, e: 'bad_request' })
    expect(await cb.call('messages.recall', { chat_id: dm, seq: 1 })).toEqual({ ok: true, r: null })
    expect(await cb.call('messages.forward', { from_chat_id: dm, seq: 1, to_chat_id: group, random_id: randomId() })).toEqual({
      ok: false,
      e: 'bad_request',
    })
  })

  it('目标是拉黑中的私聊：返回 blocked，不复制媒体', async () => {
    const { a, b, c, group, dm, ca, cb } = await setup()
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([photo(a.id)]) })
    let copied = 0
    await inUser(b.id, (o) => {
      o.copyObject = async () => {
        copied++
        return true
      }
    })
    await cb.call('users.block', { user_id: c.id })
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'blocked',
    })
    expect(copied).toBe(0)
  })

  it('目标会话拒绝（对方拉黑了转发者）：删掉复制出来的对象', async () => {
    const { a, b, group, dm, ca, cb, cc } = await setup()
    await cb.call('messages.send', { chat_id: dm, random_id: randomId(), text: 'hi' })
    await ca.call('messages.sendMedia', { chat_id: group, random_id: randomId(), media: await stored([photo(a.id)]) })
    const copies: string[] = []
    await inUser(b.id, (o) => {
      const copy = o.copyObject
      o.copyObject = async (src, dst) => {
        copies.push(dst)
        return copy(src, dst)
      }
    })
    await cc.call('users.block', { user_id: b.id })
    expect(await cb.call('messages.forward', { from_chat_id: group, seq: 2, to_chat_id: dm, random_id: randomId() })).toEqual({
      ok: false,
      e: 'blocked',
    })
    expect(copies).toHaveLength(2)
    await eventually(async () => {
      for (const key of copies) expect(await env.MEDIA.head(key)).toBeNull()
    })
  })
})
