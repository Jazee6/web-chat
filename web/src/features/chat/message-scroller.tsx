// 消息区的滚动容器：虚拟列表、贴底跟随、挂载时定位到锚点、内容变化时保持视口、新消息入场动画。见 docs/architecture/07-client.md § 消息列表
import {
  createContext,
  use,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import { observeElementOffset, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { trackItem } from './item-motion'
import { ScrollController, ScrollerContext, useController } from './message-scroller-controller'

/** 定位到锚点时锚点上方留出的距离；也是可见性判定时顶部让出的高度（浮在上方的标题栏）。默认值，见 MessageScroller 的 peek */
const PEEK = 64
/** 还没渲染过的消息项按这个高度（px）占位 */
const ESTIMATE = 64
/** 视口上下各多渲染几项：键盘逐条移动、快速滚动时下一条已经在页面上 */
const OVERSCAN = 10
/** 这些按键会滚动视口：视为用户接管滚动 */
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])

/** 元素由自己的回调挂到控制器上；外部传入的 ref 通过 useImperativeHandle 拿到同一个元素 */
function useAttachRef<T extends HTMLElement>(attach: (el: T) => () => void, ref: Ref<T> | undefined) {
  const local = useRef<T>(null)
  useImperativeHandle(ref, () => local.current!, [])
  // 回调要保持同一个引用，否则每次渲染都会重新挂载
  return useCallback(
    (el: T) => {
      local.current = el
      const detach = attach(el)
      return () => {
        detach()
        local.current = null
      }
    },
    [attach],
  )
}

/**
 * follow：贴底时跟随新消息，追加的消息带入场动画。
 * anchor：挂载时定位到的消息；要重新定位就换 key 重建。
 * peek：顶部被浮层遮住的高度（标题栏，还有置顶条），定位与可见性判定都让出它；同样只在挂载时读取
 */
function MessageScroller({
  follow = false,
  anchor = null,
  peek = PEEK,
  className,
  ...props
}: ComponentProps<'div'> & { follow?: boolean; anchor?: string | null; peek?: number }) {
  const [controller] = useState(() => new ScrollController(follow, anchor, peek))
  // 列表自己的提交在 MessageScrollerContent 里；这里只在视口挂上后第一次定位，以及 follow 变化时
  useLayoutEffect(() => controller.setFollow(follow))
  return (
    <ScrollerContext value={controller}>
      <div
        data-slot="message-scroller"
        className={cn('relative flex size-full min-h-0 flex-col overflow-hidden', className)}
        {...props}
      />
    </ScrollerContext>
  )
}

function MessageScrollerViewport({ className, ref, ...props }: ComponentProps<'div'>) {
  const controller = useController()
  const attach = useCallback((el: HTMLDivElement) => controller.attachViewport(el), [controller])
  const attachRef = useAttachRef(attach, ref)
  return (
    <div
      ref={attachRef}
      data-slot="message-scroller-viewport"
      role="region"
      aria-label="Messages"
      tabIndex={0}
      onScroll={() => controller.onScroll()}
      onWheel={() => controller.onUserScroll()}
      onTouchMove={() => controller.onUserScroll()}
      onTouchStart={() => controller.onTouchStart()}
      onTouchEnd={() => controller.onTouchEnd()}
      onTouchCancel={() => controller.onTouchEnd()}
      onKeyDown={(e) => SCROLL_KEYS.has(e.key) && controller.onUserScroll()}
      // 按在视口自身上的只可能是滚动条：拖动滚动条也是用户接管
      onPointerDown={(e) => e.target === e.currentTarget && controller.onUserScroll()}
      // 视口由自己保持，关掉浏览器的滚动锚定，免得两套机制叠加
      className={cn(
        'size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-both overflow-y-auto overscroll-contain contain-content [overflow-anchor:none]',
        className,
      )}
      {...props}
    />
  )
}

const ListContext = createContext<Virtualizer<HTMLElement, HTMLElement> | null>(null)

