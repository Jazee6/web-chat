// 媒体缓存：Service Worker 把媒体域名上的图片（预览图与大图）存进 Cache Storage，超过本机上限时按最近使用淘汰。
// 索引（每张图的大小与最近使用时间）和上限存在 IndexedDB：SW 与标签页都要读写，而 SW 用不了本地 SQLite。
// 本模块同时运行在 SW 与标签页里，只用两边都有的 API。见 docs/architecture/05-media.md § 客户端缓存
import { done, openDatabase } from '@/lib/idb'

const CACHE = 'media'
const DB_NAME = 'media-cache'
const ENTRIES = 'entries'
const META = 'meta'
const LIMIT_KEY = 'limit'

const MB = 1024 * 1024
/** 上限的选项；null 表示不限（仍受浏览器配额约束） */
export const CACHE_LIMITS = [256 * MB, 1024 * MB, 4096 * MB, null] as const
export type CacheLimit = (typeof CACHE_LIMITS)[number]
const DEFAULT_CACHE_LIMIT: CacheLimit = 1024 * MB
/** 超过上限时淘汰到上限的 90%，免得每存一张就淘汰一次 */
const TRIM_TO = 0.9
/** 最近使用时间最多每小时更新一次，免得每次渲染都写 IndexedDB */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

type Entry = { url: string; size: number; used: number }

let db: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  db ??= openDatabase(DB_NAME, 1, (created) => {
    created.createObjectStore(ENTRIES, { keyPath: 'url' }).createIndex('used', 'used')
    created.createObjectStore(META)
  }).catch((e: unknown) => {
    db = null
    throw e
  })
  return db
}

async function store(name: string, mode: IDBTransactionMode) {
  return (await openDb()).transaction(name, mode).objectStore(name)
}

/** 缓存命中时返回响应，并按需更新最近使用时间 */
export async function matchMedia(url: string): Promise<Response | undefined> {
  const hit = await caches.match(url, { cacheName: CACHE, ignoreVary: true })
  if (hit) void touch(url).catch(() => {})
  return hit
}

async function touch(url: string) {
  const entries = await store(ENTRIES, 'readwrite')
  const entry = await done(entries.get(url) as IDBRequest<Entry | undefined>)
  const now = Date.now()
  if (entry && now - entry.used >= TOUCH_INTERVAL_MS) await done(entries.put({ ...entry, used: now }))
}

let trimTimer: ReturnType<typeof setTimeout> | null = null

/** 存入一张图，稍后检查是否超过上限（连续加载很多图时只检查一次） */
export async function putMedia(url: string, res: Response) {
  const size = Number(res.headers.get('Content-Length')) || (await res.clone().blob()).size
  await caches.open(CACHE).then((cache) => cache.put(url, res))
  await done((await store(ENTRIES, 'readwrite')).put({ url, size, used: Date.now() } satisfies Entry))
  trimTimer ??= setTimeout(() => {
    trimTimer = null
    void trimMedia().catch(() => {})
  }, 5000)
}

export async function mediaCacheLimit(): Promise<CacheLimit> {
  const value = (await done((await store(META, 'readonly')).get(LIMIT_KEY))) as CacheLimit | undefined
  return value === undefined ? DEFAULT_CACHE_LIMIT : value
}

export async function setMediaCacheLimit(limit: CacheLimit) {
  await done((await store(META, 'readwrite')).put(limit, LIMIT_KEY))
  await trimMedia()
}

/** 已缓存的字节数 */
export async function mediaCacheUsage(): Promise<number> {
  const entries = (await done((await store(ENTRIES, 'readonly')).getAll())) as Entry[]
  return entries.reduce((n, e) => n + e.size, 0)
}

/** 超过上限时从最久没用的开始删，直到上限的 90% */
async function trimMedia() {
  const limit = await mediaCacheLimit()
  if (limit === null) return
  const entries = (await done((await store(ENTRIES, 'readonly')).index('used').getAll())) as Entry[]
  let total = entries.reduce((n, e) => n + e.size, 0)
  if (total <= limit) return
  const cache = await caches.open(CACHE)
  const evicted: string[] = []
  for (const e of entries) {
    if (total <= limit * TRIM_TO) break
    await cache.delete(e.url)
    evicted.push(e.url)
    total -= e.size
  }
  const index = await store(ENTRIES, 'readwrite')
  await Promise.all(evicted.map((url) => done(index.delete(url))))
}

/** 清除缓存：设置里的"清除"，以及退出登录、清空本地库时。上限是本机设置，保留 */
export async function clearMediaCache() {
  await caches.delete(CACHE)
  await done((await store(ENTRIES, 'readwrite')).clear())
}
