// 通话界面的出现与收起：发起、接听时从底部升上来，结束时降下去；收起、展开时全屏界面与头部的通话条互变
// （View Transition 的共享元素，样式见 index.css）
import { flushSync } from 'react-dom'

import { DURATION, prefersReducedMotion } from '@/lib/motion'
import { fade, presence } from '@/lib/presence'

/** 互变时共享的 view-transition-name：同一时刻只能有一个元素带着它，所以只在过渡期间挂上 */
const NAME = 'call'

/** 正在互变：期间通话界面与通话条各自的出现、消失不播 */
let morphing = false
const armed = () => !morphing

/** 通话界面（一对一与群组）的根元素，要带 data-call-screen */
export const screenMotion = presence({
  enter: (reduce) => (reduce ? { opacity: [0, 1] } : { translate: ['0 100%', '0 0'] }),
  exit: (reduce) => (reduce ? { opacity: [1, 0] } : { translate: ['0 0', '0 100%'] }),
  armed,
  duration: DURATION.emphasized,
  exitDuration: DURATION.standard,
})

/** 头部的播放条、通话条（通话条的按钮要带 data-call-bar） */
export const barMotion = presence({ ...fade, armed })

function screen() {
  return document.querySelector<HTMLElement>('[data-call-screen]')
}

/** 可能有几处通话条（不同布局的头部），取显示着的那个 */
function bar() {
  return [...document.querySelectorAll<HTMLElement>('[data-call-bar]')].find((el) => el.getClientRects().length > 0) ?? null
}

/** 收起或展开通话界面：update 切换状态；有通话界面时是收起（界面缩成通话条），否则是展开 */
export function morphCall(update: () => void) {
  const from = screen() ?? bar()
  if (!from || !('startViewTransition' in document) || prefersReducedMotion()) return update()
  const root = document.documentElement
  const minimizing = from === screen()
  let to: HTMLElement | null = null
  from.style.viewTransitionName = NAME
  root.dataset.callTransition = ''
  const transition = document.startViewTransition(() => {
    from.style.viewTransitionName = ''
    morphing = true
    try {
      flushSync(update)
    } finally {
      morphing = false
    }
    to = minimizing ? bar() : screen()
    if (to) to.style.viewTransitionName = NAME
  })
  void transition.finished.finally(() => {
    delete root.dataset.callTransition
    if (to) to.style.viewTransitionName = ''
  })
}
