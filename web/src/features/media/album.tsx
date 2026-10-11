import type { ComponentProps, ReactNode, Ref } from 'react'
import { PlayIcon } from 'lucide-react'
import { formatDuration } from 'shared/text'

import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { SealedRef } from '@/features/secret/sealed-media'
import { mediaImgProps, thumbhashUrl } from './media-url'
import { albumRows } from './album-rows'
import { usePhotoViewer } from './use-photo-viewer'

/**
 * 相册里的一项：preview 用于气泡与网格（视频为封面），full 用于全屏查看与下载（视频为 MP4）。
 * GIF 在气泡里也显示 full，才能播放动画；video 为视频的时长（秒），图片没有。
 * 秘密聊天的 full 是加密的对象，打开查看时才取回解开
 */
export type AlbumPhoto = {
  full: string | SealedRef
  preview: string
  w: number
  h: number
  thumbhash: string
  animated: boolean
  name: string
  video?: { duration: number }
}

/** 单张图片的宽高比限制在这个范围内，过长过宽的图在气泡里裁切显示 */
const MIN_RATIO = 0.5
const MAX_RATIO = 2

/**
 * 1 项按原始比例显示，2–10 项分成每行 2–3 项、铺满宽度的几行（最后一行不会只剩一张），视频显示封面与时长；
 * 点开全屏查看，在本相册内切换。
 * saveable：查看器里可以把图片添加到我的贴纸（已发送、不在秘密聊天里的）
 */
export function Album({ photos, saveable = false }: { photos: AlbumPhoto[]; saveable?: boolean }) {
  const { thumbRef, openAt, viewer } = usePhotoViewer(photos, { saveable })
  const cells = albumCells(photos)

  return (
    <>
      <AlbumFrame data-photo-frame>
        {photos.map((photo, i) => (
          <AlbumCell key={i} cell={cells[i]!}>
            {/* data-photo：消息右键菜单据此知道按在哪张图上（视频不能复制，不带） */}
            <button
              type="button"
              data-photo={photo.video || typeof photo.full !== 'string' ? undefined : photo.full}
              className="relative block size-full cursor-zoom-in"
              aria-label={`Open ${photo.video ? 'video' : 'photo'} ${i + 1}`}
              onClick={() => openAt(i)}
            >
              <PhotoImage photo={photo} ref={thumbRef(i)} />
              {photo.video && (
                <Badge variant="overlay" className="absolute bottom-2 left-2">
                  <PlayIcon data-icon="inline-start" />
                  {formatDuration(photo.video.duration)}
                </Badge>
              )}
            </button>
          </AlbumCell>
        ))}
      </AlbumFrame>
      {viewer}
    </>
  )
}

/** 相册还没准备好时的占位：与 Album 同样的外框与格子，大小按各项的宽高算 */
export function AlbumSkeleton({ items }: { items: { w: number; h: number }[] }) {
  return (
    <AlbumFrame>
      {albumCells(items).map((cell, i) => (
        <AlbumCell key={i} cell={cell}>
          <Skeleton variant="media" className="size-full" />
        </AlbumCell>
      ))}
    </AlbumFrame>
  )
}

function AlbumFrame(props: ComponentProps<'div'>) {
  return <div className="grid w-72 grid-cols-6 gap-0.5 overflow-hidden rounded-3xl sm:w-80" {...props} />
}

type Cell = { cols: 6 | 3 | 2; ratio: number }

function AlbumCell({ cell, children }: { cell: Cell; children: ReactNode }) {
  return (
    <AspectRatio className={cell.cols === 6 ? 'col-span-6' : cell.cols === 3 ? 'col-span-3' : 'col-span-2'} ratio={cell.ratio}>
      {children}
    </AspectRatio>
  )
}

/**
 * 每项在 6 列网格里占的列（一行 1、2、3 项各占 6、3、2 列）与宽高比。
 * 全是 2 项的行时为方格，与 3 项的行混排时 2 项的格子放宽到 3:2，各行一样高
 */
function albumCells(items: { w: number; h: number }[]): Cell[] {
  const rows = albumRows(items.length)
  const perRow = rows.flatMap((n) => Array<number>(n).fill(n))
  const mixed = rows.some((n) => n !== 2)
  return items.map((item, i) => ({
    cols: items.length === 1 ? 6 : perRow[i] === 2 ? 3 : 2,
    ratio:
      items.length === 1
        ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, item.w / item.h))
        : perRow[i] === 2 && mixed
          ? 3 / 2
          : 1,
  }))
}

/** ThumbHash 作为背景，图片加载完成前先显示模糊的占位 */
function PhotoImage({ photo, ref }: { photo: AlbumPhoto; ref?: Ref<HTMLImageElement> }) {
  return (
    <img
      ref={ref}
      src={photo.animated && typeof photo.full === 'string' ? photo.full : photo.preview}
      alt=""
      {...mediaImgProps}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="size-full bg-(image:--thumb) bg-cover bg-center object-cover"
      style={{ '--thumb': `url(${thumbhashUrl(photo.thumbhash)})` } as React.CSSProperties}
    />
  )
}
