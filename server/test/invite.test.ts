import { MAX_GROUP_MEMBERS, newGroupChatId, parseInviteCode, type Dialog, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inUser, randomId, userWrites, type Client } from './helpers'

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

/** 建一个群：owner + n 名成员，全部在线 */
async function group(n = 1, title = 'Team') {
  const owner = await createUser()
  const others = await Promise.all(Array.from({ length: n }, () => createUser()))
  const co = await connect(owner.id)
  const cs = await Promise.all(others.map((u) => connect(u.id)))
  const chatId = newGroupChatId()
  const res = await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title, user_ids: others.map((u) => u.id) })
  if (!res.ok) throw new Error(res.e)
  for (const c of cs) await eventually(() => expect(lastDialog(c.updates, chatId)).toBeDefined())
  return { owner, others, co, cs, chatId }
}

async function codeOf(client: Client, chatId: string) {
  const res = await client.call('chats.getInvite', { chat_id: chatId })
  if (!res.ok) throw new Error(res.e)
  return res.r.code
}

async function stranger() {
  const user = await createUser()
  return { user, client: await connect(user.id) }
}

describe('chats.getInvite / chats.resetInvite', () => {
  it('每个群组一条链接：第一次要时生成（1 行写入），之后只读；所有成员拿到的相同', async () => {
    const { co, cs, chatId } = await group(1)
    const before = await chatWrites(chatId)
    const code = await codeOf(co, chatId)
    expect(parseInviteCode(code)?.chat_id).toBe(chatId)
    expect((await chatWrites(chatId)) - before).toBe(1)

    expect(await codeOf(cs[0]!, chatId)).toBe(code)
    expect((await chatWrites(chatId)) - before).toBe(1)
  })

  it('非成员拿不到；私聊没有邀请链接', async () => {
    const { chatId } = await group(1)
    const { client } = await stranger()
    expect(await client.call('chats.getInvite', { chat_id: chatId })).toEqual({ ok: false, e: 'forbidden' })
    expect(await client.call('chats.getInvite', { chat_id: 'p:a:b' })).toEqual({ ok: false, e: 'bad_request' })
  })

  it('只有群主能重置，重置后旧链接失效、不产生服务消息', async () => {
    const { co, cs, chatId } = await group(1)
    const old = await codeOf(co, chatId)
    expect(await cs[0]!.call('chats.resetInvite', { chat_id: chatId })).toEqual({ ok: false, e: 'forbidden' })

    const res = await co.call('chats.resetInvite', { chat_id: chatId })
    expect(res.ok && res.r.code).not.toBe(old)
    expect(res.ok && (await codeOf(cs[0]!, chatId))).toBe(res.ok && res.r.code)

    const { client } = await stranger()
    expect(await client.call('chats.checkInvite', { code: old })).toEqual({ ok: false, e: 'not_found' })
    expect(await client.call('chats.join', { code: old, random_id: randomId() })).toEqual({ ok: false, e: 'not_found' })
    expect(newMessages(cs[0]!.updates)).toHaveLength(1)
  })
})

describe('chats.checkInvite', () => {
  it('返回群名与人数，只读不写库；成员看到 member', async () => {
    const { co, chatId } = await group(2, 'Team')
    const code = await codeOf(co, chatId)
    const { user, client } = await stranger()
    const before = { chat: await chatWrites(chatId), user: await userWrites(user.id) }

    expect(await client.call('chats.checkInvite', { code })).toEqual({
      ok: true,
      r: { chat_id: chatId, title: 'Team', member_count: 3, member: false },
    })
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(user.id)).toBe(before.user)
    expect(await co.call('chats.checkInvite', { code })).toMatchObject({ ok: true, r: { member: true } })
  })

  it('格式不对、令牌不对都返回 not_found', async () => {
    const { co, chatId } = await group(1)
    const code = await codeOf(co, chatId)
    const { client } = await stranger()
    expect(await client.call('chats.checkInvite', { code: 'nope' })).toEqual({ ok: false, e: 'not_found' })
    const [id] = code.split('.')
    expect(await client.call('chats.checkInvite', { code: `${id}.${'A'.repeat(22)}` })).toEqual({ ok: false, e: 'not_found' })
    // 群组还不存在
    const other = newGroupChatId().slice(2)
    expect(await client.call('chats.checkInvite', { code: `${other}.${'A'.repeat(22)}` })).toEqual({ ok: false, e: 'not_found' })
  })
})

