import type { WheelEvent } from 'react'
import { FileIcon, XIcon } from 'lucide-react'
import { formatDuration } from 'shared/text'

import {
  Attachment as AttachmentItem,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import type { AlbumPhoto } from '@/features/media/album'
import { usePhotoViewer } from '@/features/media/use-photo-viewer'
import { formatBytes } from '@/lib/format'
import type { OutgoingMedia } from '@/sync/bridge'
import type { Attachment } from './attachments'

/**
 * 附件栏：一行横向滚动，竖向滚轮也能横向滚动。图片只显示图片本身，视频显示封面与时长，点开全屏查看，
 * 悬停时右上角出现删除；文件显示图标、文件名与大小；还在本地处理的显示 Spinner，视频转码显示进度。
 * 用负边距把输入组顶部与两侧的留白收窄到 8px、与下方输入框的间距收窄 4px（前面有目标条时不收顶部）
 */
export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  const ready = items.filter((a) => a.full && (a.media?.type === 'photo' || a.media?.type === 'video'))
  const photos = ready.map((a): AlbumPhoto => {
    const media = a.media as Extract<OutgoingMedia, { type: 'photo' | 'video' }>
    return {
      full: a.full!,
      preview: a.thumb!,
      w: media.w,
      h: media.h,
      thumbhash: media.thumbhash,
      animated: media.type === 'photo' && media.mime === 'image/gif',
      name: a.name,
      ...(media.type === 'video' ? { video: { duration: media.duration } } : {}),
    }
  })
  const { thumbRef, openAt, viewer } = usePhotoViewer(photos, { actions: false })

  return (
    <>
      <AttachmentGroup className="-mx-1 -mb-1 first:-mt-2" onWheel={scrollSideways}>
        {items.map((a) => {
          if (a.photo) {
            const i = ready.indexOf(a)
            return (
              // 纯图片，与文件卡片同高：文件卡片约 47px，图片取 48px，同一行里文件卡片会被拉伸到一样高。
              // 外框按项吸附；删除按钮放在裁切的外框之外，聚焦环不被裁掉
              <div key={a.id} className="group/photo relative size-12 shrink-0 snap-start">
                {i >= 0 ? (
                  <button
                    type="button"
                    data-photo-frame
                    className="relative block size-full cursor-zoom-in overflow-hidden rounded-xl"
                    aria-label={`Open ${a.name}`}
                    onClick={() => openAt(i)}
                  >
                    <img ref={thumbRef(i)} src={a.thumb!} alt="" draggable={false} className="size-full object-cover" />
                    {a.media?.type === 'video' && (
                      <Badge variant="overlay" className="absolute bottom-0.5 left-0.5">
                        {formatDuration(a.media.duration)}
                      </Badge>
                    )}
                  </button>
                ) : (
                  <div className="flex size-full items-center justify-center rounded-xl bg-muted">
                    {a.progress !== undefined ? (
                      <Progress
                        value={a.progress === null ? null : Math.round(a.progress * 100)}
                        size="sm"
                        aria-label={`Processing ${a.name}`}
                        className="w-8"
                      />
                    ) : (
                      <Spinner />
                    )}
                  </div>
                )}
                {/* 有悬停的设备上悬停或聚焦时才出现，触屏上常显 */}
                <div className="absolute top-1 right-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within/photo:opacity-100 pointer-fine:group-hover/photo:opacity-100">
                  <Button variant="floating" size="icon-xs" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}>
                    <XIcon />
                  </Button>
                </div>
              </div>
            )
          }
          return (
            <AttachmentItem key={a.id} size="sm" state={a.media ? 'done' : 'processing'} className="max-w-60">
              <AttachmentMedia>{a.media === null ? <Spinner /> : <FileIcon />}</AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{a.name}</AttachmentTitle>
                {a.media && <AttachmentDescription>{formatBytes(a.media.file.size)}</AttachmentDescription>}
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}>
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </AttachmentItem>
          )
        })}
      </AttachmentGroup>
      {viewer}
    </>
  )
}

/**
 * 鼠标滚轮只有竖向：转成横向滚动。附件栏按项吸附，平滑滚动让连续的小步（触控板）不会一下跳过好几项；
 * 横向为主的滚动（触控板横扫）交给浏览器
 */
function scrollSideways(e: WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
  el.scrollBy({ left: e.deltaY, behavior: 'smooth' })
}
