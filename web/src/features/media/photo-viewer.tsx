import { useEffect, useRef, useState, type Ref } from 'react'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, StickerIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useSealedUrls } from '@/features/secret/sealed-media'
import { addStickerFromImage } from '@/features/stickers/add'
import { pause as pauseVoice } from '@/features/voice/player'
import { cn } from '@/lib/utils'
import { mediaImgProps } from './media-url'
import type { AlbumPhoto } from './album'
import { copyImage } from './copy-image'
import { useZoom, ZOOM_CLASS } from './use-zoom'

/** 左右滑动超过这个距离才切换 */
const SWIPE_PX = 50
/** 复制成功后按钮上的勾停留多久 */
const COPIED_MS = 2000

/**
 * 全屏查看器：由 usePhotoViewer 挂载即打开、卸载即关闭，关闭请求交给 onClose 播放收回的过渡。
 * 视频打开即有声播放，不循环；切到别的项或关闭时随之卸载、停止
 */
export function PhotoViewer({
  photos,
  index,
  actions,
  saveable,
  onIndexChange,
  onClose,
  photoRef,
}: {
  photos: AlbumPhoto[]
  index: number
  actions: boolean
  saveable: boolean
  onIndexChange: (index: number) => void
  onClose: () => void
  /** 当前大图的外框挂载时回调，打开的过渡要等到它 */
  photoRef: Ref<HTMLDivElement>
}) {
  const [downloading, setDownloading] = useState(false)
  const [saving, setSaving] = useState(false)
  // 复制中显示 Spinner，成功后显示勾并停留一会儿
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied'>('idle')
  useEffect(() => {
    if (copy !== 'copied') return
    const timer = setTimeout(() => setCopy('idle'), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copy])
  // 按下的位置：松手时判断左右滑动，点击时判断是不是轻点。在视频上按下的（拖进度条）不算滑动
  const downX = useRef<number | null>(null)
  const photo = photos[index]
  const kind = photo?.video ? 'video' : 'photo'
  // 秘密聊天的大图（视频）解开之前为 null：只显示预览图，不能复制与下载
  const [sealed] = useSealedUrls([photo && typeof photo.full !== 'string' ? photo.full : null])
  const full = photo && typeof photo.full === 'string' ? photo.full : sealed!
  // 只有图片能缩放；放大或捏合过的这次手势不再当作滑动切换或轻点关闭
  const { view, zoomed, areaRef, wheelRef, pointer, consumed, reset } = useZoom(photo ? photo.w / photo.h : 1, kind === 'photo')
  const go = (delta: number) => {
    const next = index + delta
    if (next < 0 || next >= photos.length) return
    reset()
    onIndexChange(next)
  }

  const download = async () => {
    if (!photo || !full) return
    setDownloading(true)
    try {
      await saveAs(full, photo.name)
    } catch {
      toast.add({ type: 'error', title: `Couldn't download the ${kind}` })
    } finally {
      setDownloading(false)
    }
  }

  const copyPhoto = async () => {
    if (!photo || !full) return
    setCopy('copying')
    try {
      await copyImage(full)
      setCopy('copied')
    } catch {
      setCopy('idle')
      toast.add({ type: 'error', title: "Couldn't copy the photo" })
    }
  }

  const saveSticker = async () => {
    if (!full) return
    setSaving(true)
    await addStickerFromImage(full)
    setSaving(false)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={wheelRef}
        variant="viewer"
        showCloseButton={false}
        onKeyDown={(e) => {
          // 视频控件自己用方向键快进快退
          if ((e.target as Element).closest('video')) return
          if (e.key === 'ArrowLeft') go(-1)
          if (e.key === 'ArrowRight') go(1)
        }}
        onPointerDown={(e) => (downX.current = (e.target as Element).closest('video') ? null : e.clientX)}
        // 轻点图片、视频与按钮以外的地方关闭；滑动切换松手后也会触发 click，不算
        onClick={(e) => {
          const tap = downX.current !== null && Math.abs(e.clientX - downX.current) <= SWIPE_PX
          if (tap && !consumed() && !(e.target as Element).closest('img, video, button')) onClose()
        }}
      >
        <DialogTitle className="sr-only">
          {photo?.video ? 'Video' : 'Photo'} {index + 1} of {photos.length}
        </DialogTitle>
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <span className="flex-1 text-sm tabular-nums">{photos.length > 1 && `${index + 1} / ${photos.length}`}</span>
          {actions && (
            <>
              {/* 剪贴板只收图片 */}
              {!photo?.video && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={copy === 'copied' ? 'Copied' : 'Copy'}
                disabled={copy === 'copying' || !full}
                onClick={() => void copyPhoto()}
              >
                {copy === 'copying' ? <Spinner /> : copy === 'copied' ? <CheckIcon /> : <CopyIcon />}
              </Button>
              )}
              {saveable && !photo?.video && (
                <Button variant="ghost" size="icon" aria-label="Add to stickers" disabled={saving || !full} onClick={() => void saveSticker()}>
                  {saving ? <Spinner /> : <StickerIcon />}
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Download" disabled={downloading || !full} onClick={() => void download()}>
                {downloading ? <Spinner /> : <DownloadIcon />}
              </Button>
            </>
          )}
          <DialogClose render={<Button variant="ghost" size="icon" aria-label="Close" />}>
            <XIcon />
          </DialogClose>
        </div>
        <div
          ref={areaRef}
          className={cn(
            'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden @container-size',
            zoomed && 'cursor-grab active:cursor-grabbing',
          )}
          {...pointer}
          onPointerUp={(e) => {
            pointer.onPointerUp(e)
            if (downX.current === null || consumed()) return
            const dx = e.clientX - downX.current
            if (Math.abs(dx) > SWIPE_PX) go(dx > 0 ? -1 : 1)
          }}
        >
          {/* 预览图（视频为封面）已在气泡里加载过，先垫在下面；大图或视频的第一帧出来后盖住它。
              外框按图片比例放到最大（contain），与图片实际显示的区域一致，过渡的终点才准确。
              视频不用 poster：它不走 CORS 与 no-referrer，封面也就不能和缓存里的图共用 */}
          {photo && (
            <div
              key={index}
              ref={photoRef}
              className={cn(
                'relative aspect-(--ratio) w-[min(100cqw,100cqh*var(--ratio))] [view-transition-name:photo] *:absolute *:inset-0 *:size-full *:object-contain',
                zoomed && ZOOM_CLASS,
              )}
              style={{ '--ratio': photo.w / photo.h, '--zoom': view.scale, '--zoom-x': `${view.x}px`, '--zoom-y': `${view.y}px` } as React.CSSProperties}
            >
              {(!photo.animated || !full) && <img src={photo.preview} alt="" {...mediaImgProps} draggable={false} />}
              {!full ? (
                <div className="flex items-center justify-center">
                  <Spinner className="size-6" />
                </div>
              ) : photo.video ? (
                // 与图片一样以 CORS 方式加载，否则浏览器缓存里不带 CORS 头的响应会让之后的下载失败
                <video src={full} crossOrigin="anonymous" controls autoPlay playsInline onPlay={() => pauseVoice()} />
              ) : (
                <img src={full} alt="" {...mediaImgProps} decoding="async" draggable={false} />
              )}
            </div>
          )}
          {index > 0 && (
            <Button variant="ghost" size="icon" className="absolute left-3" aria-label="Previous" onClick={() => go(-1)}>
              <ChevronLeftIcon />
            </Button>
          )}
          {index < photos.length - 1 && (
            <Button variant="ghost" size="icon" className="absolute right-3" aria-label="Next" onClick={() => go(1)}>
              <ChevronRightIcon />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 媒体在另一个域名上，<a download> 对跨域地址无效：先取回 Blob 再保存 */
async function saveAs(url: string, name: string) {
  const res = await fetch(url, { referrerPolicy: mediaImgProps.referrerPolicy })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}
