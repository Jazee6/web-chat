import { useEffect, useState } from 'react'
import { inviteCodeOf, linkOnly } from 'shared/text'

import { useDebounced } from '@/hooks/use-debounced'
import type { OutgoingLink, PreparedPreview } from '@/sync/bridge'
import { call } from '@/sync/client'
import { resolveWebLink, type ResolvedPhoto } from './resolve'

/** 停止输入多久后才开始抓取 */
const DEBOUNCE_MS = 400

export type Resolved = { href: string; preview: PreparedPreview; photo?: ResolvedPhoto; thumb?: string }

/** 准备一张卡片：本站的邀请链接问服务端要群名与人数，其他的请 Worker 抓取；失败时只有域名 */
async function resolve(url: URL, signal: AbortSignal): Promise<Resolved> {
  const code = inviteCodeOf(url, location.origin)
  if (code) {
    try {
      const r = await call('checkInvite', { code })
      return { href: url.href, preview: { type: 'invite', title: r.title, member_count: r.member_count } }
    } catch {
      return { href: url.href, preview: { type: 'web', title: null } }
    }
  }
  try {
    const web = await resolveWebLink(url, signal)
    return { href: url.href, preview: { type: 'web', title: web.title }, ...(web.photo ? { photo: web.photo } : {}) }
  } catch (e) {
    if (signal.aborted) throw e
    return { href: url.href, preview: { type: 'web', title: null } }
  }
}

/**
 * 输入框里的链接预览：正文恰好是一个链接时抓取卡片，用户可以关掉（这个链接不再出卡片）。
 * outgoing 为发送时交给发件箱的卡片：已经抓到的直接带上，还没抓到的交给同步 Worker 在发送时抓
 */
export function useLinkPreview(text: string, enabled: boolean) {
  const url = enabled ? linkOnly(text) : null
  const href = url?.href ?? null
  const settled = useDebounced(href, DEBOUNCE_MS)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Resolved | null>(null)

  useEffect(() => {
    if (!settled || settled === dismissed) return
    const ac = new AbortController()
    resolve(new URL(settled), ac.signal).then(
      (r) => setResolved({ ...r, ...(r.photo ? { thumb: URL.createObjectURL(r.photo.blob) } : {}) }),
      () => {},
    )
    return () => ac.abort()
  }, [settled, dismissed])

  // 预览图的 object URL 随卡片一起回收
  useEffect(() => {
    const thumb = resolved?.thumb
    return () => {
      if (thumb) URL.revokeObjectURL(thumb)
    }
  }, [resolved])

  const active = url !== null && href !== dismissed
  const current = active && resolved?.href === href ? resolved : null
  const outgoing: OutgoingLink | undefined = !active
    ? undefined
    : current
      ? { state: 'ready', preview: current.preview, ...(current.photo ? { photo: current.photo } : {}) }
      : { state: 'pending' }

  return {
    url: active ? url : null,
    resolved: current,
    outgoing,
    dismiss: () => setDismissed(href),
  }
}
