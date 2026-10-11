import { useEffect, useRef, useState } from 'react'
import { MAX_ALBUM_SIZE, MAX_MEDIA_BYTES, type MessageEntity } from 'shared/protocol'

import { toast } from '@/components/ui/toast'
import { isPhotoCandidate, prepareFile, preparePhoto } from '@/features/media/prepare'
import { isVideoCandidate, prepareVideo, type VideoResult } from '@/features/media/video'
import type { OutgoingLink, OutgoingMedia, OutgoingMessage } from '@/sync/bridge'
import { randomId } from '@/sync/logic'

/**
 * 附件栏里的一项；media 为 null 表示还在本地处理。
 * photo：进相册（图片或视频；处理中就按相册里的一项占位，处理不了时改为 false，按文件发送）；
 * thumb、full 为预览图（视频为封面）与大图（视频为 MP4）的 object URL；progress 为视频的转码进度（0–1），
 * 还没开始为 null，不是视频为 undefined
 */
export type Attachment = {
  id: string
  name: string
  photo: boolean
  thumb: string | null
  full: string | null
  progress?: number | null
  media: OutgoingMedia | null
}

/** 从哪个入口加入：图片与视频入口压缩后进相册，文件入口原样发送；粘贴与拖拽按格式判断 */
export type AttachAs = 'photo' | 'file' | 'auto'

/** 附件栏：加入时就开始本地预处理（压缩、转码、预览图、ThumbHash），不联网 */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([])
  // 卸载时回收预览图；用 ref 拿到最新的列表
  const latest = useRef(items)
  useEffect(() => {
    latest.current = items
  })
  // 正在转码的视频：移除这一项或卸载时中止
  const jobs = useRef(new Map<string, AbortController>())
  const alive = useRef(true)
  useEffect(() => {
    const running = jobs.current
    alive.current = true
    return () => {
      alive.current = false
      for (const job of running.values()) job.abort()
      revoke(latest.current)
    }
  }, [])

  const update = (id: string, patch: Partial<Attachment>) =>
    setItems((list) => {
      if (list.some((a) => a.id === id)) return list.map((a) => (a.id === id ? { ...a, ...patch } : a))
      // 处理完成前已被移除
      if (patch.thumb) URL.revokeObjectURL(patch.thumb)
      if (patch.full) URL.revokeObjectURL(patch.full)
      return list
    })

  /** 视频处理完：处理不了或太长的按文件发送，原文件也超过上限时移除并提示 */
  const settleVideo = (item: Attachment, file: File, result: VideoResult) => {
    if (result.ok) {
      const { ok: _, ...video } = result
      return update(item.id, {
        progress: undefined,
        media: { type: 'video', ...video },
        thumb: URL.createObjectURL(video.preview),
        full: URL.createObjectURL(video.file),
      })
    }
    if (file.size <= MAX_MEDIA_BYTES) return update(item.id, { photo: false, progress: undefined, media: prepareFile(file) })
    remove(item.id)
    toast.add(
      result.reason === 'too_long'
        ? { type: 'error', title: `“${item.name}” is too long`, description: 'Videos can be up to about 3 minutes.' }
        : { type: 'error', title: `Couldn't process “${item.name}”`, description: 'It’s also too large to send as a file.' },
    )
  }

  const add = (files: File[], as: AttachAs) => {
    const room = MAX_ALBUM_SIZE - latest.current.length
    if (files.length > room) toast.add({ type: 'error', title: `You can send up to ${MAX_ALBUM_SIZE} attachments at a time` })
    const accepted: Attachment[] = []
    for (const file of files.slice(0, Math.max(0, room))) {
      // 视频要转码，原文件多大都可以；转码后的大小另有上限
      const video = as !== 'file' && isVideoCandidate(file)
      if (!video && file.size > MAX_MEDIA_BYTES) {
        toast.add({ type: 'error', title: `“${file.name}” is larger than 20 MB` })
        continue
      }
      const item: Attachment = { id: crypto.randomUUID(), name: file.name || 'file', photo: false, thumb: null, full: null, media: null }
      accepted.push(item)
      if (video) {
        item.photo = true
        item.progress = null
        const job = new AbortController()
        jobs.current.set(item.id, job)
        void prepareVideo(file, (progress) => update(item.id, { progress }), job.signal)
          .then(
            (result) => settleVideo(item, file, result),
            // 中止：这一项已被移除
            () => {},
          )
          .finally(() => jobs.current.delete(item.id))
        continue
      }
      if (as === 'file' || (as === 'auto' && !isPhotoCandidate(file))) {
        item.media = prepareFile(file)
        continue
      }
      item.photo = true
      // 解码失败（例如 Chrome 里的 HEIC）的改为按文件发送
      const asFile = { photo: false, media: prepareFile(file) }
      void preparePhoto(file).then(
        (photo) =>
          update(
            item.id,
            photo
              ? { media: photo, thumb: URL.createObjectURL(photo.preview), full: URL.createObjectURL(photo.file) }
              : asFile,
          ),
        () => update(item.id, asFile),
      )
    }
    if (accepted.length > 0) setItems((list) => [...list, ...accepted])
  }

  const remove = (id: string) => {
    jobs.current.get(id)?.abort()
    setItems((list) => {
      revoke(list.filter((a) => a.id === id))
      return list.filter((a) => a.id !== id)
    })
  }

  const clear = () => {
    for (const job of jobs.current.values()) job.abort()
    revoke(latest.current)
    setItems([])
  }

  /** 发送：交出附件栏里的全部附件，预览图先留着；发送成功后 discard，失败时 putBack */
  const take = () => {
    const list = latest.current
    latest.current = []
    setItems([])
    return list
  }

  /** 放回发送失败的附件；restore 为 false、附件栏里已有新的或已卸载时不放回，直接回收。返回是否放回了 */
  const putBack = (list: Attachment[], restore: boolean) => {
    if (!restore || !alive.current || latest.current.length > 0) {
      revoke(list)
      return false
    }
    latest.current = list
    setItems(list)
    return true
  }

  return { items, add, remove, clear, take, putBack, discard: revoke, ready: items.every((a) => a.media !== null) }
}

function revoke(items: Attachment[]) {
  for (const a of items) {
    if (a.thumb) URL.revokeObjectURL(a.thumb)
    if (a.full) URL.revokeObjectURL(a.full)
  }
}

/**
 * 一次发送拆成的消息：先是相册（全部图片与视频，按加入的顺序，最多 MAX_ALBUM_SIZE 项），再是各个文件，
 * 文字最后（纯链接时带上卡片）。附件栏最多 MAX_ALBUM_SIZE 项，所以最多一个相册
 */
export function composeMessages(items: Attachment[], text: string, entities: MessageEntity[] = [], link?: OutgoingLink): OutgoingMessage[] {
  const media = items.flatMap((a) => (a.media ? [a.media] : []))
  const photos = media.filter((m) => m.type === 'photo' || m.type === 'video')
  const messages: OutgoingMessage[] = []
  if (photos.length > 0) messages.push({ randomId: randomId(), media: photos })
  for (const file of media.filter((m) => m.type === 'file')) messages.push({ randomId: randomId(), media: [file] })
  if (text) messages.push({ randomId: randomId(), text, ...(entities.length > 0 ? { entities } : {}), ...(link ? { link } : {}) })
  return messages
}
