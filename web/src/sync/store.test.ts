import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeEach, describe, expect, test } from 'vitest'
import { MUTE_FOREVER, newSecretChatId, privateChatId, type Dialog, type Message } from 'shared/protocol'

import { FORWARD_TARGETS_SQL } from '@/features/chat/forward-targets'
import { DIALOGS_FROM } from '@/features/dialogs/dialog-list'
import { IS_UNPLAYED_SQL, NEXT_UNPLAYED_SQL } from '@/features/voice/unplayed'
import { Store, intact, migrate, uploadedMedia } from './store'

const sqlite3 = await sqlite3InitModule()
const CHAT = 'g_chat'
const compare = (a: unknown, b: unknown) => String(a).localeCompare(String(b))

let db: Database
let store: Store
let pts = 0

/** 服务端推来的对话行：每次 pts 递增 */
function dialog(patch: Partial<Dialog> = {}): Dialog {
  return {
    chat_id: CHAT,
    kind: 'group',
    title: 'Team',
    status: 'member',
    pts: ++pts,
    top_seq: 0,
    top_preview: null,
    chat_pts: 0,
    last_read_seq: 0,
    peer_read_seq: 0,
    pinned_rank: null,
    muted_until: 0,
    draft: null,
    unread_mentions: [],
    ...patch,
  }
}

const draft = () => store.draft(CHAT)

beforeEach(() => {
  db = new sqlite3.oo1.DB(':memory:')
  migrate(db)
  store = new Store(db, 'me', () => {})
  store.tx(() => store.upsertDialog(dialog()))
})

describe('drafts', () => {
  test('server drafts apply until the device has an unconfirmed change', () => {
    store.tx(() => store.upsertDialog(dialog({ draft: { text: 'from phone', reply_to: 3 } })))
    expect(draft()).toEqual({ draft: { text: 'from phone', reply_to: 3 }, dirty: false })

    expect(store.tx(() => store.setDraft(CHAT, { text: 'mine', reply_to: null }))).toBe(true)
    store.tx(() => store.upsertDialog(dialog({ draft: { text: 'from laptop', reply_to: null } })))
    expect(draft()).toEqual({ draft: { text: 'mine', reply_to: null }, dirty: true })

    store.tx(() => store.ackDraft(CHAT, { text: 'mine', reply_to: null }))
    expect(draft()).toEqual({ draft: { text: 'mine', reply_to: null }, dirty: false })
    store.tx(() => store.upsertDialog(dialog({ draft: null })))
    expect(draft()).toBeNull()
  })

  test('saving the same draft is a no-op; an ack for an older value keeps it unconfirmed', () => {
    store.tx(() => store.setDraft(CHAT, { text: 'a', reply_to: null }))
    store.tx(() => store.ackDraft(CHAT, { text: 'a', reply_to: null }))
    expect(store.tx(() => store.setDraft(CHAT, { text: 'a', reply_to: null }))).toBe(false)
    expect(store.tx(() => store.setDraft(CHAT, null))).toBe(true)
    expect(store.tx(() => store.setDraft(CHAT, { text: '', reply_to: null }))).toBe(false)

    store.tx(() => store.setDraft(CHAT, { text: 'b', reply_to: null }))
    store.tx(() => store.ackDraft(CHAT, null))
    expect(store.dirtyDrafts()).toEqual([CHAT])
  })

  test('a confirmed clear removes the row; sending discards it without syncing', () => {
    store.tx(() => store.setDraft(CHAT, { text: 'a', reply_to: null }))
    store.tx(() => store.setDraft(CHAT, null))
    expect(draft()).toEqual({ draft: null, dirty: true })
    store.tx(() => store.ackDraft(CHAT, null))
    expect(db.selectValue('SELECT count(*) FROM drafts')).toBe(0)

    store.tx(() => store.setDraft(CHAT, { text: 'b', reply_to: null }))
    store.tx(() => store.discardDraft(CHAT))
    expect(store.dirtyDrafts()).toEqual([])
  })

  test('leaving the group or deleting the dialog drops the draft', () => {
    store.tx(() => store.setDraft(CHAT, { text: 'a', reply_to: null }))
    store.tx(() => store.upsertDialog(dialog({ status: 'left' })))
    expect(draft()).toBeNull()

    store.tx(() => store.upsertDialog(dialog({ status: 'member', draft: { text: 'b', reply_to: null } })))
    store.tx(() => store.upsertDialog(dialog({ status: 'deleted' })))
    expect(draft()).toBeNull()
  })
})

