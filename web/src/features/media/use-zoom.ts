import { useRef, useState, type PointerEvent } from 'react'

/** 最多放大到铺满时的几倍 */
export const MAX_SCALE = 8
/** 放大后拖动超过这个距离才算平移，松手不再当作轻点 */
const PAN_SLOP = 10
/** ctrl+滚轮：deltaY 每这么多像素缩放 e 倍；鼠标滚轮一格的 delta 很大，先截到 ±WHEEL_STEP_MAX */
const WHEEL_PX_PER_E = 100
const WHEEL_STEP_MAX = 50
/** 按行滚动（Firefox 的鼠标滚轮）时一行折合的像素 */
const LINE_PX = 16

/** 放大时加在图片外框上，按 --zoom、--zoom-x、--zoom-y 缩放与平移 */
export const ZOOM_CLASS = 'translate-x-(--zoom-x) translate-y-(--zoom-y) scale-(--zoom)'

/** 相对铺满（contain）时的缩放与平移；x、y 是图片中心相对区域中心的偏移 */
export type ZoomView = { scale: number; x: number; y: number }
const FIT: ZoomView = { scale: 1, x: 0, y: 0 }

type Point = { x: number; y: number }

/** 以区域内相对中心的点 (qx, qy) 为不动点缩放 factor 倍 */
export function zoomAt(view: ZoomView, factor: number, qx: number, qy: number): ZoomView {
  const scale = Math.min(Math.max(view.scale * factor, 1), MAX_SCALE)
  const k = scale / view.scale
  return { scale, x: qx - k * (qx - view.x), y: qy - k * (qy - view.y) }
}

/** 图片按 ratio 铺满 w×h 的区域：放大后边缘不离开区域，没超出区域的方向居中 */
export function clampView(view: ZoomView, w: number, h: number, ratio: number): ZoomView {
  const scale = Math.min(Math.max(view.scale, 1), MAX_SCALE)
  const fw = Math.min(w, h * ratio)
  const fh = fw / ratio
  const mx = Math.max(0, (fw * scale - w) / 2)
  const my = Math.max(0, (fh * scale - h) / 2)
  return { scale, x: Math.min(Math.max(view.x, -mx), mx), y: Math.min(Math.max(view.y, -my), my) }
}

/**
 * 查看器大图的缩放：ctrl+滚轮（含触控板捏合）与双指捏合以手势中心缩放，放大后拖动或滚轮平移。
 * 图片按 ratio 铺满（contain）居中在 areaRef 的区域里，pointer 是这个区域上的事件处理；
 * view 换成 --zoom、--zoom-x、--zoom-y 加在图片外框上，放大时外框再加上 ZOOM_CLASS（transform-origin 保持中心）；
 * wheelRef 挂在整个查看器上，免得在顶栏上 ctrl+滚轮缩放了整个页面。
 * consumed()：这次按下以来捏合过或平移过，松手时不再当作左右滑动或轻点
 */
export function useZoom(ratio: number, enabled: boolean) {
  const [view, setView] = useState(FIT)
  const areaRef = useRef<HTMLDivElement>(null)
  // 按着的指针及其最近的位置；第一个指针按下时的位置用来判断平移是否越过 PAN_SLOP
  const pointers = useRef(new Map<number, Point>())
  const start = useRef<Point>({ x: 0, y: 0 })
  const consumed = useRef(false)

  /** 把屏幕坐标换成相对区域中心的偏移，再交给 change 算出新视图 */
  const update = (change: (view: ZoomView, center: Point) => ZoomView) => {
    const area = areaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    setView((v) => clampView(change(v, center), area.clientWidth, area.clientHeight, ratio))
  }

  const down = (e: PointerEvent) => {
    if (!enabled) return
    // 新的一次手势：上次没收到抬起（如在窗口外松开鼠标）的指针一并清掉
    if (e.isPrimary) {
      pointers.current.clear()
      consumed.current = false
      start.current = { x: e.clientX, y: e.clientY }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size > 1) consumed.current = true
  }

  const move = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    // 鼠标一下子拖出区域再松开，抬起不经过这里：回来时已没按着
    if (e.pointerType === 'mouse' && e.buttons === 0) return void pointers.current.delete(e.pointerId)
    const others = [...pointers.current].filter(([id]) => id !== e.pointerId).map(([, p]) => p)
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)
    if (others.length > 0) {
      // 双指：按两指间距的变化以中点缩放，中点的移动同时平移
      const other = others[0]!
      const factor = Math.hypot(next.x - other.x, next.y - other.y) / (Math.hypot(prev.x - other.x, prev.y - other.y) || 1)
      const from = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
      const to = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }
      update((v, c) => {
        const zoomed = zoomAt(v, factor, from.x - c.x, from.y - c.y)
        return { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y }
      })
      return
    }
    if (view.scale <= 1) return
    // 越过阈值后捕获指针：拖出区域（如顶栏、窗口外）也继续平移，松开时也一定回到这里
    if (!consumed.current && Math.hypot(next.x - start.current.x, next.y - start.current.y) > PAN_SLOP) {
      consumed.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    update((v) => ({ ...v, x: v.x + next.x - prev.x, y: v.y + next.y - prev.y }))
  }

  const up = (e: PointerEvent) => void pointers.current.delete(e.pointerId)

  const wheel = (e: WheelEvent) => {
    if (!enabled || (!e.ctrlKey && view.scale <= 1)) return
    e.preventDefault()
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    if (e.ctrlKey) {
      const factor = Math.exp(-Math.min(Math.max(dy, -WHEEL_STEP_MAX), WHEEL_STEP_MAX) / WHEEL_PX_PER_E)
      update((v, c) => zoomAt(v, factor, e.clientX - c.x, e.clientY - c.y))
    } else {
      update((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
    }
  }

  // React 的 onWheel 是 passive 的，拦不住浏览器自己的缩放，只能自己挂
  const wheelRef = (el: HTMLElement | null) => {
    if (!el) return
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }

  return {
    view,
    zoomed: view.scale > 1,
    areaRef,
    wheelRef,
    pointer: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
    consumed: () => consumed.current,
    reset: () => setView(FIT),
  }
}
