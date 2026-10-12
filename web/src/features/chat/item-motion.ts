// 消息里的元素出现与消失（回应、状态、撤回占位、编辑后的正文、上传进度）：在已经显示的消息里出现时淡入，
// 消失时在原位淡出；随消息一起挂载或卸载的不播（消息自己有入场动画，加载历史、换会话时也不该闪）。
// 用 Web Animations API 而不是 CSS 动画：元素出现时才决定播不播
import { fade, pop, presence } from '@/lib/presence'

const ITEM = '[data-slot="message-scroller-item"]'

/**
 * 挂载着的消息项，由 MessageScrollerItem 的 layout effect 登记。挂载时子元素的 ref 先于它执行，
 * 所以随消息一起挂载的元素查不到它；卸载时它先于子元素注销，所以随消息一起卸载的元素查不到它
 */
const mountedItems = new WeakSet<Element>()

export function trackItem(item: Element) {
  mountedItems.add(item)
  return () => void mountedItems.delete(item)
}

function armed(el: HTMLElement) {
  const item = el.closest(ITEM)
  return item !== null && mountedItems.has(item)
}

/** 复制放进消息项：消失的元素所在的那一块常常整个换掉（上传完成后进度条连同发送中的内容一起换成发出的内容） */
const container = (el: HTMLElement) => el.closest(ITEM)

/** 淡入淡出：状态文字、撤回占位、编辑后的正文。配合 key 换掉元素时就是交叉淡入淡出 */
export const fadeMotion = presence({ ...fade, armed, container })
/** 淡入淡出并带一点缩放：回应 */
export const popMotion = presence({ ...pop, armed, container })
/** 只在消失时淡出：上传进度，完成后换上的内容与它原本一样，不用再淡入 */
export const fadeOutMotion = presence({ exit: fade.exit, armed, container })
