// 消息区滚动容器的状态与控制（组件见 message-scroller.tsx）
import { createContext, use, useSyncExternalStore } from 'react'

/** 离底部不超过这个距离就算贴底 */
const EDGE = 8
/** 滑到底部用的临界阻尼弹簧的角频率（1/s）：越大越快，短距离约 0.4s 停稳 */
const SPRING = 18
/** 单帧时间步长上限（s）：后台标签页、画中画里帧会被节流，步长过大弹簧会发散 */
const MAX_DT = 1 / 30
/** 手指离开后这么久（ms）没有滚动事件就算惯性滚动停了 */
const TOUCH_QUIET = 150
/** 补偿写进 scrollTop 后这么久（ms）内被顶回去就重写，见 pin */
const PIN = 500

type Store<T> = { get: () => T; set: (value: T) => void; subscribe: (listener: () => void) => () => void }

function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 滚动状态放在 React 之外：滚动、尺寸变化都直接读写 DOM，只把按钮状态和可见消息通过 store 交给组件。
 * 内容的直接子元素只能是消息项：保持视口、判断追加都按子元素算
 */
export class ScrollController {
  private follow: boolean
  /** 挂载时定位到的消息；之后不再使用，重新定位靠重建滚动容器 */
  private readonly anchor: string | null
  /** 顶部被浮层遮住的高度，见 PEEK */
  private readonly peek: number
  private viewport: HTMLElement | null = null
  private content: HTMLElement | null = null
  private positioned = false
  /** 停在底部：内容变化时跟到底 */
  private stick = false
  /** 上次滚动事件时的位置：往上滚了才可能离开底部 */
  private lastTop = 0
  /**
   * 正在滑到底部的动画帧，0 为没有。期间的滚动事件不改变 stick。
   * 不用浏览器的平滑滚动：滑动途中内容还会变化（发出的消息替换估算尺寸、输入框变矮、发送状态更新），
   * 每次变化都重发 scrollTo 会让动画从零速重新开始，看起来一顿一顿的；这里每帧重新读取底部位置，速度连续
   */
  private glide = 0
  private glidePos = 0
  private glideVel = 0
  private glideTime = 0
  /**
   * 视口里的第一条及其在内容里的位置：内容变化后按它挪动的距离调整视口。
   * 不记相对视口的位置：iOS Safari 的滚动是异步的，上次滚动事件之后视口可能又滚了一段，
   * 按相对视口的位置补偿会把这段滚动也退回去，向上滚时一顿一顿地往回跳
   */
  private snapshot: { el: Element; offset: number } | null = null
  /** 触摸滚动中：从按下手指到抬起后惯性停下 */
  private touchScroll = false
  private touching = false
  private quiet = 0
  /**
   * 触摸滚动中攒下、还没写进 scrollTop 的补偿，暂时用内容的 translate 抵消。
   * iOS Safari 在手指按着或惯性滚动时写 scrollTop，随后又从自己原来的位置接着滚，视口往回跳；等停下再写
   */
  private shift = 0
  /**
   * 刚写进 scrollTop 的补偿：iOS Safari 在顶部回弹等自己的滚动动画结束前会把它顶回去，视口回到顶部，
   * 新插入的历史露出来又触发加载，一路加载到头。此后一段时间里被顶回去就重写；用户接管时放弃
   */
  private pinTop = 0
  private pinTimer = 0
  /** 最近一次用户输入是触摸：只有这时补偿会被顶回去；拖动滚动条时不能把位置拉回来 */
  private touchInput = false
  /** 上次处理时的最后一条：之后的都是追加的 */
  private tail: Element | null = null
  private resize: ResizeObserver | null = null
  private intersect: IntersectionObserver | null = null
  private readonly visible = new Set<string>()
  /** 不在底部：显示回到底部的按钮 */
  readonly away = createStore(false)
  readonly visibleIds = createStore<string[]>([])
  /** 补偿已经落地，视口位置可信：没落地时首条看起来进入视口不作数，不能据此加载更早的消息 */
  readonly settled = createStore(true)

  constructor(follow: boolean, anchor: string | null, peek: number) {
    this.follow = follow
    this.anchor = anchor
    this.peek = peek
  }

  // 通常子元素的 ref 先挂上；StrictMode 重挂时顺序不定，两边都补上观察
  attachContent(el: HTMLElement) {
    this.content = el
    this.resize?.observe(el)
    for (const item of el.children) this.intersect?.observe(item)
    return () => {
      this.resize?.unobserve(el)
      if (this.content === el) this.content = null
    }
  }

