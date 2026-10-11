import { MAX_GROUP_MEMBERS, newGroupChatId, type Dialog, type Message, type Update } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { chatWrites, connect, createUser, eventually, inChat, randomId, uid, userWrites, type Client } from './helpers'

const newMessages = (updates: Update[]) =>
  updates.flatMap((u) => (u.k === 'chat' && u.ev.type === 'new_message' ? [u.ev.message] : []))

const lastDialog = (updates: Update[], chatId: string): Dialog | undefined =>
  updates.flatMap((u) => (u.k === 'user' && u.ev.type === 'dialog' && u.ev.dialog.chat_id === chatId ? [u.ev.dialog] : [])).at(-1)

async function dialogOf(client: Client, chatId: string) {
  const res = await client.call('sync.user', { pts: 0 })
  if (!res.ok) throw new Error(res.e)
  return res.r.dialogs.find((d) => d.chat_id === chatId)
}

/** 建一个群：owner + n 名成员，全部在线 */
async function group(n = 2, title = 'Team') {
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

describe('chats.create', () => {
  it('成员收到群对话与建群服务消息，建群者发送即已读', async () => {
    const { owner, others, co, cs, chatId } = await group(2, 'Team')

    expect(lastDialog(co.updates, chatId)).toMatchObject({
      kind: 'group', title: 'Team', status: 'member', top_seq: 1, last_read_seq: 1,
      top_preview: { kind: 'service', action: { type: 'chat_create' } },
    })
    expect(lastDialog(cs[0]!.updates, chatId)).toMatchObject({ title: 'Team', status: 'member', top_seq: 1, last_read_seq: 0 })
    const [created] = newMessages(cs[1]!.updates)
    expect(created).toMatchObject({
      seq: 1, sender_id: owner.id, kind: 'service',
      action: { type: 'chat_create', title: 'Team', user_ids: others.map((u) => u.id) },
    })

    // 每次打开群组都会调用：只读，不写库
    const before = { chat: await chatWrites(chatId), user: await userWrites(others[0]!.id) }
    const info = await cs[0]!.call('chats.get', { chat_id: chatId })
    expect(info.ok && info.r.chat.members.map((m) => [m.user_id, m.role]).sort()).toEqual(
      [[owner.id, 'owner'], ...others.map((u) => [u.id, 'member'])].sort(),
    )
    expect(await chatWrites(chatId)).toBe(before.chat)
    expect(await userWrites(others[0]!.id)).toBe(before.user)
  })

  it('写入行数：info 3 行 + 成员 N 行 + 服务消息 2 行；每名成员的对话 1 行', async () => {
    const owner = await createUser()
    const other = await createUser()
    const co = await connect(owner.id)
    const cb = await connect(other.id)
    const chatId = newGroupChatId()
    // 基线包含构造函数建表的写入
    const before = { chat: await chatWrites(chatId), owner: await userWrites(owner.id), other: await userWrites(other.id) }

    await co.call('chats.create', { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [other.id] })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toBeDefined())

    expect((await chatWrites(chatId)) - before.chat).toBe(3 + 2 + 2)
    expect((await userWrites(owner.id)) - before.owner).toBe(1)
    expect((await userWrites(other.id)) - before.other).toBe(1)
  })

  it('重放返回第一次的结果；ID 被占用、成员不存在、只有自己都会被拒绝', async () => {
    const owner = await createUser()
    const other = await createUser()
    const co = await connect(owner.id)
    const chatId = newGroupChatId()
    const params = { chat_id: chatId, random_id: randomId(), title: 'T', user_ids: [other.id] }

    const first = await co.call('chats.create', params)
    expect(await co.call('chats.create', params)).toEqual(first)
    expect(await co.call('chats.create', { ...params, random_id: randomId() })).toEqual({ ok: false, e: 'bad_request' })
    expect(await co.call('chats.create', { ...params, chat_id: newGroupChatId(), user_ids: [uid()] })).toEqual({
      ok: false,
      e: 'not_found',
    })
    expect(await co.call('chats.create', { ...params, chat_id: newGroupChatId(), user_ids: [owner.id] })).toEqual({
      ok: false,
      e: 'bad_request',
    })
    expect(await co.call('chats.create', { ...params, chat_id: 'g:short' })).toEqual({ ok: false, e: 'bad_request' })
  })
})

describe('群消息', () => {
  it('扇出给除发送者以外的所有成员，稳态每条消息写入 N + 2 行', async () => {
    const { owner, others, co, cs, chatId } = await group(3)
    const before = {
      chat: await chatWrites(chatId),
      users: await Promise.all([owner, ...others].map((u) => userWrites(u.id))),
    }

    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'hello' })
    for (const c of cs) await eventually(() => expect(newMessages(c.updates).at(-1)).toMatchObject({ seq: 2, text: 'hello' }))

    expect((await chatWrites(chatId)) - before.chat).toBe(2)
    const after = await Promise.all([owner, ...others].map((u) => userWrites(u.id)))
    expect(after.map((n, i) => n - before.users[i]!)).toEqual([1, 1, 1, 1])
  })
})

