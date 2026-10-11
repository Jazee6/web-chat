// 元素出现与消失的动画（Web Animations API），以 ref 回调挂到元素上：挂载时播入场；卸载时在原处留一份复制播出场，
// 播完移除（React 不用为它保留旧的状态）。同一次提交里一起出现或消失的嵌套元素只动最外层的那个，免得叠着播
import { DURATION, EASE_ENTER, EASE_EXIT, prefersReducedMotion } from './motion'

type Frames = (reduce: boolean) => PropertyIndexedKeyframes

export type Presence = {
  /** 入场的关键帧，省略则不播；reduce：偏好减少动效 */
  enter?: Frames
  exit?: Frames
  /** 这次挂载或卸载要不要播，默认都播（例如随消息一起挂载的不播） */
  armed?: (el: HTMLElement) => boolean
  duration?: number
  /** 退出比进入短一档，默认与进入相同 */
  exitDuration?: number
  /** 复制放到哪里，默认父元素；父元素会随它一起卸载时（整块换掉）要指定更外层、留得下来的元素 */
  container?: (el: HTMLElement) => Element | null
}

const entering = new Map<HTMLElement, () => void>()
const leaving = new Set<HTMLElement>()
const ghosts: { parent: Element; ghost: HTMLElement; rect: DOMRect; play: (ghost: HTMLElement) => void }[] = []
let scheduled = false

function schedule() {
  if (scheduled) return
  scheduled = true
  // 这次提交结束后、绘制之前
  queueMicrotask(flush)
}

function flush() {
  scheduled = false
  for (const [el, play] of entering) if (!insideAny(el, entering)) play()
  entering.clear()
  leaving.clear()
  for (const { parent, ghost, rect, play } of ghosts.splice(0)) {
    // 放复制的元素也随这次提交卸载了（换页、换会话）：不用播
    if (!parent.isConnected) continue
    parent.append(ghost)
    // 先放在定位原点量出偏差，再挪到原来的位置：不用关心父元素怎么定位
    const origin = ghost.getBoundingClientRect()
    ghost.style.left = `${rect.left - origin.left}px`
    ghost.style.top = `${rect.top - origin.top}px`
    play(ghost)
  }
}

/** el 的祖先是否也在其中 */
function insideAny(el: HTMLElement, set: { has(el: HTMLElement): boolean }) {
  for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return true
  return false
}

/** 复制一份（不带 React 的事件），绝对定位、尺寸固定；原来的定位与变换都去掉，位置在放上时再算 */
function ghostOf(el: HTMLElement, rect: DOMRect) {
  const ghost = el.cloneNode(true) as HTMLElement
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  Object.assign(ghost.style, {
    position: 'absolute',
    inset: 'auto',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    translate: 'none',
    transform: 'none',
    scale: 'none',
    pointerEvents: 'none',
  })
  return ghost
}

/** 生成挂到元素上的 ref 回调；要保持同一个引用（放在模块顶层），否则每次渲染都算一次卸载与挂载 */
export function presence({
  enter,
  exit,
  armed = () => true,
  duration = DURATION.fast,
  exitDuration = duration,
  container = (el) => el.parentElement,
}: Presence) {
  return (el: HTMLElement | null) => {
    if (!el) return
    const doc = el.ownerDocument
    // 挂载时子元素先于父元素：等这次提交里的都到齐了再挑最外层的播
    if (enter && !doc.hidden && armed(el)) {
      entering.set(el, () => void el.animate(enter(prefersReducedMotion(doc)), { duration, easing: EASE_ENTER }))
      schedule()
    }
    if (!exit) return
    // 卸载时父元素先于子元素，元素也还在页面上：先量好位置，这次提交结束后再放上复制
    return () => {
      const parent = container(el)
      if (!parent || doc.hidden || !armed(el) || insideAny(el, leaving)) return
      leaving.add(el)
      const rect = el.getBoundingClientRect()
      ghosts.push({
        parent,
        ghost: ghostOf(el, rect),
        rect,
        play: (ghost) => {
          const out = ghost.animate(exit(prefersReducedMotion(doc)), {
            duration: exitDuration,
            easing: EASE_EXIT,
            fill: 'forwards',
          })
          void out.finished.catch(() => {}).finally(() => ghost.remove())
        },
      })
      schedule()
    }
  }
}

/** 淡入淡出 */
export const fade = {
  enter: () => ({ opacity: [0, 1] }),
  exit: () => ({ opacity: [1, 0] }),
} satisfies Presence

/** 淡入淡出并带一点缩放；偏好减少动效时只淡入淡出 */
export const pop = {
  enter: (reduce: boolean) => ({ opacity: [0, 1], ...(!reduce && { scale: [0.8, 1] }) }),
  exit: (reduce: boolean) => ({ opacity: [1, 0], ...(!reduce && { scale: [1, 0.8] }) }),
} satisfies Presence

/** 从上往下展开（浮在内容上的横条，不占位置）；偏好减少动效时只淡入淡出 */
export const reveal = {
  enter: (reduce: boolean) => ({ opacity: [0, 1], ...(!reduce && { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] }) }),
  exit: (reduce: boolean) => ({ opacity: [1, 0], ...(!reduce && { clipPath: ['inset(0)', 'inset(0 0 100% 0)'] }) }),
  duration: DURATION.standard,
  exitDuration: DURATION.fast,
} satisfies Presence

/** 新的从下面升上来，旧的往上离开（轮换的内容）；偏好减少动效时只交叉淡入淡出 */
export const rise = {
  enter: (reduce: boolean) => ({ opacity: [0, 1], ...(!reduce && { translate: ['0 50%', '0 0'] }) }),
  exit: (reduce: boolean) => ({ opacity: [1, 0], ...(!reduce && { translate: ['0 0', '0 -50%'] }) }),
  duration: DURATION.standard,
  exitDuration: DURATION.fast,
} satisfies Presence

/** 浮在内容上的横条：从上往下展开 */
export const revealMotion = presence(reveal)
/** 轮换的内容：配合 key 换掉元素 */
export const riseMotion = presence(rise)
/** 占位置的横条：淡入淡出 */
export const fadeInOutMotion = presence(fade)