  attachViewport(el: HTMLElement) {
    this.viewport = el
    const resize = new ResizeObserver(() => this.settle())
    resize.observe(el)
    if (this.content) resize.observe(this.content)
    const intersect = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: el,
      rootMargin: `-${this.peek}px 0px 0px 0px`,
    })
    for (const item of this.content?.children ?? []) intersect.observe(item)
    this.resize = resize
    this.intersect = intersect
    return () => {
      resize.disconnect()
      intersect.disconnect()
      this.stopGlide()
      clearTimeout(this.quiet)
      this.unpin()
      this.touching = this.touchScroll = false
      this.shift = 0
      this.settled.set(true)
      if (this.content) this.content.style.translate = ''
      this.resize = this.intersect = this.viewport = null
      this.visible.clear()
      this.visibleIds.set([])
    }
  }

  /** id 变了要重新观察：可见集合按 id 记，旧的 id 要移除 */
  observeItem(el: HTMLElement, id: string) {
    this.intersect?.observe(el)
    return () => {
      this.intersect?.unobserve(el)
      if (this.visible.delete(id)) this.visibleIds.set([...this.visible])
    }
  }

  /** 每次渲染提交后：第一次定位，之后处理追加的消息 */
  commit(follow: boolean) {
    this.follow = follow
    const content = this.content
    if (!this.viewport || !content?.firstElementChild) return
    if (!this.positioned) {
      this.position()
      return
    }
    const tail = this.tail
    const appended: Element[] = []
    if (tail?.parentElement === content) {
      for (let el = tail.nextElementSibling; el; el = el.nextElementSibling) appended.push(el)
    }
    this.tail = content.lastElementChild
    // 只有停在底部时看得到新消息；发件箱换成已发送的消息时旧的末条已经移除，不算追加
    const animate = this.follow && this.stick && appended.length > 0
    if (animate) for (const el of appended) el.setAttribute('data-entering', '')
    this.settle(animate ? 'smooth' : undefined)
  }

  scrollToEnd(behavior: 'smooth' | 'instant' = 'smooth') {
    const vp = this.viewport
    if (!vp) return
    this.flushShift()
    this.unpin()
    this.stick = true
    this.away.set(false)
    if (behavior === 'smooth' && !reducedMotion()) {
      this.startGlide()
      return
    }
    this.stopGlide()
    vp.scrollTop = vp.scrollHeight - vp.clientHeight
  }

  onScroll() {
    if (!this.positioned) return
    const vp = this.viewport!
    if (this.pinTimer && !this.touchScroll && Math.abs(vp.scrollTop - this.pinTop) > 1) {
      vp.scrollTop = this.pinTop
      this.pin()
      return
    }
    // 离开底部只能是往上滚了。视口在逐帧变矮（输入框上方的横栏展开）时，自己滚到底的滚动事件晚一帧才到，
    // 那时离底部又远了几像素，不能当成用户离开
    if (this.touchScroll) this.waitQuiet()
    const top = vp.scrollTop
    const up = top < this.lastTop - 0.5
    this.lastTop = top
    if (!this.glide) this.stick = this.distance() <= EDGE || (this.stick && !up)
    this.takeSnapshot()
    this.away.set(!this.stick)
  }

  /** 滚轮、触摸、按键：用户接管滚动，打断自己发起的滑动 */
  onUserScroll(touch = false) {
    this.touchInput = touch
    this.stopGlide()
    this.unpin()
  }

  onTouchStart() {
    clearTimeout(this.quiet)
    this.touchInput = this.touching = this.touchScroll = true
    this.unpin()
  }

  onTouchEnd() {
    this.touching = false
    this.waitQuiet()
  }

  /** 手指已经抬起时，滚动事件停下一段时间后结束触摸滚动 */
  private waitQuiet() {
    clearTimeout(this.quiet)
    if (this.touching) return
    this.quiet = window.setTimeout(() => {
      this.touchScroll = false
      this.flushShift()
    }, TOUCH_QUIET)
  }

  /** 把暂存的补偿写进 scrollTop，同时去掉 translate：两步在同一帧里，看起来不动 */
  private flushShift() {
    const vp = this.viewport
    if (!this.shift || !vp) return
    if (this.content) this.content.style.translate = ''
    vp.scrollTop += this.shift
    this.shift = 0
    this.lastTop = vp.scrollTop
    this.pin()
  }

  /** 记下刚写进的位置，见 pinTop；不是触摸时只更新是否落地 */
  private pin() {
    clearTimeout(this.pinTimer)
    this.pinTimer = 0
    if (this.touchInput && this.viewport) {
      this.pinTop = this.viewport.scrollTop
      this.pinTimer = window.setTimeout(() => this.unpin(), PIN)
    }
    this.updateSettled()
  }

  private unpin() {
    clearTimeout(this.pinTimer)
    this.pinTimer = 0
    this.updateSettled()
  }

  private updateSettled() {
    this.settled.set(!this.shift && !this.pinTimer)
  }

  /** 已经在滑时什么都不做：目标每帧重新读取，重置速度反而会顿一下 */
  private startGlide() {
    this.flushShift()
    if (this.glide || this.distance() <= 0.5) return
    this.glidePos = this.viewport!.scrollTop
    this.glideVel = 0
    this.glideTime = 0
    this.glide = requestAnimationFrame(this.step)
  }

  private stopGlide() {
    cancelAnimationFrame(this.glide)
    this.glide = 0
  }

  private readonly step = (now: number) => {
    const vp = this.viewport
    if (!vp) return
    // 第一帧的时间戳可能早于发起时刻，按一帧算
    const dt = this.glideTime ? Math.min(Math.max(now - this.glideTime, 0) / 1000, MAX_DT) : 1 / 60
    this.glideTime = now
    // 内容变短时浏览器会把位置夹住：从实际位置接着滑，这不是用户接管
    if (Math.abs(vp.scrollTop - this.glidePos) > 1) this.glidePos = vp.scrollTop
    const offset = vp.scrollHeight - vp.clientHeight - this.glidePos
    if (Math.abs(offset) < 0.5 && Math.abs(this.glideVel) < 20) {
      this.glide = 0
      vp.scrollTop = vp.scrollHeight - vp.clientHeight
      this.onScroll()
      return
    }
    this.glideVel += (SPRING * SPRING * offset - 2 * SPRING * this.glideVel) * dt
    this.glidePos += this.glideVel * dt
    vp.scrollTop = this.glidePos
    this.glide = requestAnimationFrame(this.step)
  }

  /** 有锚点时让锚点靠近顶部（下面的内容不满一屏时浏览器会限制在底部），否则到底 */
  private position() {
    const vp = this.viewport!
    const content = this.content!
    const el = this.anchor ? content.querySelector(`:scope > [data-message-id="${CSS.escape(this.anchor)}"]`) : null
    vp.scrollTop = el ? el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop - this.peek : vp.scrollHeight
    this.positioned = true
    this.lastTop = vp.scrollTop
    this.stick = this.distance() <= EDGE
    this.tail = content.lastElementChild
    if (el) this.snapshot = { el, offset: this.offsetOf(el) }
    else this.takeSnapshot()
    this.away.set(!this.stick)
  }

  /** 内容或尺寸变化后：跟随时回到底部，否则把视口里的第一条放回原处（向上插入历史、上方图片加载完） */
  private settle(behavior?: 'smooth' | 'instant') {
    // 正在滑到底部：底部位置每帧重新读取，不用处理
    if (!this.positioned || !this.viewport || this.glide) return
    if (this.follow && this.stick) {
      this.scrollToEnd(behavior ?? 'instant')
      return
    }
    this.restoreSnapshot()
    this.stick = this.distance() <= EDGE
    this.away.set(!this.stick)
  }

  private restoreSnapshot() {
    const snapshot = this.snapshot
    if (!this.content) return
    if (!snapshot?.el.isConnected) {
      this.takeSnapshot()
      return
    }
    const offset = this.offsetOf(snapshot.el)
    const delta = offset - snapshot.offset
    snapshot.offset = offset
    if (Math.abs(delta) <= 0.5) return
    if (this.touchScroll) {
      this.shift += delta
      this.content.style.translate = `0 ${-this.shift}px`
      this.updateSettled()
    } else {
      this.viewport!.scrollTop += delta
      this.pin()
    }
  }

  /**
   * 以顶边在视口里的第一条为准：只露出下半截的那条自己还可能变高（替换估算尺寸），以它为准会把下面的内容推走。
   * 没有这样的一条（一条消息比视口还高）时退回它上面那条
   */
  private takeSnapshot() {
    const items = this.content?.children
    const vp = this.viewport
    if (!items?.length || !vp) return
    const rect = vp.getBoundingClientRect()
    let lo = 0
    let hi = items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (items[mid]!.getBoundingClientRect().top >= rect.top) hi = mid
      else lo = mid + 1
    }
    const below = lo < items.length && items[lo]!.getBoundingClientRect().top < rect.bottom
    const found = items[below ? lo : Math.max(0, lo - 1)]!
    this.snapshot = { el: found, offset: this.offsetOf(found) }
  }

  /** 相对内容顶边的位置：只随布局变化，不随滚动变化 */
  private offsetOf(el: Element) {
    return el.getBoundingClientRect().top - this.content!.getBoundingClientRect().top
  }

  /** 暂存的补偿也算上：内容往下 translate 时 scrollHeight 跟着变大 */
  private distance() {
    const vp = this.viewport!
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight - Math.max(-this.shift, 0)
  }

  private onIntersect(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.messageId
      if (!id) continue
      if (entry.isIntersecting) this.visible.add(id)
      else this.visible.delete(id)
    }
    this.visibleIds.set([...this.visible])
  }
}

export const ScrollerContext = createContext<ScrollController | null>(null)

export function useController() {
  const controller = use(ScrollerContext)
  if (!controller) throw new Error('Must be used within a MessageScroller.')
  return controller
}

export function useMessageScroller() {
  const controller = useController()
  return { scrollToEnd: (behavior?: 'smooth' | 'instant') => controller.scrollToEnd(behavior) }
}

export function useMessageScrollerVisibility() {
  const controller = useController()
  const visibleMessageIds = useSyncExternalStore(controller.visibleIds.subscribe, controller.visibleIds.get)
  return { visibleMessageIds }
}