describe('chats.addMembers', () => {
  it('任何成员都能拉人；新成员看得到全部历史', async () => {
    const { others, cs, chatId } = await group(1)
    await cs[0]!.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'before' })
    const newcomer = await createUser()
    const cn = await connect(newcomer.id)

    const res = await cs[0]!.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [newcomer.id] })
    expect(res).toMatchObject({ ok: true, r: { seq: 3 } })
    // 之前的历史不算未读，只有拉进群的这条
    await eventually(() => expect(lastDialog(cn.updates, chatId)).toMatchObject({ title: 'Team', status: 'member', top_seq: 3, last_read_seq: 2 }))
    expect(newMessages(cn.updates).at(-1)).toMatchObject({
      sender_id: others[0]!.id,
      action: { type: 'members_add', user_ids: [newcomer.id] },
    })

    const history = await cn.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages.map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it('重放幂等；已是成员返回 bad_request；超过上限返回 chat_full', async () => {
    const { co, chatId, others } = await group(1)
    const newcomer = await createUser()
    const params = { chat_id: chatId, random_id: randomId(), user_ids: [newcomer.id] }
    const first = await co.call('chats.addMembers', params)
    expect(await co.call('chats.addMembers', params)).toEqual(first)
    expect(await co.call('chats.addMembers', { ...params, random_id: randomId(), user_ids: [others[0]!.id] })).toEqual({
      ok: false,
      e: 'bad_request',
    })

    const crowd = await Promise.all(Array.from({ length: MAX_GROUP_MEMBERS - 3 + 1 }, () => createUser()))
    expect(await co.call('chats.addMembers', { ...params, random_id: randomId(), user_ids: crowd.map((u) => u.id) })).toEqual({
      ok: false,
      e: 'chat_full',
    })
    expect(
      await co.call('chats.addMembers', { ...params, random_id: randomId(), user_ids: crowd.slice(1).map((u) => u.id) }),
    ).toMatchObject({ ok: true })
  })

  it('外人不能拉人，私聊不能拉人', async () => {
    const { chatId } = await group(1)
    const outsider = await createUser()
    const cx = await connect(outsider.id)
    expect(await cx.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [outsider.id] })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    expect(
      await cx.call('chats.addMembers', { chat_id: `p:${outsider.id}:zz`, random_id: randomId(), user_ids: [outsider.id] }),
    ).toEqual({ ok: false, e: 'bad_request' })
  })
})

