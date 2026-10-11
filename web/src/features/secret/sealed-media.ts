// 秘密聊天的媒体：在标签页里取回加密的对象、解开，交给 <img>、<video>、下载与播放器的是 object URL。
// 解开的 Blob 按对象键缓存在内存里（按字节数淘汰）；object URL 由每个使用者各自创建、卸载时回收，
// 淘汰缓存不会让还在显示的地址失效。密文照常经浏览器的 HTTP 缓存（对象写入后不变），解开的内容不落盘。
// 见 docs/architecture/05-media.md § 秘密聊天的媒体
import { useEffect, useState } from 'react'

import { mediaImgProps, mediaUrl } from '@/features/media/media-url'
import { openMedia, type MediaRole } from '@/sync/secret/format'

/** 解开的内容在内存里最多留多少字节 */
const CACHE_BYTES = 64 * 1024 * 1024

/** 一个加密的媒体对象：type 为解开后的 MIME 类型（预览图可以不给，浏览器自己识别） */
export type SealedRef = { key: string; secret: string; role: MediaRole; type?: string }

const blobs = new Map<string, { blob: Promise<Blob>; size: number }>()

/** 取回并解开一个对象；同一个对象只取一次，最近用过的留在内存里 */
export function openSealed(ref: SealedRef): Promise<Blob> {
  const hit = blobs.get(ref.key)
  if (hit) {
    blobs.delete(ref.key)
    blobs.set(ref.key, hit)
    return hit.blob
  }
  const entry = { blob: fetchAndOpen(ref), size: 0 }
  blobs.set(ref.key, entry)
  entry.blob.then(
    (blob) => {
      entry.size = blob.size
      trim()
    },
    () => {
      if (blobs.get(ref.key) === entry) blobs.delete(ref.key)
    },
  )
  return entry.blob
}

async function fetchAndOpen({ key, secret, role, type = '' }: SealedRef): Promise<Blob> {
  const res = await fetch(mediaUrl(key), { mode: 'cors', referrerPolicy: mediaImgProps.referrerPolicy })
  if (!res.ok) throw new Error(`sealed media fetch failed: ${res.status}`)
  return new Blob([await openMedia(await res.arrayBuffer(), secret, role)], { type })
}

function trim() {
  let total = 0
  for (const e of blobs.values()) total += e.size
  for (const [key, e] of blobs) {
    if (total <= CACHE_BYTES) break
    blobs.delete(key)
    total -= e.size
  }
}

/**
 * 一组加密对象的 object URL（与 refs 一一对应，null 的项没有）：还没解开或解不开的为 null。
 * 换了对象或卸载时回收
 */
export function useSealedUrls(refs: (SealedRef | null)[]): (string | null)[] {
  // refs 每次渲染都是新数组：按内容比较
  const id = JSON.stringify(refs)
  const [state, setState] = useState<{ id: string; urls: (string | null)[] }>({ id: '', urls: [] })

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const list = JSON.parse(id) as (SealedRef | null)[]
    const urls: (string | null)[] = list.map(() => null)
    list.forEach((ref, i) => {
      if (!ref) return
      openSealed(ref).then(
        (blob) => {
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          created.push(url)
          urls[i] = url
          setState({ id, urls: [...urls] })
        },
        (e: unknown) => console.error('sealed media failed', ref.key, e),
      )
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [id])

  return state.id === id ? state.urls : refs.map(() => null)
}

/** 解开后保存到本地 */
export async function saveSealed(ref: SealedRef, name: string) {
  const href = URL.createObjectURL(await openSealed(ref))
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}
