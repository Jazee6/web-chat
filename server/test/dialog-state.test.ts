import {
  MAX_PINNED_DIALOGS,
  MUTE_FOREVER,
  newGroupChatId,
  privateChatId,
  type Dialog,
  type PushPayload,
  type PushSubscriptionKeys,
  type Update,
} from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { connect, createSession, createUser, eventually, inUser, randomId, userWrites, type Client } from './helpers'

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

async function dialogOf(client: Client, chatId: string) {
  const res = await client.call('sync.user', { pts: 0 })
  if (!res.ok) throw new Error(res.e)
  return res.r.dialogs.find((d) => d.chat_id === chatId)
}

/** a 与 b 的私聊：b 先发一条，a 有了对话行 */
async function privatePair() {
  const a = await createUser()
  const b = await createUser()
  const chatId = privateChatId(a.id, b.id)
  const ca = await connect(a.id)
  const cb = await connect(b.id)
  await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hi' })
  await eventually(() => expect(lastDialog(ca.updates, chatId)).toBeDefined())
  return { a, b, chatId, ca, cb }
}

describe('dialogs.update', () => {
  it('每次修改写 1 行并同步到其他设备；没有变化时不写入', async () => {
    const { a, chatId, ca } = await privatePair()
    const laptop = await connect(a.id)

    let before = await userWrites(a.id)
    expect(await ca.call('dialogs.update', { chat_id: chatId, pinned: true, muted_until: MUTE_FOREVER })).toEqual({ ok: true, r: null })
    expect((await userWrites(a.id)) - before).toBe(1)
    await eventually(() =>
      expect(lastDialog(laptop.updates, chatId)).toMatchObject({ pinned_rank: 1, muted_until: MUTE_FOREVER, draft: null }),
    )

    before = await userWrites(a.id)
    await ca.call('dialogs.update', { chat_id: chatId, pinned: true, muted_until: MUTE_FOREVER, draft: null })
    await ca.call('dialogs.update', { chat_id: chatId, draft: { text: '', reply_to: null } })
    await ca.call('dialogs.update', { chat_id: chatId })
    expect((await userWrites(a.id)) - before).toBe(0)

    await ca.call('dialogs.update', { chat_id: chatId, draft: { text: 'later', reply_to: 1 } })
    expect((await userWrites(a.id)) - before).toBe(1)
    expect(await dialogOf(laptop, chatId)).toMatchObject({ draft: { text: 'later', reply_to: 1 } })

    await ca.call('dialogs.update', { chat_id: chatId, pinned: false, muted_until: 0 })
    expect(await dialogOf(laptop, chatId)).toMatchObject({ pinned_rank: null, muted_until: 0 })
  })

  it(`后置顶的排在前面，最多 ${MAX_PINNED_DIALOGS} 个`, async () => {
    const a = await createUser()
    const ca = await connect(a.id)
    const chats: string[] = []
    for (let i = 0; i <= MAX_PINNED_DIALOGS; i++) {
      const b = await createUser()
      const chatId = privateChatId(a.id, b.id)
      await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'x' })
      chats.push(chatId)
    }
    for (const chatId of chats.slice(0, MAX_PINNED_DIALOGS)) {
      expect(await ca.call('dialogs.update', { chat_id: chatId, pinned: true })).toEqual({ ok: true, r: null })
    }
    const ranks = await Promise.all(chats.slice(0, MAX_PINNED_DIALOGS).map(async (id) => (await dialogOf(ca, id))!.pinned_rank!))
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))

    const before = await userWrites(a.id)
    expect(await ca.call('dialogs.update', { chat_id: chats.at(-1)!, pinned: true })).toEqual({ ok: false, e: 'pin_limit' })
    expect((await userWrites(a.id)) - before).toBe(0)

    await ca.call('dialogs.update', { chat_id: chats[0]!, pinned: false })
    expect(await ca.call('dialogs.update', { chat_id: chats.at(-1)!, pinned: true })).toEqual({ ok: true, r: null })
    expect((await dialogOf(ca, chats.at(-1)!))!.pinned_rank).toBeGreaterThan(ranks.at(-1)!)
  })

  it('没有对话行时 not_found', async () => {
    const a = await createUser()
    const b = await createUser()
    const ca = await connect(a.id)
    expect(await ca.call('dialogs.update', { chat_id: privateChatId(a.id, b.id), pinned: true })).toEqual({ ok: false, e: 'not_found' })
  })
})

