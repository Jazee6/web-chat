import { useEffect, useState } from 'react'
import { FileIcon } from 'lucide-react'
import type { Media, SealedMedia } from 'shared/protocol'

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toast'
import { fadeOutMotion } from '@/features/chat/item-motion'
import { saveSealed, useSealedUrls } from '@/features/secret/sealed-media'
import { StickerImage, StickerMessage } from '@/features/stickers/sticker-message'
import { formatBytes } from '@/lib/format'
import { readBlob } from '@/sync/blobs'
import type { OutboxMedia } from '@/sync/store'
import { useUploadProgress } from '@/sync/transient'
import { Album, AlbumSkeleton, type AlbumPhoto } from './album'
import { mediaUrl, thumbhashUrl } from './media-url'

/**
 * 已发送的媒体消息：图片、视频、文件与贴纸都从媒体域名读取；秘密聊天的取回后解开。
 * chatId / seq 为这条消息，贴纸据此添加到我的贴纸
 */
export function SentMedia({ json, chatId, seq }: { json: string; chatId: string; seq: number }) {
  const media = JSON.parse(json) as Media[]
  const [first] = media
  if (first && 'secret' in first) return <SealedSentMedia media={media as SealedMedia[]} />
  if (first?.type === 'file') return <FileAttachment name={first.name} size={first.size} href={mediaUrl(first.key)} />
  if (first?.type === 'sticker') return <StickerMessage sticker={first} chatId={chatId} seq={seq} />
  const photos = media.flatMap((m): AlbumPhoto[] =>
    m.type === 'photo' || m.type === 'video'
      ? [
          {
            full: mediaUrl(m.key),
            preview: mediaUrl(m.preview_key),
            w: m.w,
            h: m.h,
            thumbhash: m.thumbhash,
            animated: m.key.endsWith('.gif'),
            name: m.key.slice(m.key.lastIndexOf('/') + 1),
            ...(m.type === 'video' ? { video: { duration: m.duration } } : {}),
          },
        ]
      : [],
  )
  return <Album photos={photos} saveable />
}

/**
 * 秘密聊天里的媒体消息：气泡里的预览图（GIF 还有原图，才能播放动画）随显示解开，解开前是 ThumbHash 占位；
 * 大图与视频打开查看时才解开，文件点击下载时才解开
 */
function SealedSentMedia({ media }: { media: SealedMedia[] }) {
  const [first] = media
  const album = media.filter((m) => m.type === 'photo' || m.type === 'video')
  const gif = (m: (typeof album)[number]) => m.type === 'photo' && m.mime === 'image/gif'
  const previews = useSealedUrls(album.map((m) => ({ key: m.preview_key, secret: m.secret, role: 'preview' })))
  const gifs = useSealedUrls(album.map((m) => (gif(m) ? { key: m.key, secret: m.secret, role: 'main', type: 'image/gif' } : null)))

  if (first?.type === 'file') {
    const download = () =>
      saveSealed({ key: first.key, secret: first.secret, role: 'main', type: first.mime }, first.name).catch(() =>
        toast.add({ type: 'error', title: "Couldn't download the file" }),
      )
    return <FileAttachment name={first.name} size={first.size} onDownload={download} />
  }
  // 秘密聊天里的贴纸不能添加到我的贴纸
  if (first?.type === 'sticker') return <StickerMessage sticker={first} />
  const photos = album.map(
    (m, i): AlbumPhoto => ({
      full: gifs[i] ?? { key: m.key, secret: m.secret, role: 'main', type: m.type === 'photo' ? m.mime : 'video/mp4' },
      preview: previews[i] ?? thumbhashUrl(m.thumbhash),
      w: m.w,
      h: m.h,
      thumbhash: m.thumbhash,
      animated: gif(m),
      name: m.type === 'photo' ? `photo.${m.mime.split('/')[1]}` : 'video.mp4',
      ...(m.type === 'video' ? { video: { duration: m.duration } } : {}),
    }),
  )
  return <Album photos={photos} />
}

/**
 * 发件箱里的媒体消息：上传完成前显示 OPFS 里暂存的本地文件；贴纸显示我的贴纸里的那张。
 * 发送中显示进度：图片盖一层模糊蒙层、进度条在图上，文件把大小换成进度条；还没开始上传或等服务端确认时为不定进度。
 * 发送失败的不显示进度
 */
