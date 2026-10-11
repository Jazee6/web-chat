// 响应式查询：UI 只读本地库，相关主题变化时重新查询。
// 见 docs/architecture/07-client.md § 本地数据层
import { useSyncExternalStore } from 'react'
import type { Row } from './bridge'
import { call, onTopics } from './client'

type LiveQuery = {
  rows: Row[] | undefined
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Row[] | undefined
}

/** 取消订阅后仍保留结果，重新挂载时先显示旧数据再刷新，避免闪烁 */
const cache = new Map<string, LiveQuery>()
const CACHE_LIMIT = 200

function getLiveQuery(sql: string, params: unknown[], topics: string[]): LiveQuery {
  const key = JSON.stringify([sql, params])
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | null = null
  let version = 0

  const refresh = () => {
    const current = ++version
    void call('query', { sql, params }).then(
      (rows) => {
        // 丢弃过期的结果，只保留最后一次查询
        if (current !== version) return
        query.rows = rows
        for (const listener of listeners) listener()
      },
      (e: unknown) => console.error('live query failed', sql, e),
    )
  }

  const query: LiveQuery = {
    rows: undefined,
    subscribe(listener) {
      listeners.add(listener)
      if (!unsubscribe) {
        unsubscribe = onTopics(topics, refresh)
        refresh()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          unsubscribe?.()
          unsubscribe = null
        }
      }
    },
    getSnapshot: () => query.rows,
  }

  cache.set(key, query)
  if (cache.size > CACHE_LIMIT) {
    for (const [k, q] of cache) {
      if (cache.size <= CACHE_LIMIT) break
      if (q !== query) cache.delete(k)
    }
  }
  return query
}

/** 返回 undefined 表示首次查询尚未完成 */
export function useLiveQuery<T extends Row>(sql: string, params: unknown[], topics: string[]): T[] | undefined {
  const query = getLiveQuery(sql, params, topics)
  return useSyncExternalStore(query.subscribe, query.getSnapshot) as T[] | undefined
}
