import { useLayoutEffect, useRef, useState } from 'react'

import { DURATION, EASE_ENTER, prefersReducedMotion } from '@/lib/motion'

const HEIGHT = 'height-motion'
/** 上一次提交后的高度，写在元素上，换 key 的那次提交用它定住高度 */
const LAST = '--height-motion-last'

/**
 * key 变化时（多了或少了一条横栏）元素的高度从原来的平滑过渡到新的，超出的部分在过渡期间裁掉；
 * 其余原因的高度变化（打字换行）照常立即生效。挂载时不播；偏好减少动效时不播。
 * 换 key 的那次提交先把高度定在原来的值（返回的 locked，元素上用 h-(--height-motion-last)），新高度按子元素量出：
 * 变矮时旁边的滚动区不会先变高一下、把滚动位置夹住（消息列表就离开了底部）。子元素要在元素里纵向排开
 */
export function useHeightMotion<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null)
  const [settled, setSettled] = useState(key)
  const locked = key !== settled

  // 每次提交后记下高度，供换 key 时定住；过渡进行中时记的是过渡的终点，此刻的高度不算
  useLayoutEffect(() => {
    const el = ref.current
    if (locked || !el || el.getAnimations().some((a) => a.id === HEIGHT)) return
    el.style.setProperty(LAST, `${el.getBoundingClientRect().height}px`)
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!locked || !el) return
    // 定住的原来的高度；过渡进行中时是过渡此刻的高度
    const from = el.getBoundingClientRect().height
    const to = contentHeight(el)
    for (const a of el.getAnimations()) if (a.id === HEIGHT) a.cancel()
    el.style.setProperty(LAST, `${to}px`)
    // 只定住这一次提交：量完就放开，接下来由过渡接管
    // oxlint-disable-next-line react/set-state-in-effect
    setSettled(key)
    const doc = el.ownerDocument
    if (Math.abs(from - to) < 1 || doc.hidden || prefersReducedMotion(doc)) return
    const grow = el.animate(
      { height: [`${from}px`, `${to}px`], overflow: ['clip', 'clip'] },
      { duration: DURATION.standard, easing: EASE_ENTER },
    )
    grow.id = HEIGHT
  }, [locked, key])

  return [ref, locked] as const
}

/** 元素不受高度限制时的高度：最后一个在文档流里的子元素的下沿，加上内边距与边框 */
function contentHeight(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  let bottom = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
  for (const child of el.children) {
    const s = getComputedStyle(child)
    if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom + parseFloat(s.marginBottom))
  }
  return bottom - box.top + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)
}