describe('对话行的置顶、静音与草稿', () => {
  it('收到新消息时保留置顶与静音，写入仍是 1 行', async () => {
    const { a, chatId, ca, cb } = await privatePair()
    await ca.call('dialogs.update', { chat_id: chatId, pinned: true, muted_until: MUTE_FOREVER, draft: { text: 'wip', reply_to: null } })

    const before = await userWrites(a.id)
    await cb.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'again' })
    await eventually(() => expect(lastDialog(ca.updates, chatId)).toMatchObject({ top_seq: 2 }))
    expect((await userWrites(a.id)) - before).toBe(1)
    const expected = { pinned_rank: 1, muted_until: MUTE_FOREVER, draft: { text: 'wip', reply_to: null } }
    expect(lastDialog(ca.updates, chatId)).toMatchObject(expected)
    expect(await dialogOf(ca, chatId)).toMatchObject(expected)
  })

  it('自己发出消息时清空草稿，不多花写入', async () => {
    const { a, chatId, ca } = await privatePair()
    await ca.call('dialogs.update', { chat_id: chatId, draft: { text: 'wip', reply_to: 1 } })

    const before = await userWrites(a.id)
    await ca.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'wip' })
    expect((await userWrites(a.id)) - before).toBe(1)
    expect(await dialogOf(ca, chatId)).toMatchObject({ draft: null })
  })

  it('变成只读对话时保留置顶与静音、清空草稿，只读对话不能写草稿；删除对话时全部清空', async () => {
    const owner = await createUser()
    const b = await createUser()
    const co = await connect(owner.id)
    const cb = await connect(b.id)
    const chatId = newGroupChatId()
    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'Team', user_ids: [b.id] })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toBeDefined())
    await cb.call('dialogs.update', { chat_id: chatId, pinned: true, muted_until: MUTE_FOREVER, draft: { text: 'wip', reply_to: null } })

    await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: b.id })
    await eventually(() =>
      expect(lastDialog(cb.updates, chatId)).toMatchObject({ status: 'left', pinned_rank: 1, muted_until: MUTE_FOREVER, draft: null }),
    )
    expect(await cb.call('dialogs.update', { chat_id: chatId, draft: { text: 'x', reply_to: null } })).toEqual({ ok: false, e: 'bad_request' })

    await cb.call('dialogs.delete', { chat_id: chatId })
    expect(await dialogOf(cb, chatId)).toMatchObject({ status: 'deleted', pinned_rank: null, muted_until: 0, draft: null })

    // 重新入群是全新的对话
    await co.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [b.id] })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ status: 'member', pinned_rank: null, muted_until: 0 }))
  })
})

describe('静音与推送', () => {
  const subscription = (name: string): PushSubscriptionKeys => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: `B${'A'.repeat(86)}`,
    auth: 'A'.repeat(22),
  })

  it('静音的对话不推送，未读也不计入其他推送的角标；到期后恢复', async () => {
    const a = await createUser()
    const b = await createUser()
    const c = await createUser()
    const quiet = privateChatId(a.id, b.id)
    const loud = privateChatId(a.id, c.id)
    const device = await createSession(a.id)
    const ca = await connect(a.id, device)
    await ca.call('push.set', { subscription: subscription(device) })
    const sent: PushPayload[] = []
    await inUser(a.id, (o) => {
      o.sendPush = async (_s, payload) => {
        sent.push(payload)
        return 201
      }
    })
    const cb = await connect(b.id)
    const cc = await connect(c.id)

    await cb.call('messages.send', { chat_id: quiet, random_id: randomId(), text: 'one' })
    await eventually(() => expect(sent).toHaveLength(1))
    await ca.call('dialogs.update', { chat_id: quiet, muted_until: Date.now() + 60_000 })

    await cb.call('messages.send', { chat_id: quiet, random_id: randomId(), text: 'two' })
    await eventually(() => expect(lastDialog(ca.updates, quiet)).toMatchObject({ top_seq: 2 }))
    await cc.call('messages.send', { chat_id: loud, random_id: randomId(), text: 'hey' })
    await eventually(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toMatchObject({ chat_id: loud, badge: 1 })

    // 已过期的静音等于没有静音
    await ca.call('dialogs.update', { chat_id: quiet, muted_until: Date.now() - 1 })
    await cb.call('messages.send', { chat_id: quiet, random_id: randomId(), text: 'three' })
    await eventually(() => expect(sent).toHaveLength(3))
    expect(sent[2]).toMatchObject({ chat_id: quiet, badge: 4 })
  })
})
