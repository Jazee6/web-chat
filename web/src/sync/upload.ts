// 同步 Worker 里的媒体上传：向 Worker 申请预签名 PUT，再把 OPFS 里暂存的文件直传 R2。
// 见 docs/architecture/05-media.md § 上传
import { SEALED_MEDIA_OVERHEAD, type STICKER_MIME_TYPES, type UploadRequest, type UploadResponse, type UploadTarget } from 'shared/protocol'
import { readBlob } from './blobs'
import { newMediaSecret, sealMedia } from './secret/format'
import type { OutboxLinkPhoto, OutboxMedia } from './store'

/** 同时进行的 PUT 数 */
const PUT_CONCURRENCY = 3

/** 上传失败：服务端拒绝签发，或 R2 拒绝了请求 */
export class UploadError extends Error {}

/** 网络不通：保持待发送，重连后再传 */
export class UploadOffline extends Error {}

/**
 * 上传一条消息里还没有对象键的媒体，每传完一个就调用 onUploaded 记下键（重启后不必重传）。
 * onProgress 的参数为 0–1。
 * sealed（秘密聊天）：每个媒体先生成一把密钥并记下，加密后再上传，服务端只知道加密后的大小
 */
export async function uploadMedia(
  randomId: number,
  items: OutboxMedia[],
  onUploaded: (items: OutboxMedia[]) => void,
  onProgress: (progress: number) => void,
  sealed = false,
) {
  if (sealed && items.some((m) => !m.secret)) {
    items = items.map((m) => (m.secret ? m : { ...m, secret: newMediaSecret() }))
    onUploaded(items)
  }
  const todo = items.map((m, i) => ({ m, i })).filter(({ m }) => !m.key || ('preview' in m && !m.preview_key))
  if (todo.length === 0) return
  const extra = sealed ? SEALED_MEDIA_OVERHEAD : 0

  const request: UploadRequest = {
    media: todo.map(({ m }): UploadRequest['media'][number] => {
      if (sealed) {
        return { type: 'sealed', size: m.size + extra, ...('preview' in m ? { preview_size: m.preview_size + extra } : {}) }
      }
      switch (m.type) {
        case 'photo':
          return { type: 'photo', mime: m.mime, size: m.size, preview_mime: m.preview_mime, preview_size: m.preview_size }
        case 'video':
          return { type: 'video', size: m.size, preview_mime: m.preview_mime, preview_size: m.preview_size }
        case 'file':
          return { type: 'file', name: m.name, mime: m.mime, size: m.size }
        case 'voice':
          return { type: 'voice', mime: m.mime, size: m.size }
        // 普通会话里的贴纸不上传（发的是我的贴纸里的那个对象），走不到这里
        case 'sticker':
          return { type: 'sticker', mime: m.mime, size: m.size }
      }
    }),
  }
  const targets = await sign(request)

  // 每个 PUT 一项：(媒体序号, 本地文件名, 签发的目标, 写回哪个字段)
  const puts = todo.flatMap(({ m, i }, n) => {
    const t = targets[n]!
    const list: { index: number; file: string; target: UploadTarget; field: 'key' | 'preview_key'; size: number }[] = [
      { index: i, file: m.file!, target: t.main, field: 'key', size: m.size + extra },
    ]
    if ('preview' in m) list.push({ index: i, file: m.preview, target: t.preview!, field: 'preview_key', size: m.preview_size + extra })
    return list
  })

  const total = puts.reduce((sum, p) => sum + p.size, 0)
  const loaded = new Array<number>(puts.length).fill(0)
  const done = items.map((m) => ({ ...m }))
  // 任何一个失败就中止其余的：整条消息都算失败，不再报告进度
  const abort = new AbortController()
  const report = () => {
    if (!abort.signal.aborted) onProgress(loaded.reduce((a, b) => a + b, 0) / total)
  }

  let next = 0
  const worker = async () => {
    while (next < puts.length && !abort.signal.aborted) {
      const n = next++
      const p = puts[n]!
      const file = await readBlob(randomId, p.file)
      const secret = items[p.index]!.secret
      const body = sealed ? await sealMedia(file, secret!, p.field === 'key' ? 'main' : 'preview') : file
      await put(p.target, body, abort.signal, (bytes) => {
        loaded[n] = bytes
        report()
      })
      // 大图（视频）与预览图（封面）分别写回；两者都有才算这一项上传完成
      ;(done[p.index] as Record<string, unknown>)[p.field] = p.target.key
      onUploaded(done)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, puts.length) }, worker))
  } finally {
    abort.abort()
  }
}

/** 上传链接预览卡片的图片（一个对象），返回对象键 */
export async function uploadLinkPhoto(randomId: number, photo: OutboxLinkPhoto): Promise<string> {
  const target = (await sign({ media: [{ type: 'link', mime: photo.mime, size: photo.size }] }))[0]!.main
  await put(target, await readBlob(randomId, photo.file), new AbortController().signal, () => {})
  return target.key
}

/** 上传要添加到我的贴纸的图片（一个对象），返回待发键 */
export async function uploadSticker(file: Blob, mime: (typeof STICKER_MIME_TYPES)[number]): Promise<string> {
  const target = (await sign({ media: [{ type: 'sticker', mime, size: file.size }] }))[0]!.main
  await put(target, file, new AbortController().signal, () => {})
  return target.key
}

/** 申请预签名 PUT，与请求一一对应 */
async function sign(request: UploadRequest): Promise<UploadResponse['media']> {
  let res: Response
  try {
    res = await fetch('/api/media/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    throw new UploadOffline()
  }
  if (!res.ok) throw new UploadError(`sign failed: ${res.status}`)
  return ((await res.json()) as UploadResponse).media
}

/** XHR 才有上传进度；预签名里签了 content-length，文件大小变了会被 R2 拒绝 */
function put(target: UploadTarget, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.onabort = () => reject(new UploadError('aborted'))
    xhr.open('PUT', target.url)
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`put failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new UploadOffline())
    xhr.send(body)
  })
}
