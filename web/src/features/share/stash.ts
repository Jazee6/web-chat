// 分享目标（Web Share Target，仅 Chromium）：系统分享面板把文字、链接或文件 POST 到 /share，
// Service Worker 暂存到 IndexedDB 后跳转到 /share 页面；用户选好会话后，输入框取走并预填，由用户确认后发送。
// 本模块同时运行在 SW 与标签页里。见 docs/architecture/07-client.md § Service Worker 与安装
import { done, openDatabase } from '@/lib/idb'

const DB_NAME = 'share'
const STORE = 'pending'
const KEY = 'current'

/** 一次分享的内容：title / text / url 合成的文字，以及文件 */
export type SharedContent = { text: string; files: File[] }

const openDb = () => openDatabase(DB_NAME, 1, (db) => db.createObjectStore(STORE))

async function store(mode: IDBTransactionMode) {
  return (await openDb()).transaction(STORE, mode).objectStore(STORE)
}

/** SW 收到分享：只保留最新的一次 */
export async function stashShare(form: FormData) {
  const field = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  const text = [...new Set(['title', 'text', 'url'].map(field).filter(Boolean))].join('\n')
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  await done((await store('readwrite')).put({ text, files } satisfies SharedContent, KEY))
}

export async function readShare(): Promise<SharedContent | null> {
  return ((await done((await store('readonly')).get(KEY))) as SharedContent | undefined) ?? null
}

export async function clearShare() {
  await done((await store('readwrite')).delete(KEY))
}
