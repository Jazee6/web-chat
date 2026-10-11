// 本地保存的秘密聊天密钥材料（KeyPackage 私钥、MLS 状态、纪元密钥）再包一层：
// 用存在 IndexedDB 里、不可导出的 AES-GCM 密钥加密后才写进本地库，只拿到本地库文件的人解不开
const DB = 'web-chat-keys'
const STORE = 'keys'
const WRAP_KEY = 'wrap'

let key: Promise<CryptoKey> | null = null

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadKey(): Promise<CryptoKey> {
  const open = indexedDB.open(DB, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  const db = await request(open)
  try {
    const existing = (await request(db.transaction(STORE).objectStore(STORE).get(WRAP_KEY))) as CryptoKey | undefined
    if (existing) return existing
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    // 两个 Worker 同时创建时以先写入的为准
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const raced = (await request(store.get(WRAP_KEY))) as CryptoKey | undefined
    if (raced) return raced
    await request(store.add(created, WRAP_KEY))
    return created
  } finally {
    db.close()
  }
}

const wrapKey = () => (key ??= loadKey().catch((e: unknown) => {
  key = null
  throw e
}))

/** iv（12 字节）| 密文 */
export async function wrap(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), bytes.slice()))
  const out = new Uint8Array(12 + body.length)
  out.set(iv)
  out.set(body, 12)
  return out
}

export async function unwrap(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await wrapKey(), bytes.slice(12)))
}
