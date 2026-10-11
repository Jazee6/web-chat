import { useEffect, useState, type CSSProperties } from 'react'
import { LinkIcon } from 'lucide-react'
import type { LinkPreview } from 'shared/protocol'
import { inviteCodeOf, linkOnly } from 'shared/text'

import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Item, ItemContent, ItemDescription, ItemHeader, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { UserAvatar } from '@/components/user-avatar'
import { mediaImgProps, mediaUrl, thumbhashUrl } from '@/features/media/media-url'
import { readBlob } from '@/sync/blobs'
import type { PreparedPreview } from '@/sync/bridge'
import { displayHost, useOpenLink } from './open-link'
import type { OutboxLink } from '@/sync/store'

/** 卡片大图的宽高比限制在 1:1 到 2:1 之间，超出的裁切 */
const clampRatio = (w: number, h: number) => Math.min(2, Math.max(1, w / h))

type CardPhoto = { src: string | null; w: number; h: number; thumbhash: string }

/**
 * 链接预览卡片（iMessage 样式）：有图时大图在上、标题与域名在下；没图时左边是链接图标；
 * 邀请卡片显示发送时的群名与人数。只有本站的邀请链接才显示成邀请卡片，否则按普通链接显示
 */
function LinkCard({ url, preview, photo, loading }: { url: URL; preview: PreparedPreview; photo?: CardPhoto; loading?: boolean }) {
  const open = useOpenLink(url)
  const host = displayHost(url)
  const invite = preview.type === 'invite' && inviteCodeOf(url, location.origin) !== null

  if (invite) {
    return (
      <Item variant="link" size="flush" render={<a {...open} />}>
        <ItemMedia>
          <UserAvatar name={preview.title} image={null} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{preview.title}</ItemTitle>
          <ItemDescription>
            Group invite · {preview.member_count === 1 ? '1 member' : `${preview.member_count} members`}
          </ItemDescription>
        </ItemContent>
      </Item>
    )
  }

  const title = preview.type === 'web' ? preview.title : null
  return (
    <Item variant="link" size="flush" render={<a {...open} />}>
      {photo && (
        <ItemHeader>
          <AspectRatio ratio={clampRatio(photo.w, photo.h)} className="w-full">
            {/* ThumbHash 作为背景，图片加载完成前先显示模糊的占位 */}
            <img
              src={photo.src ?? thumbhashUrl(photo.thumbhash)}
              alt=""
              {...mediaImgProps}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 size-full bg-(image:--thumb) bg-cover bg-center object-cover"
              style={{ '--thumb': `url(${thumbhashUrl(photo.thumbhash)})` } as CSSProperties}
            />
          </AspectRatio>
        </ItemHeader>
      )}
      {!photo && <ItemMedia variant="icon">{loading ? <Spinner /> : <LinkIcon />}</ItemMedia>}
      <ItemContent>
        {/* 没有标题时标题行就是域名，不再重复一行 */}
        <ItemTitle>{title ?? host}</ItemTitle>
        {title && <ItemDescription>{host}</ItemDescription>}
      </ItemContent>
    </Item>
  )
}

/** 已发送的纯链接消息的卡片；正文不是纯链接时（不该出现）返回 null，由调用方显示正文 */
export function SentLinkCard({ text, json }: { text: string; json: string }) {
  const url = linkOnly(text)
  if (!url) return null
  const preview = JSON.parse(json) as LinkPreview
  if (preview.type === 'invite') return <LinkCard url={url} preview={preview} />
  const photo = preview.photo && { src: mediaUrl(preview.photo.key), w: preview.photo.w, h: preview.photo.h, thumbhash: preview.photo.thumbhash }
  return <LinkCard url={url} preview={{ type: 'web', title: preview.title }} photo={photo} />
}

/** 发件箱里的卡片：还没抓到时只有域名与转圈，卡片图片从 OPFS 读出 */
export function PendingLinkCard({ text, json, randomId }: { text: string; json: string; randomId: number }) {
  const url = linkOnly(text)
  const link = JSON.parse(json) as OutboxLink
  const file = link.state === 'ready' ? link.photo?.file : undefined
  const src = useLocalBlob(randomId, file)
  if (!url) return null
  if (link.state === 'pending') return <LinkCard url={url} preview={{ type: 'web', title: null }} loading />
  const photo = link.photo && { src, w: link.photo.w, h: link.photo.h, thumbhash: link.photo.thumbhash }
  return <LinkCard url={url} preview={link.preview} photo={photo} />
}

function useLocalBlob(randomId: number, file: string | undefined) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return
    let url: string | null = null
    let cancelled = false
    readBlob(randomId, file).then(
      (blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      },
      // 已发送成功、暂存文件已删除：这一行马上会被已发送的消息替换
      () => {},
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [randomId, file])
  return file ? src : null
}