/**
 * 虚拟列表：只渲染视口附近的项，上下没渲染的部分用内边距撑开（项在正常的文档流里：入场动画、项内元素的显隐动画都要改变高度或 transform）。
 * 虚拟列表只决定渲染哪些项，不让它调整滚动位置：它在 iOS 触摸滚动中只能推迟补偿，内容会在手指下面跳；视口的保持交给 ScrollController。
 * count 与 getItemKey 描述整个窗口，key 用消息 id；children 按下标渲染一个 MessageScrollerItem
 */
function MessageScrollerContent({
  count,
  getItemKey,
  children,
  className,
  style,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  count: number
  getItemKey: (index: number) => string
  children: (index: number) => ReactNode
}) {
  const controller = useController()
  const list = useRef<HTMLDivElement>(null)
  // 列表顶边在滚动内容里的位置与项间距，挂载后量出来
  const [metrics, setMetrics] = useState({ margin: 0, gap: 4 })
  // 实例跨渲染不变、状态在内部变化，编译器不缓存这个组件
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count,
    getItemKey,
    estimateSize: () => ESTIMATE,
    overscan: OVERSCAN,
    gap: metrics.gap,
    scrollMargin: metrics.margin,
    // 视口的 ref 在列表的布局副作用之后才挂上，直接取父元素
    getScrollElement: () => list.current?.parentElement ?? null,
    // 第一次渲染就按估算取到定位的目标（没有时是末条）附近的项，ScrollController 定位时它已经在页面上
    initialRect: { width: 0, height: window.innerHeight },
    initialOffset: () => {
      const anchor = controller.anchor === null ? -1 : findIndex(count, getItemKey, controller.anchor)
      return anchor === -1
        ? Math.max(0, count * (ESTIMATE + 4) - window.innerHeight)
        : anchor * (ESTIMATE + 4)
    },
    rangeExtractor: (range) => controller.extendRange(range),
    // 滚动位置只由 ScrollController 写：虚拟列表初始化（StrictMode、Activity 下还会重新初始化）时会把估算的初始位置写回去，盖掉已经定好的位置
    scrollToFn: () => {},
    observeElementOffset: (instance, cb) =>
      observeElementOffset(instance, (offset, scrolling) => cb(offset + controller.pendingShift, scrolling)),
  })
  // 补偿交给 ScrollController
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false

  const items = virtualizer.getVirtualItems()
  const first = items[0]
  const last = items.at(-1)
  const margin = virtualizer.options.scrollMargin
  const above = first ? first.start - margin : 0
  const below = last ? virtualizer.getTotalSize() - (last.end - margin) : 0

  const lastKey = count > 0 ? getItemKey(count - 1) : null
  const seenLast = useRef(lastKey)
  // 每次提交都要处理（滚动只让这个组件重新渲染）；setMetrics 只在量出来的值变了时调用
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = list.current!
    const vp = el.parentElement!
    controller.attachList(virtualizer)
    const css = getComputedStyle(el)
    const next = {
      // translate 会挪动量到的位置，加回来
      margin:
        el.getBoundingClientRect().top -
        vp.getBoundingClientRect().top +
        vp.scrollTop +
        controller.pendingShift +
        parseFloat(css.paddingTop) -
        above,
      gap: parseFloat(css.rowGap) || 0,
    }
    if (Math.abs(next.margin - metrics.margin) > 0.5 || next.gap !== metrics.gap) setMetrics(next)
    let appendedFrom: number | null = null
    if (seenLast.current !== null && seenLast.current !== lastKey) {
      const i = findIndex(count, getItemKey, seenLast.current)
      if (i !== -1) appendedFrom = i + 1
    }
    seenLast.current = lastKey
    controller.commit(appendedFrom)
  })

  const attach = useCallback(
    (el: HTMLDivElement) => {
      list.current = el
      const detach = controller.attachContent(el)
      return () => {
        detach()
        list.current = null
      }
    },
    [controller],
  )
  const attachRef = useAttachRef(attach, ref)
  return (
    <ListContext value={virtualizer}>
      <div
        ref={attachRef}
        data-slot="message-scroller-content"
        data-count={count}
        role="log"
        aria-relevant="additions"
        className={cn(
          'flex h-max flex-col gap-1 px-3 pt-(--above) pb-(--below)',
          className,
        )}
        // 上下没渲染的项撑开的高度，加上原本的 p-3
        style={
          {
            ...style,
            '--above': `calc(var(--spacing) * 3 + ${above}px)`,
            '--below': `calc(var(--spacing) * 3 + ${below}px)`,
          } as CSSProperties
        }
        {...props}
      >
        {items.map((item) => children(item.index))}
      </div>
    </ListContext>
  )
}