describe('chats.join', () => {
  it('加入后成为成员，看得到全部历史；其他成员收到服务消息但不推送；写入 3 行 + 每人对话 1 行', async () => {
    const { owner, cs, co, chatId } = await group(1)
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'before' })
    const code = await codeOf(co, chatId)
    const { user, client } = await stranger()
    const before = { chat: await chatWrites(chatId), user: await userWrites(user.id), owner: await userWrites(owner.id) }

    const res = await client.call('chats.join', { code, random_id: randomId() })
    expect(res).toMatchObject({ ok: true, r: { seq: 3 } })
    expect(lastDialog(client.updates, chatId)).toMatchObject({ title: 'Team', status: 'member', top_seq: 3, last_read_seq: 3 })
    await eventually(() =>
      expect(newMessages(cs[0]!.updates).at(-1)).toMatchObject({ sender_id: user.id, kind: 'service', action: { type: 'member_join' } }),
    )
    await eventually(() => expect(lastDialog(co.updates, chatId)).toMatchObject({ top_seq: 3 }))

    expect((await chatWrites(chatId)) - before.chat).toBe(3)
    expect((await userWrites(user.id)) - before.user).toBe(1)
    expect((await userWrites(owner.id)) - before.owner).toBe(1)

    const history = await client.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages.map((m) => m.seq)).toEqual([1, 2, 3])
    const info = await client.call('chats.get', { chat_id: chatId })
    expect(info.ok && info.r.chat.members).toHaveLength(3)
  })

  it('重放返回第一次的结果；已是成员返回 bad_request', async () => {
    const { co, chatId } = await group(1)
    const code = await codeOf(co, chatId)
    const { client } = await stranger()
    const params = { code, random_id: randomId() }
    const first = await client.call('chats.join', params)
    expect(first.ok).toBe(true)
    expect(await client.call('chats.join', params)).toEqual(first)
    expect(await client.call('chats.join', { code, random_id: randomId() })).toEqual({ ok: false, e: 'bad_request' })
  })

  it('群已满返回 chat_full', async () => {
    const { co, chatId } = await group(MAX_GROUP_MEMBERS - 1)
    const code = await codeOf(co, chatId)
    const { client } = await stranger()
    expect(await client.call('chats.checkInvite', { code })).toMatchObject({ ok: true, r: { member_count: MAX_GROUP_MEMBERS } })
    expect(await client.call('chats.join', { code, random_id: randomId() })).toEqual({ ok: false, e: 'chat_full' })
  })

  it('自己退出的可以凭链接回来；被群主移除的不行，被成员拉回后再退出又可以', async () => {
    const { others, cs, co, chatId } = await group(2)
    const code = await codeOf(co, chatId)
    const b = others[1]!
    const [ca, cb] = cs as [Client, Client]

    await ca.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    expect(await ca.call('chats.checkInvite', { code })).toMatchObject({ ok: true, r: { member: false } })
    expect(await ca.call('chats.join', { code, random_id: randomId() })).toMatchObject({ ok: true })
    expect(lastDialog(ca.updates, chatId)).toMatchObject({ status: 'member' })

    await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: b.id })
    expect(await cb.call('chats.checkInvite', { code })).toEqual({ ok: false, e: 'forbidden' })
    expect(await cb.call('chats.join', { code, random_id: randomId() })).toEqual({ ok: false, e: 'forbidden' })

    await ca.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [b.id] })
    await cb.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    expect(await cb.call('chats.join', { code, random_id: randomId() })).toMatchObject({ ok: true })
  })

  it('所有人都退出后链接失效：没有群主的群组不能凭链接复活', async () => {
    const { co, cs, chatId } = await group(1)
    const code = await codeOf(co, chatId)
    await cs[0]!.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    await co.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    const { client } = await stranger()
    expect(await client.call('chats.checkInvite', { code })).toEqual({ ok: false, e: 'not_found' })
    expect(await client.call('chats.join', { code, random_id: randomId() })).toEqual({ ok: false, e: 'not_found' })
    expect(await cs[0]!.call('chats.join', { code, random_id: randomId() })).toEqual({ ok: false, e: 'not_found' })
  })

  it('不受群里任何人拉黑的影响', async () => {
    const { others, cs, co, chatId } = await group(1)
    const code = await codeOf(co, chatId)
    const { user, client } = await stranger()
    await cs[0]!.call('users.block', { user_id: user.id })
    expect(await inUser(others[0]!.id, (o) => o.hasBlocked(user.id))).toBe(true)
    expect(await client.call('chats.join', { code, random_id: randomId() })).toMatchObject({ ok: true })
  })
})