describe('dialog list', () => {
  const row = () => store.query(`${DIALOGS_FROM} WHERE d.chat_id = ?`, [CHAT])[0]!

  test('muted compares muted_until with the current time', () => {
    expect(row().muted).toBe(0)
    store.tx(() => store.upsertDialog(dialog({ muted_until: Date.now() + 60_000 })))
    expect(row().muted).toBe(1)
    store.tx(() => store.upsertDialog(dialog({ muted_until: Date.now() - 1 })))
    expect(row().muted).toBe(0)
    store.tx(() => store.upsertDialog(dialog({ muted_until: MUTE_FOREVER })))
    expect(row().muted).toBe(1)
  })

  test('mentioned only while an unread mention is past the local read position', () => {
    expect(row().mentioned).toBe(0)
    store.tx(() => store.upsertDialog(dialog({ top_seq: 6, unread_mentions: [3, 5] })))
    expect(row().mentioned).toBe(1)
    // 本地乐观地读到 5，服务端的行还没更新
    store.tx(() => store.advanceRead(CHAT, 5))
    expect(row().mentioned).toBe(0)
  })

  test('shows only drafts with text, and pinned dialogs', () => {
    store.tx(() => store.upsertDialog(dialog({ pinned_rank: 2, draft: { text: '', reply_to: 5 } })))
    expect(row()).toMatchObject({ pinned: 1, draft: null })
    store.tx(() => store.upsertDialog(dialog({ draft: { text: 'wip', reply_to: 5 } })))
    expect(row()).toMatchObject({ pinned: 0, draft: 'wip' })
  })
})

describe('reactions', () => {
  const text = (patch: Partial<Extract<Message, { kind: 'text' }>>): Message => ({
    chat_id: CHAT,
    seq: 1,
    pts: 1,
    sender_id: 'u1',
    date: 1,
    kind: 'text',
    text: 'hi',
    ...patch,
  })
  const stored = () => db.selectValue('SELECT reactions FROM messages WHERE chat_id = ? AND seq = 1', [CHAT])

  test('a newer copy replaces or clears the reactions; an older copy is ignored', () => {
    store.tx(() => store.putMessages(CHAT, [text({ pts: 2, reactions: { '👍': ['u2'] } })]))
    expect(JSON.parse(stored() as string)).toEqual({ '👍': ['u2'] })

    store.tx(() => store.putMessages(CHAT, [text({ pts: 1 })]))
    expect(JSON.parse(stored() as string)).toEqual({ '👍': ['u2'] })

    store.tx(() => store.putMessages(CHAT, [text({ pts: 3 })]))
    expect(stored()).toBeNull()
  })
})

describe('forward targets', () => {
  test('member dialogs except blocked peers, then contacts without a dialog', () => {
    const contact = (user_id: string, blocked = false) => ({ user_id, contact: true, alias: null, blocked })
    store.tx(() => {
      store.putUsers(['u2', 'u3', 'u4', 'u5'].map((id) => ({ id, name: id, image: null })))
      store.upsertDialog(dialog({ chat_id: 'g_left', status: 'left' }))
      store.upsertDialog(dialog({ chat_id: privateChatId('me', 'u2'), kind: 'private', title: null }))
      store.upsertDialog(dialog({ chat_id: privateChatId('me', 'u3'), kind: 'private', title: null }))
      store.putRelation(contact('u2', true))
      store.putRelation(contact('u3'))
      store.putRelation(contact('u4'))
      store.putRelation(contact('u5', true))
    })
    const ids = store.query(FORWARD_TARGETS_SQL, ['me']).map((r) => r.chat_id)
    expect(ids.toSorted(compare)).toEqual([CHAT, privateChatId('me', 'u3'), privateChatId('me', 'u4')].toSorted(compare))
    expect(ids.at(-1)).toBe(privateChatId('me', 'u4'))
  })
})