export function PendingMedia({ json, randomId, failed }: { json: string; randomId: number; failed: boolean }) {
  const media = JSON.parse(json) as OutboxMedia[]
  const urls = useLocalUrls(randomId, media)
  const uploaded = useUploadProgress(randomId)
  const progress = failed ? undefined : uploaded === undefined ? null : Math.round(uploaded * 100)
  const [first] = media

  if (first?.type === 'file') return <FileAttachment name={first.name} size={first.size} progress={progress} />
  if (first?.type === 'sticker') return <StickerImage src={mediaUrl(first.source)} w={first.w} h={first.h} />
  if (!urls) return <AlbumSkeleton items={media.filter((m) => m.type === 'photo' || m.type === 'video')} />
  return (
    <div className="relative w-fit">
      <Album
        photos={media.flatMap((m): AlbumPhoto[] => {
          if (m.type === 'video') {
            const { w, h, thumbhash, duration } = m
            const local = { full: urls.get(m.file)!, preview: urls.get(m.preview)! }
            return [{ ...local, w, h, thumbhash, animated: false, name: 'video.mp4', video: { duration } }]
          }
          return m.type === 'photo'
            ? [
                {
                  full: urls.get(m.file)!,
                  preview: urls.get(m.preview)!,
                  w: m.w,
                  h: m.h,
                  thumbhash: m.thumbhash,
                  animated: m.mime === 'image/gif',
                  name: `photo.${m.mime.split('/')[1]}`,
                },
              ]
            : []
        })}
      />
      {/* 不挡点击：发送中也能点开查看。发送成功后在换上的图片上淡出 */}
      {progress !== undefined && (
        <div ref={fadeOutMotion} className="app-blur pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl">
          <Progress value={progress} aria-label="Uploading" className="w-1/2" />
        </div>
      )}
    </div>
  )
}

/** 读出暂存的图片与视频并生成 object URL；卸载时回收。文件消息不需要预览 */
function useLocalUrls(randomId: number, media: OutboxMedia[]) {
  const [urls, setUrls] = useState<Map<string, string> | null>(null)
  const names = media.flatMap((m) => ('preview' in m ? [m.file, m.preview] : [])).join('\n')

  useEffect(() => {
    if (!names) return
    let cancelled = false
    const created: string[] = []
    void Promise.all(
      names.split('\n').map(async (name) => {
        const url = URL.createObjectURL(await readBlob(randomId, name))
        created.push(url)
        return [name, url] as const
      }),
    ).then(
      (entries) => !cancelled && setUrls(new Map(entries)),
      // 已发送成功、暂存文件已删除：这一行马上会被已发送的消息替换
      () => {},
    )
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [randomId, names])

  return urls
}

/**
 * 文件消息：已上传的点击即下载（对象带 Content-Disposition: attachment）；不带 Referer，原因见 mediaImgProps。
 * 秘密聊天的文件由 onDownload 解开后保存
 */
function FileAttachment({
  name,
  size,
  href,
  onDownload,
  progress,
}: {
  name: string
  size: number
  href?: string
  onDownload?: () => void
  /** 发送中的上传进度（0–100，null 为不定进度）；undefined 表示不在发送 */
  progress?: number | null
}) {
  // 外面留 1px：消息项开了 content-visibility（含 paint 裁切），卡片贴边的描边与聚焦环会被裁掉
  return (
    <div className="p-px">
      <Attachment state={progress !== undefined ? 'uploading' : 'done'} className="max-w-72">
        <AttachmentMedia>
          <FileIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{name}</AttachmentTitle>
          {progress !== undefined ? (
            <Progress ref={fadeOutMotion} value={progress} size="sm" aria-label="Uploading" className="mt-1.5 w-40 max-w-full" />
          ) : (
            <AttachmentDescription>{formatBytes(size)}</AttachmentDescription>
          )}
        </AttachmentContent>
        {href && (
          <AttachmentTrigger
            aria-label={`Download ${name}`}
            render={<a href={href} download={name} rel="noreferrer" />}
          />
        )}
        {onDownload && <AttachmentTrigger aria-label={`Download ${name}`} onClick={onDownload} />}
      </Attachment>
    </div>
  )
}