/** 从后往前找：追加、定位到的通常在后面 */
function findIndex(count: number, getItemKey: (index: number) => string, key: string) {
  for (let i = count - 1; i >= 0; i--) if (getItemKey(i) === key) return i
  return -1
}

const messageScrollerItemVariants = cva(
  // 不用 content-visibility：屏幕外的项按估算尺寸占位，滚进来换成实际尺寸时 iOS Safari 的视口会跳，补偿也盖不住。
  // 高亮的圆角底色画在垫在内容下面的伪元素上。
  // 项内（日期、未读等提示与消息）与项间同样用 flex 间距排开：块布局里项内的外边距会折叠、项间不会，间距就对不齐。
  // 高亮的淡出比动效节奏里最长的一档还长：它是停留后慢慢褪去，太快就成了一闪
  'relative flex min-w-0 shrink-0 flex-col gap-1 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-3xl before:bg-primary/15 before:opacity-0 before:transition-opacity before:duration-700 data-entering:animate-in data-entering:fade-in data-entering:duration-standard data-entering:ease-enter motion-safe:data-entering:slide-in-from-bottom-4',
  {
    variants: {
      variant: {
        default: '',
        // 定位到的消息：短暂高亮
        highlighted: 'before:opacity-100',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** index：在 MessageScrollerContent 的 children 里收到的下标 */
function MessageScrollerItem({
  index,
  messageId,
  variant = 'default',
  className,
  ...props
}: ComponentProps<'div'> & { index: number; messageId: string } & VariantProps<typeof messageScrollerItemVariants>) {
  const controller = useController()
  const list = use(ListContext)
  const self = useRef<HTMLDivElement>(null)
  // 发件箱的消息发送成功后 messageId 会变，ref 随之重新挂载
  const observe = useCallback(
    (el: HTMLDivElement) => {
      self.current = el
      list?.measureElement(el)
      const unobserve = controller.observeItem(el, messageId)
      return () => {
        unobserve()
        // 清掉虚拟列表里已经移除的元素
        list?.measureElement(null)
      }
    },
    [controller, list, messageId],
  )
  // 不随 messageId 重新登记：发送成功时项里的状态照常交叉淡入淡出
  useLayoutEffect(() => trackItem(self.current!), [])
  return (
    <div
      ref={observe}
      data-slot="message-scroller-item"
      data-index={index}
      data-message-id={messageId}
      data-variant={variant}
      // 入场动画只播一次
      onAnimationEnd={(e) => e.target === e.currentTarget && e.currentTarget.removeAttribute('data-entering')}
      className={cn(messageScrollerItemVariants({ variant }), className)}
      {...props}
    />
  )
}

/** 不在底部时出现；点击平滑滚到底，onClick 里 preventDefault 可以换成自己的处理。显隐动画放在外层，Button 保持原样 */
function MessageScrollerButton({ onClick, ...props }: ComponentProps<typeof Button>) {
  const controller = useController()
  const away = useSyncExternalStore(controller.away.subscribe, controller.away.get)
  return (
    <div
      data-active={away}
      inert={!away}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 transition duration-standard ease-enter data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=false]:duration-fast data-[active=false]:ease-exit motion-safe:data-[active=false]:translate-y-full motion-safe:data-[active=false]:scale-95"
    >
      <Button
        variant="floating"
        size="icon-sm"
        onClick={(e) => {
          onClick?.(e)
          if (e.defaultPrevented) return
          e.currentTarget.blur()
          controller.scrollToEnd()
        }}
        {...props}
      />
    </div>
  )
}

export {
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
}