describe('secret chats', () => {
  const SECRET = newSecretChatId('me', 'u2')
  const cipher = (patch: Partial<Extract<Message, { kind: 'cipher' }>> = {}): Message => ({
    chat_id: SECRET,
    seq: 1,
    pts: 1,
    sender_id: 'u2',
    date: 1,
    kind: 'cipher',
    cipher: 'c1',
    ...patch,
  })
  const plain = (pts: number, text: string) =>
    store.tx(() => store.putPlain(SECRET, 1, pts, { chat_id: SECRET, seq: 1, pts, sender_id: 'u2', date: 0, kind: 'text', text }, 9))
  const row = () => db.selectObjects('SELECT kind, text, date, cipher FROM messages WHERE chat_id = ? AND seq = 1', [SECRET])[0]

  test('ciphertext waits in its own column; decrypting fills in the plaintext', () => {
    store.tx(() => store.putMessages(SECRET, [cipher({ reactions: { u2: 'r1' } })]))
    expect(row()).toMatchObject({ kind: 'cipher', text: null })
    expect(store.cipherRows(10)).toEqual([
      { chat_id: SECRET, seq: 1, pts: 1, sender_id: 'u2', edit_date: null, cipher: 'c1', reactions: { u2: 'r1' } },
    ])

    plain(1, 'hi')
    expect(row()).toMatchObject({ kind: 'text', text: 'hi', date: 1, cipher: null })
    expect(store.cipherRows(10)).toEqual([])
    // 解开的明文不进搜索索引
    expect(db.selectValue('SELECT count(*) FROM search')).toBe(0)
    expect(store.duplicateRandomId(SECRET, 2, 'u2', 9)).toBe(true)

    // 重新同步来的同一版本不再要解
    store.tx(() => store.putMessages(SECRET, [cipher()]))
    expect(row()).toMatchObject({ kind: 'text', cipher: null })
  })

  test('a new version keeps showing the old plaintext until it is decrypted; a stale result is dropped', () => {
    store.tx(() => store.putMessages(SECRET, [cipher()]))
    plain(1, 'hi')
    store.tx(() => store.putMessages(SECRET, [cipher({ pts: 2, cipher: 'c2', edit_date: 5 })]))
    expect(row()).toMatchObject({ kind: 'text', text: 'hi' })
    expect(store.cipherRows(10)[0]).toMatchObject({ pts: 2, cipher: 'c2', edit_date: 5 })

    // 解开的是旧版本：不写
    plain(1, 'stale')
    expect(row()).toMatchObject({ text: 'hi' })
    plain(2, 'edited')
    expect(row()).toMatchObject({ kind: 'text', text: 'edited', cipher: null })
  })

  test('own sent messages stay as plaintext; recalling clears pending ciphertext', () => {
    store.tx(() => {
      store.addOutbox([{ random_id: 4, chat_id: SECRET, reply_to: null, kind: 'text', text: 'mine', entities: null, link: null }])
      store.confirmOutbox(store.outboxRow(4)!, { seq: 2, pts: 3, date: 2 }, null)
      store.putMessages(SECRET, [cipher({ seq: 2, pts: 3, sender_id: 'me', random_id: 4 })])
    })
    expect(db.selectObjects('SELECT kind, text, cipher FROM messages WHERE chat_id = ? AND seq = 2', [SECRET])[0]).toEqual({
      kind: 'text',
      text: 'mine',
      cipher: null,
    })

    store.tx(() => store.putMessages(SECRET, [cipher(), { chat_id: SECRET, seq: 1, pts: 4, sender_id: 'u2', date: 1, kind: 'recalled' }]))
    expect(row()).toMatchObject({ kind: 'recalled', cipher: null })
  })

  test('secret chats are neither forward targets nor hide the contact', () => {
    store.tx(() => {
      store.putUsers([{ id: 'u2', name: 'u2', image: null }])
      store.putRelation({ user_id: 'u2', contact: true, alias: null, blocked: false })
      store.upsertDialog(dialog({ chat_id: SECRET, kind: 'secret', title: null }))
    })
    expect(store.secretChatWith('u2')).toBe(SECRET)
    expect(store.query(FORWARD_TARGETS_SQL, ['me']).map((r) => r.chat_id).toSorted(compare)).toEqual([CHAT, privateChatId('me', 'u2')].toSorted(compare))
  })
})

describe('intact', () => {
  test('建好的库完好；表被清掉或版本归零即视为丢失', () => {
    expect(intact(db)).toBe(true)
    const empty = new sqlite3.oo1.DB(':memory:')
    expect(intact(empty)).toBe(false)
    migrate(empty)
    expect(intact(empty)).toBe(true)
    empty.close()
    expect(intact(empty)).toBe(false)
  })
})

