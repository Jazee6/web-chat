// 联系人与拉黑的本地查询。关系存在 relations 表，资料可能还没拉到（name 为 null）
import { useEffect, useState } from 'react'

import { likePattern, type SqlQuery } from '@/features/search/sql'
import { topics } from '@/sync/bridge'
import { call, OpFailure, useConnectionStatus } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'

/** name 为备注名或对方自己的名字；own_name 总是对方自己的名字 */
export type ContactRow = { id: string; name: string | null; own_name: string | null; image: string | null; blocked: number }

const PEOPLE_FROM = `
  SELECT r.user_id AS id, coalesce(r.alias, u.name) AS name, u.name AS own_name, u.image, r.blocked
  FROM relations r LEFT JOIN users u ON u.id = r.user_id`

const BY_NAME = 'ORDER BY coalesce(r.alias, u.name) COLLATE NOCASE, r.user_id'

/**
 * 联系人，按名字排序；有关键词时按备注名或名字筛选（全部命中）。
 * withoutDialog：只要还没有对话的，全局搜索里有对话的已经在对话结果里
 */
export function contactsQuery(terms: string[], { withoutDialog = false } = {}): SqlQuery {
  const where = [
    'r.contact = 1',
    ...(withoutDialog ? ["NOT EXISTS (SELECT 1 FROM dialogs d WHERE d.peer_id = r.user_id AND d.kind = 'private')"] : []),
    ...terms.map(() => "(r.alias LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"),
  ]
  return {
    sql: `${PEOPLE_FROM} WHERE ${where.join(' AND ')} ${BY_NAME}`,
    params: terms.flatMap((t) => [likePattern(t), likePattern(t)]),
  }
}

export function useContacts(terms: string[] = []): ContactRow[] | undefined {
  const q = contactsQuery(terms)
  return useLiveQuery<ContactRow>(q.sql, q.params, [topics.users])
}

export function useBlockedUsers(): ContactRow[] | undefined {
  return useLiveQuery<ContactRow>(`${PEOPLE_FROM} WHERE r.blocked = 1 ${BY_NAME}`, [], [topics.users])
}

/** 某个用户的资料与我和他的关系；资料还没拉到时 name 为 null。undefined 表示仍在加载 */
export type Person = { name: string | null; own_name: string | null; image: string | null; contact: boolean; alias: string | null; blocked: boolean }

export function usePerson(userId: string): Person | undefined {
  const rows = useLiveQuery<{
    name: string | null
    own_name: string | null
    image: string | null
    contact: number | null
    alias: string | null
    blocked: number | null
  }>(
    `SELECT coalesce(r.alias, u.name) AS name, u.name AS own_name, u.image, r.contact, r.alias, r.blocked
     FROM (SELECT ? AS id) x LEFT JOIN users u ON u.id = x.id LEFT JOIN relations r ON r.user_id = x.id`,
    [userId],
    [topics.users],
  )
  const row = rows?.[0]
  if (!row) return undefined
  return { ...row, contact: row.contact === 1, blocked: row.blocked === 1 }
}

/**
 * 本地没有这个人时向服务端确认他是否存在：undefined 为仍在确认（含离线，连上后再问），
 * missing 为查无此人，failed 为出错
 */
export function useUserLookup(userId: string, enabled: boolean) {
  const status = useConnectionStatus()
  const [result, setResult] = useState<{ userId: string; value: 'found' | 'missing' | 'failed' } | null>(null)

  useEffect(() => {
    if (!enabled || status !== 'online') return
    let live = true
    call('loadUser', { userId })
      .then((exists) => live && setResult({ userId, value: exists ? 'found' : 'missing' }))
      .catch((e: unknown) => {
        if (live && !(e instanceof OpFailure && e.code === 'offline')) setResult({ userId, value: 'failed' })
      })
    return () => {
      live = false
    }
  }, [userId, enabled, status])

  return result?.userId === userId ? result.value : undefined
}
