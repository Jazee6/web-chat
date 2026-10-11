// 动效节奏，供 Web Animations API 使用；与 index.css 里的 --transition-duration-* / --ease-* 保持同一组数值

/** 快：状态切换、小元素；标准：进出场；强调：空间上的移动（导航、重排、相册放大） */
export const DURATION = { fast: 150, standard: 200, emphasized: 300 } as const

/** 进入与移动 */
export const EASE_ENTER = 'cubic-bezier(0.2, 0, 0, 1)'
/** 退出：比进入短一档 */
export const EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)'

/** 偏好减少动效：去掉位移、缩放与 FLIP，只保留淡入淡出。按元素所在的窗口判断（画中画是另一个窗口） */
export function prefersReducedMotion(doc: Document = document) {
  return doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false
}
