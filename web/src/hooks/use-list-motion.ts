import { useLayoutEffect, useRef } from 'react'

import { DURATION, EASE_ENTER, EASE_EXIT, prefersReducedMotion } from '@/lib/motion'

/** 一次变化里新增与删除的项超过这么多（重连后补齐的一大批）就不播，直接换好 */
const MAX_CHANGES = 10
const MOVE = 'list-move'

type Layout = { list: HTMLElement; scope: unknown; positions: Map<Element, DOMRect> }

/**
 * 列表的增删与重排（FLIP）：每次渲染后比对子元素的位置，移动过的从原位滑到新位置，新增的淡入，删除的在原位淡出，
 * 其余的项随之平滑让开或补上。挂载时与页面在后台时不播；偏好减少动效时只淡入淡出。
 * 只动视口内的项。列表要有定位（relative），删除的项在里面原位淡出。
 * scope 变化（比如换了筛选词）时整张列表直接换好，不当作增删
 */
export function useListMotion<T extends HTMLElement>(scope?: unknown) {
  const ref = useRef<T>(null)
  const last = useRef<Layout | null>(null)

  useLayoutEffect(() => {
    const list = ref.current
    if (!list) {
      last.current = null
      return
    }
    const prev = last.current?.list === list && last.current.scope === scope ? last.current.positions : null
    last.current = { list, scope, positions: animate(list, prev) }
  })

  return ref
}

/** 量出各项不含动画位移的位置（相对列表），并与上一次比对着播动画 */
function animate(list: HTMLElement, prev: Map<Element, DOMRect> | null) {
  const doc = list.ownerDocument
  const origin = list.getBoundingClientRect()
  const items = [...list.children].filter((el) => !el.hasAttribute('data-list-exit'))
  // 正在移动的项：视觉位置 = 布局位置 + 动画此刻的位移，下面从视觉位置接着动
  const offsets = new Map(items.map((el) => [el, translateOf(el)]))
  const positions = new Map(
    items.map((el) => {
      const r = el.getBoundingClientRect()
      const [x, y] = offsets.get(el)!
      return [el, new DOMRect(r.left - origin.left - x, r.top - origin.top - y, r.width, r.height)]
    }),
  )
  if (!prev || doc.hidden) return positions

  const added = items.filter((el) => !prev.has(el))
  const removed = [...prev].filter(([el]) => !positions.has(el))
  if (added.length + removed.length > MAX_CHANGES) return positions

  const reduce = prefersReducedMotion(doc)
  const visible = visibleBand(list, origin)

  for (const [el, rect] of positions) {
    const before = prev.get(el)
    if (!before) continue
    const [x, y] = offsets.get(el)!
    const dx = before.left + x - rect.left
    const dy = before.top + y - rect.top
    // 上一段移动的终点已经不是现在的布局位置：先停下，再从此刻的位置重新出发
    for (const a of el.getAnimations()) if (a.id === MOVE) a.cancel()
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
    if (reduce || !(overlaps(visible, rect) || overlaps(visible, before))) continue
    const move = el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, { duration: DURATION.emphasized, easing: EASE_ENTER })
    move.id = MOVE
  }

  for (const el of added) {
    if (!overlaps(visible, positions.get(el)!)) continue
    el.animate({ opacity: [0, 1] }, { duration: DURATION.standard, easing: EASE_ENTER })
  }

  // 删除的项：复制一份（不带 React 的事件）放回原位淡出
  for (const [el, rect] of removed) {
    if (!overlaps(visible, rect)) continue
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.setAttribute('data-list-exit', '')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
    })
    list.append(ghost)
    const exit = ghost.animate({ opacity: [1, 0] }, { duration: DURATION.fast, easing: EASE_EXIT, fill: 'forwards' })
    void exit.finished.catch(() => {}).finally(() => ghost.remove())
  }

  return positions
}

/** 元素上 translate 此刻的值（动画进行中时是动画里的值） */
function translateOf(el: Element): [number, number] {
  const t = getComputedStyle(el).translate
  if (!t || t === 'none') return [0, 0]
  const [x = '0', y = '0'] = t.split(' ')
  return [parseFloat(x) || 0, parseFloat(y) || 0]
}

/** 列表在窗口里露出来的纵向范围（相对列表） */
function visibleBand(list: HTMLElement, origin: DOMRect) {
  const height = list.ownerDocument.defaultView?.innerHeight ?? origin.bottom
  return { top: -origin.top, bottom: height - origin.top }
}

function overlaps(band: { top: number; bottom: number }, rect: DOMRect) {
  return rect.bottom > band.top && rect.top < band.bottom
}
