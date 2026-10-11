import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Dialog, Message } from 'shared/protocol'

import { Store, migrate } from '@/sync/store'
import { DIALOGS_FROM, DIALOGS_ORDER } from '@/features/dialogs/dialog-list'
import { dialogNameFilter, likePattern, messageSearch, searchTerms, type MessageHit } from './sql'

const sqlite3 = await sqlite3InitModule()
const ME = 'me'
const CHAT = 'g_chat'
const OTHER = 'g_other'

let db: Database
let store: Store

function dialog(chatId: string, patch: Partial<Dialog> = {}): Dialog {
  return {
    chat_id: chatId,
    kind: 'group',
    title: chatId,
    status: 'member',
    pts: 1,
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

function text(seq: number, body: string, pts = seq, chatId = CHAT): Extract<Message, { kind: 'text' }> {
  return { chat_id: chatId, seq, pts, sender_id: 'u1', date: seq * 1000, kind: 'text', text: body }
}

function file(seq: number, name: string): Message {
  return {
    chat_id: CHAT, seq, pts: seq, sender_id: 'u1', date: seq * 1000, kind: 'media',
    media: [{ type: 'file', key: 'k', name, mime: 'application/pdf', size: 1 }],
  }
}

function album(seq: number): Message {
  return {
    chat_id: CHAT, seq, pts: seq, sender_id: 'u1', date: seq * 1000, kind: 'media',
    media: [{ type: 'photo', key: 'k', preview_key: 'p', w: 1, h: 1, size: 1, thumbhash: '' }],
  }
}

function search(input: string, chatId?: string): number[] {
  const { sql, params } = messageSearch(searchTerms(input), { chatId, limit: 50 })
  return (store.query(sql, params) as MessageHit[]).map((h) => h.seq)
}

const indexed = () => Number(db.selectValue('SELECT count(*) FROM search'))

beforeEach(() => {
  db = new sqlite3.oo1.DB(':memory:')
  migrate(db)
  store = new Store(db, ME, () => {})
  store.tx(() => {
    for (const id of [CHAT, OTHER]) {
      store.upsertDialog(dialog(id))
      store.setChatState(id, { pts: 0, min_seq: 1 })
    }
  })
})

describe('index maintenance', () => {
  test('indexes text bodies and file names, not albums or service messages', () => {
    store.putMessages(CHAT, [
      text(1, 'hello world'),
      file(2, 'report-2026.pdf'),
      album(3),
      { chat_id: CHAT, seq: 4, pts: 4, sender_id: 'u1', date: 4000, kind: 'service', action: { type: 'title_edit', title: 'hello there' } },
    ])
    expect(indexed()).toBe(2)
    expect(search('hello')).toEqual([1])
    expect(search('report')).toEqual([2])
  })

  test('re-applying the same message does not duplicate it', () => {
    store.putMessages(CHAT, [text(1, 'hello world')])
    store.putMessages(CHAT, [text(1, 'hello world')])
    expect(indexed()).toBe(1)
    expect(search('hello')).toEqual([1])
  })

  test('an edit reindexes the message', () => {
    store.putMessages(CHAT, [text(1, 'hello world')])
    store.putMessages(CHAT, [{ ...text(1, 'goodbye moon', 5), edit_date: 9 }])
    expect(search('hello')).toEqual([])
    expect(search('moon')).toEqual([1])
  })

  test('a recall removes the message', () => {
    store.putMessages(CHAT, [text(1, 'hello world')])
    store.putMessages(CHAT, [{ chat_id: CHAT, seq: 1, pts: 5, sender_id: 'u1', date: 1000, kind: 'recalled' }])
    expect(indexed()).toBe(0)
    expect(search('hello')).toEqual([])
  })

  test('messages confirmed from the outbox are indexed', () => {
    store.tx(() => store.addOutbox([{ random_id: 7, chat_id: CHAT, reply_to: null, kind: 'text', text: 'sent from here', entities: null, link: null }]))
    const row = store.outboxRow(7)!
    store.confirmOutbox(row, { seq: 1, pts: 1, date: 1000 }, null)
    expect(search('from here')).toEqual([1])
  })

  test('link preview titles are searchable, and edits that drop the card reindex', () => {
    const link = { ...text(1, 'https://example.com/a'), preview: { type: 'web' as const, title: 'Quarterly results' } }
    store.putMessages(CHAT, [link])
    expect(search('quarterly')).toEqual([1])
    expect(search('example')).toEqual([1])
    store.putMessages(CHAT, [{ ...text(1, 'https://example.com/b', 2), edit_date: 2000 }])
    expect(search('quarterly')).toEqual([])
    expect(search('example.com/b')).toEqual([1])
  })

  test('dropping messages, deleting the dialog and rejoining clear the index', () => {
    store.putMessages(CHAT, [text(1, 'hello world')])
    store.dropMessages(CHAT)
    expect(indexed()).toBe(0)

    store.putMessages(CHAT, [text(1, 'hello world')])
    store.upsertDialog(dialog(CHAT, { pts: 2, status: 'deleted' }))
    expect(indexed()).toBe(0)

    store.upsertDialog(dialog(OTHER, { pts: 2, status: 'left' }))
    store.putMessages(OTHER, [text(1, 'hello world', 1, OTHER)])
    store.upsertDialog(dialog(OTHER, { pts: 3, status: 'member' }))
    expect(indexed()).toBe(0)
  })
})

describe('messageSearch', () => {
  beforeEach(() => {
    store.putMessages(CHAT, [text(1, '今天天气很好'), text(2, 'Hello World'), text(3, '50% off_sale today'), text(4, 'a "quoted" -x* word:')])
    store.putMessages(OTHER, [text(1, 'hello from the other chat', 1, OTHER)])
  })

  test('matches substrings case-insensitively, newest first', () => {
    expect(search('天气')).toEqual([1])
    expect(search('天气很')).toEqual([1])
    expect(search('HELLO')).toEqual([2, 1])
  })

  test('all terms must match', () => {
    expect(search('hello world')).toEqual([2])
    expect(search('hello nothing')).toEqual([])
  })

  test('short terms fall back to LIKE with wildcards escaped', () => {
    expect(search('%')).toEqual([3])
    expect(search('_')).toEqual([3])
    expect(search('he')).toEqual([2, 1])
  })

  test('FTS syntax characters are taken literally', () => {
    expect(search('"quoted"')).toEqual([4])
    expect(search('-x*')).toEqual([4])
    expect(search('word:')).toEqual([4])
    expect(search('AND OR NOT')).toEqual([])
  })

  test('limits to one chat', () => {
    expect(search('hello', CHAT)).toEqual([2])
    expect(search('hello', OTHER)).toEqual([1])
  })

  test('skips messages before min_seq', () => {
    store.setChatState(CHAT, { pts: 0, min_seq: 3 })
    expect(search('hello', CHAT)).toEqual([])
    expect(search('off', CHAT)).toEqual([3])
  })

  test('returns the chat name for global results', () => {
    const { sql, params } = messageSearch(['hello'], { limit: 50 })
    const hits = store.query(sql, params) as MessageHit[]
    expect(hits.map((h) => [h.chat_id, h.name, h.body])).toEqual([
      [CHAT, CHAT, 'Hello World'],
      [OTHER, OTHER, 'hello from the other chat'],
    ])
  })
})

test('searchTerms splits on whitespace and dedupes', () => {
  expect(searchTerms('  foo  bar foo\n')).toEqual(['foo', 'bar'])
  expect(searchTerms('   ')).toEqual([])
})

test('likePattern escapes wildcards', () => {
  expect(likePattern('50%_\\')).toBe('%50\\%\\_\\\\%')
})

test('dialogNameFilter ANDs every term', () => {
  expect(dialogNameFilter(['a', 'b']).params).toEqual(['%a%', '%a%', '%b%', '%b%'])
})

describe('aliases', () => {
  const PEER = 'peer'
  const PRIVATE = `p:${ME}:${PEER}`

  beforeEach(() => {
    store.tx(() => {
      store.upsertDialog(dialog(PRIVATE, { kind: 'private', title: null }))
      store.putUsers([{ id: PEER, name: 'Robert', image: null }])
      store.putRelation({ user_id: PEER, contact: true, alias: 'Bob', blocked: false })
    })
  })

  const names = (terms: string[]) => {
    const filter = dialogNameFilter(terms)
    return store
      .query(`${DIALOGS_FROM} WHERE ${filter.sql} ${DIALOGS_ORDER}`, filter.params)
      .map((r) => r.name)
  }

  test('private chats show the alias and match both it and the peer’s own name', () => {
    expect(names(['bob'])).toEqual(['Bob'])
    expect(names(['robert'])).toEqual(['Bob'])
    expect(names(['bob', 'rob'])).toEqual(['Bob'])
  })

  test('removing the contact drops the local row and the alias', () => {
    store.putRelation({ user_id: PEER, contact: false, alias: null, blocked: false })
    expect(db.selectValue('SELECT count(*) FROM relations')).toBe(0)
    expect(names(['rob'])).toEqual(['Robert'])
  })
})