describe('migrate', () => {
  test('新库从头建好并记下建立时间；版本一致时什么都不做', () => {
    const fresh = new sqlite3.oo1.DB(':memory:')
    expect(migrate(fresh)).toBe(true)
    expect(fresh.selectValue("SELECT value FROM kv WHERE key = 'created_at'")).toEqual(expect.any(Number))
    fresh.exec("DELETE FROM kv WHERE key = 'created_at'")
    expect(migrate(fresh)).toBe(true)
    expect(fresh.selectValue("SELECT count(*) FROM kv WHERE key = 'created_at'")).toBe(0)
    fresh.close()
  })

  test('版本号比代码新时不碰本地库', () => {
    store.upsertDialog(dialog())
    const version = db.selectValue('PRAGMA user_version') as number
    db.exec(`PRAGMA user_version = ${version + 1}`)
    expect(migrate(db)).toBe(false)
    expect(db.selectValue('SELECT count(*) FROM dialogs')).toBe(1)
    expect(intact(db)).toBe(false)
  })
})

describe('voice messages', () => {
  const voice = (seq: number, sender_id: string, date = Date.now()): Message => ({
    chat_id: CHAT,
    seq,
    pts: seq,
    sender_id,
    date,
    kind: 'media',
    media: [{ type: 'voice', key: `k${seq}`, mime: 'audio/webm', size: 10, duration: 7, waveform: 'AA==' }],
  })
  const unplayed = (seq: number) => store.query(IS_UNPLAYED_SQL, [CHAT, seq, 'me']).length > 0
  const next = (seq: number) => store.query(NEXT_UNPLAYED_SQL, [CHAT, seq, 'me'])[0]?.seq ?? null

  test('unplayed: from others, after the local database was created, not yet played on this device', () => {
    store.tx(() => store.putMessages(CHAT, [voice(1, 'u1', 0), voice(2, 'me'), voice(3, 'u1'), voice(4, 'u2')]))
    expect([1, 2, 3, 4].map(unplayed)).toEqual([false, false, true, true])
    expect(next(0)).toBe(3)

    store.tx(() => store.markPlayed(CHAT, 3))
    expect(unplayed(3)).toBe(false)
    expect(next(0)).toBe(4)
    expect(next(4)).toBeNull()
  })

  test('the dialog list keeps the duration; voice messages are not searchable', () => {
    store.tx(() => {
      store.upsertDialog(dialog({ top_seq: 1, top_preview: { kind: 'voice', duration: 12, sender_id: 'u1', date: 1 } }))
      store.putMessages(CHAT, [voice(1, 'u1')])
    })
    expect(store.query(`${DIALOGS_FROM} WHERE d.chat_id = ?`, [CHAT])[0]).toMatchObject({ top_kind: 'voice', top_duration: 12 })
    expect(db.selectValue('SELECT count(*) FROM search')).toBe(0)
  })

  test('an uploaded voice outbox item becomes Media', () => {
    const item = { type: 'voice' as const, file: 'm0', mime: 'audio/webm' as const, size: 10, duration: 3, waveform: 'AA==' }
    expect(uploadedMedia([item])).toBeNull()
    expect(uploadedMedia([{ ...item, key: 'k' }])).toEqual([
      { type: 'voice', key: 'k', mime: 'audio/webm', size: 10, duration: 3, waveform: 'AA==' },
    ])
  })
})

describe('stickers', () => {
  const sticker = (key: string, added_at: number) =>
    ({ type: 'sticker', key, mime: 'image/webp', w: 512, h: 400, size: 1000, thumbhash: 'AA==', added_at }) as const
  const keys = () => store.query('SELECT key FROM stickers ORDER BY added_at DESC', []).map((r) => r.key)

  test('saved stickers are newest first; a tombstone deletes the row; adding again moves it to the front', () => {
    store.tx(() => {
      store.putSticker({ key: 'a', sticker: sticker('a', 1) })
      store.putSticker({ key: 'b', sticker: sticker('b', 2) })
    })
    expect(keys()).toEqual(['b', 'a'])
    store.tx(() => store.putSticker({ key: 'b', sticker: null }))
    expect(keys()).toEqual(['a'])
    store.tx(() => {
      store.putSticker({ key: 'c', sticker: sticker('c', 3) })
      store.putSticker({ key: 'a', sticker: sticker('a', 4) })
    })
    expect(keys()).toEqual(['a', 'c'])
  })

  test('an outbox sticker is sent as the saved sticker; in a secret chat it waits for its sealed upload', () => {
    const { added_at: _, ...rest } = sticker('s/key', 1)
    const item = { ...rest, key: undefined, source: 's/key' }
    expect(uploadedMedia([{ ...item, file: 'm0' }])).toBeNull()
    expect(uploadedMedia([{ ...item, file: 'm0', key: 'p/sealed' }])).toEqual([{ ...rest, key: 'p/sealed' }])
  })
})
