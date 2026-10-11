import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import type { AlbumPhoto } from './album'
import { PhotoViewer } from './photo-viewer'

/** 缩略图与查看器里的大图共用的 view-transition-name（样式见 index.css）；缩略图只在过渡期间挂上 */
const PHOTO_TRANSITION = 'photo'
/** 过渡开始后等查看器挂载的上限，超时就按当时的画面继续 */
const MOUNT_TIMEOUT_MS = 200

/**
 * 点开第 i 张缩略图全屏查看，在这组图片内切换；viewer 要渲染出来。
 * 打开与关闭用 View Transition 让图片在缩略图与全屏之间移动（浏览器负责 FLIP）；
 * 不支持或偏好减少动效时直接切换。缩略图的圆角取自最近的 [data-photo-frame] 外框。
 * actions：查看器顶部显示复制与下载按钮；saveable：再显示添加到我的贴纸的按钮
 */
export function usePhotoViewer(photos: AlbumPhoto[], { actions = true, saveable = false } = {}) {
  const [open, setOpen] = useState<number | null>(null)
  const thumbs = useRef<(HTMLImageElement | null)[]>([])
  const viewerMounted = useRef<(() => void) | null>(null)

  const openAt = (i: number) => {
    const thumb = thumbs.current[i]
    if (!thumb || !canAnimate()) return setOpen(i)
    // 旧画面里是缩略图带名字，新画面里换成查看器的大图
    thumb.style.viewTransitionName = PHOTO_TRANSITION
    void photoTransition('open', thumb, async () => {
      thumb.style.viewTransitionName = ''
      const mounted = new Promise<void>((resolve) => (viewerMounted.current = resolve))
      flushSync(() => setOpen(i))
      await Promise.race([mounted, new Promise((resolve) => setTimeout(resolve, MOUNT_TIMEOUT_MS))])
    })
  }

  // 收回到当前正在看的那张（可能已在查看器里切换过）
  const close = () => {
    const thumb = open !== null ? thumbs.current[open] : null
    if (!thumb || !canAnimate()) return setOpen(null)
    void photoTransition('close', thumb, () => {
      // 查看器直接卸载，不等 Dialog 的退出流程，新画面里只剩缩略图带名字
      flushSync(() => setOpen(null))
      thumb.style.viewTransitionName = PHOTO_TRANSITION
    })
  }

  const viewer = open !== null && (
    <PhotoViewer
      photos={photos}
      index={open}
      actions={actions}
      saveable={actions && saveable}
      onIndexChange={setOpen}
      onClose={close}
      photoRef={(el) => {
        if (!el) return
        viewerMounted.current?.()
        viewerMounted.current = null
      }}
    />
  )

  return { thumbRef: (i: number) => (el: HTMLImageElement | null) => void (thumbs.current[i] = el), openAt, viewer }
}

function canAnimate() {
  return 'startViewTransition' in document && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 正在进行的图片过渡；被新的过渡跳过的那个结束时不做清理，免得抹掉新过渡的标记 */
let activeTransition: ViewTransition | null = null

/**
 * 在根元素上标出方向与缩略图各角的圆角，供 index.css 里的圆角动画使用；
 * 过渡结束（或被跳过）后清除这些标记和缩略图上的名字
 */
function photoTransition(direction: 'open' | 'close', thumb: HTMLElement, update: () => void | Promise<void>) {
  const root = document.documentElement
  root.dataset.photoTransition = direction
  root.style.setProperty('--photo-radius', cornerRadius(thumb))
  const transition = document.startViewTransition(update)
  activeTransition = transition
  return transition.finished.finally(() => {
    if (activeTransition !== transition) return
    activeTransition = null
    delete root.dataset.photoTransition
    root.style.removeProperty('--photo-radius')
    thumb.style.viewTransitionName = ''
  })
}

/** 缩略图的圆角来自外框的裁切：只有贴着外框某个角的那张图，那个角才是圆的 */
function cornerRadius(thumb: HTMLElement) {
  const frame = thumb.closest<HTMLElement>('[data-photo-frame]')
  if (!frame) return '0px'
  const f = frame.getBoundingClientRect()
  const t = thumb.getBoundingClientRect()
  const style = getComputedStyle(frame)
  const near = (a: number, b: number) => Math.abs(a - b) < 1
  const top = near(t.top, f.top)
  const bottom = near(t.bottom, f.bottom)
  const left = near(t.left, f.left)
  const right = near(t.right, f.right)
  return [
    top && left ? style.borderTopLeftRadius : '0px',
    top && right ? style.borderTopRightRadius : '0px',
    bottom && right ? style.borderBottomRightRadius : '0px',
    bottom && left ? style.borderBottomLeftRadius : '0px',
  ].join(' ')
}
