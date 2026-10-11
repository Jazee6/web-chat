// 准备链接预览卡片：请 Worker 抓取网页的标题与 og:image，再把图片取回压缩。
// 标签页在输入时调用；输入时没来得及的，由同步 Worker 在发送时调用。见 docs/architecture/05-media.md § 链接预览
import type { LinkMeta } from 'shared/protocol'

import { prepareLinkPhoto } from '@/features/media/prepare'

/** 发送时最多等多久；超时就发成只有域名的卡片 */
export const LINK_WAIT_MS = 5000

export type ResolvedPhoto = NonNullable<Awaited<ReturnType<typeof prepareLinkPhoto>>>
export type ResolvedWeb = { title: string | null; photo?: ResolvedPhoto }

async function post(path: string, url: string, signal: AbortSignal) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
}

/**
 * 网页的标题与压缩好的图片。http 链接不抓取（Worker 只抓 https）；抓不到时都为空。
 * 网络错误与超时照常抛出，由调用方决定怎么降级
 */
export async function resolveWebLink(url: URL, signal: AbortSignal): Promise<ResolvedWeb> {
  if (url.protocol !== 'https:') return { title: null }
  const res = await post('/api/link-preview', url.href, signal)
  if (!res.ok) return { title: null }
  const meta = (await res.json()) as LinkMeta
  if (!meta.image) return { title: meta.title }
  // 图片取不到不影响标题
  try {
    const img = await post('/api/link-preview/image', meta.image, signal)
    const photo = img.ok ? await prepareLinkPhoto(await img.blob()) : null
    return photo ? { title: meta.title, photo } : { title: meta.title }
  } catch (e) {
    if (signal.aborted) throw e
    return { title: meta.title }
  }
}