describe('移除与退出', () => {
  it('只有群主能移除；被移除者的对话变为只读，只能读到被移除那条为止', async () => {
    const { co, cs, others, chatId } = await group(2)
    const [cb, cc] = cs as [Client, Client]
    const c = others[1]!

    expect(await cb.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: c.id })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    expect(await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: c.id })).toMatchObject({
      ok: true,
      r: { seq: 2 },
    })
    await eventually(() => expect(lastDialog(cc.updates, chatId)).toMatchObject({ status: 'left', top_seq: 2 }))
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ status: 'member', top_seq: 2 }))

    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'after' })
    await eventually(() => expect(newMessages(cb.updates).at(-1)).toMatchObject({ seq: 3 }))
    expect(newMessages(cc.updates).map((m) => m.seq)).toEqual([1, 2])

    const history = await cc.call('messages.history', { chat_id: chatId, limit: 10 })
    expect(history.ok && history.r.messages.map((m) => m.seq)).toEqual([1, 2])
    expect(await cc.call('sync.chat', { chat_id: chatId, pts: 0, limit: 10 })).toMatchObject({
      ok: true,
      r: { too_long: false, messages: [{ seq: 1 }, { seq: 2 }] },
    })
    expect(await cc.call('sync.chat', { chat_id: chatId, pts: 0, limit: 1 })).toMatchObject({
      ok: true,
      r: { too_long: true, top_seq: 2 },
    })
    expect(await cc.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'x' })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    expect(await cc.call('chats.get', { chat_id: chatId })).toEqual({ ok: false, e: 'forbidden' })
  })

  it('群主退出时群主身份转给最早入群的成员；退出写入 1 + 2 + 1 行', async () => {
    const { owner, co, cs, others, chatId } = await group(1)
    const [cb] = cs as [Client]
    const late = await createUser()
    await co.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [late.id] })
    const before = await chatWrites(chatId)

    expect(await co.call('chats.leave', { chat_id: chatId, random_id: randomId() })).toMatchObject({ ok: true })
    expect((await chatWrites(chatId)) - before).toBe(4)
    await eventually(() =>
      expect(newMessages(cb.updates).at(-1)).toMatchObject({
        sender_id: owner.id,
        action: { type: 'member_leave', new_owner_id: others[0]!.id },
      }),
    )
    expect(lastDialog(co.updates, chatId)).toMatchObject({ status: 'left' })

    const info = await cb.call('chats.get', { chat_id: chatId })
    expect(info.ok && info.r.chat.members.find((m) => m.role === 'owner')?.user_id).toBe(others[0]!.id)
    expect(await cb.call('chats.editTitle', { chat_id: chatId, random_id: randomId(), title: 'Renamed' })).toMatchObject({
      ok: true,
    })
  })

  it('退出重放幂等；最后一人退出后群组无人', async () => {
    const { co, cs, chatId } = await group(1)
    const params = { chat_id: chatId, random_id: randomId() }
    const first = await co.call('chats.leave', params)
    expect(await co.call('chats.leave', params)).toEqual(first)
    expect(await co.call('chats.leave', { ...params, random_id: randomId() })).toEqual({ ok: false, e: 'forbidden' })

    expect(await cs[0]!.call('chats.leave', { chat_id: chatId, random_id: randomId() })).toMatchObject({ ok: true })
    const current = await inChat(chatId, (o) => o.sql.all('SELECT user_id FROM members WHERE left_seq IS NULL'))
    expect(current).toEqual([])
  })

  it('前成员被重新加入后恢复为成员，并能补齐离开期间的消息', async () => {
    const { co, cs, others, chatId } = await group(1)
    const [cb] = cs as [Client]
    await cb.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'while away' })
    await co.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [others[0]!.id] })

    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ status: 'member', top_seq: 4, last_read_seq: 3 }))
    const diff = await cb.call('sync.chat', { chat_id: chatId, pts: 2, limit: 10 })
    expect(diff.ok && !diff.r.too_long && diff.r.messages.map((m: Message) => m.seq)).toEqual([3, 4])
  })

  it('前成员同步到最新 chat_pts：离开前消息的编辑只到达一次；重新从头同步能补齐离开期间的消息', async () => {
    const { co, cs, others, chatId } = await group(1)
    const [cb] = cs as [Client]
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'before' })
    await cb.call('chats.leave', { chat_id: chatId, random_id: randomId() })
    await co.call('messages.send', { chat_id: chatId, random_id: randomId(), text: 'while away' })
    expect(await co.call('messages.edit', { chat_id: chatId, seq: 2, text: 'edited' })).toEqual({ ok: true, r: null })

    // 打开只读对话：看得到离开前消息的最新内容，看不到离开之后的消息
    const readOnly = await cb.call('sync.chat', { chat_id: chatId, pts: 0, limit: 10 })
    if (!readOnly.ok || readOnly.r.too_long) throw new Error('unexpected')
    expect(readOnly.r.messages.map((m: Message) => [m.seq, m.kind === 'text' ? m.text : m.kind])).toEqual([
      [1, 'service'],
      [3, 'service'],
      [2, 'edited'],
    ])
    expect(await cb.call('sync.chat', { chat_id: chatId, pts: readOnly.r.pts, limit: 10 })).toMatchObject({
      ok: true,
      r: { too_long: false, messages: [] },
    })

    // 被重新加入后，客户端丢弃本地窗口从头同步
    await co.call('chats.addMembers', { chat_id: chatId, random_id: randomId(), user_ids: [others[0]!.id] })
    const rebuilt = await cb.call('sync.chat', { chat_id: chatId, pts: 0, limit: 10 })
    expect(rebuilt.ok && !rebuilt.r.too_long && rebuilt.r.messages.map((m: Message) => m.seq).sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('chats.editTitle', () => {
  it('只有群主能改名；成员的对话行随之更新', async () => {
    const { co, cs, chatId } = await group(1)
    expect(await cs[0]!.call('chats.editTitle', { chat_id: chatId, random_id: randomId(), title: 'X' })).toEqual({
      ok: false,
      e: 'forbidden',
    })
    expect(await co.call('chats.editTitle', { chat_id: chatId, random_id: randomId(), title: '  New name  ' })).toMatchObject({
      ok: true,
    })
    await eventually(() =>
      expect(lastDialog(cs[0]!.updates, chatId)).toMatchObject({
        title: 'New name',
        top_preview: { kind: 'service', action: { type: 'title_edit', title: 'New name' } },
      }),
    )
  })
})

describe('dialogs.delete', () => {
  it('只能删除只读对话；删除后留下墓碑，其他设备同步删除', async () => {
    const { co, cs, others, chatId } = await group(1)
    const [cb] = cs as [Client]
    expect(await cb.call('dialogs.delete', { chat_id: chatId })).toEqual({ ok: false, e: 'bad_request' })

    await co.call('chats.removeMember', { chat_id: chatId, random_id: randomId(), user_id: others[0]!.id })
    await eventually(() => expect(lastDialog(cb.updates, chatId)).toMatchObject({ status: 'left' }))
    const laptop = await connect(others[0]!.id)

    const before = await userWrites(others[0]!.id)
    expect(await cb.call('dialogs.delete', { chat_id: chatId })).toEqual({ ok: true, r: null })
    expect((await userWrites(others[0]!.id)) - before).toBe(1)
    await eventually(() => expect(lastDialog(laptop.updates, chatId)).toMatchObject({ status: 'deleted' }))
    expect(await dialogOf(laptop, chatId)).toMatchObject({ status: 'deleted' })
    expect(await cb.call('dialogs.delete', { chat_id: chatId })).toEqual({ ok: false, e: 'not_found' })
  })
})
