// 消息区的滚动容器：贴底跟随、挂载时定位到锚点、内容变化时保持视口、新消息入场动画。见 docs/architecture/07-client.md § 消息列表
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type Ref,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { trackItem } from './item-motion'
import { ScrollController, ScrollerContext, useController } from './message-scroller-controller'

/** 定位到锚点时锚点上方留出的距离；也是可见性判定时顶部让出的高度（浮在上方的标题栏）。默认值，见 MessageScroller 的 peek */
const PEEK = 64
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
  useLayoutEffect(() => controller.commit(follow))
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

function MessageScrollerContent({ className, ref, ...props }: ComponentProps<'div'>) {
  const controller = useController()
  const attach = useCallback((el: HTMLDivElement) => controller.attachContent(el), [controller])
  const attachRef = useAttachRef(attach, ref)
  return (
    <div
      ref={attachRef}
      data-slot="message-scroller-content"
      role="log"
      aria-relevant="additions"
      className={cn('flex h-max flex-col gap-1 p-3', className)}
      {...props}
    />
  )
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

function MessageScrollerItem({
  messageId,
  variant = 'default',
  className,
  ...props
}: ComponentProps<'div'> & { messageId: string } & VariantProps<typeof messageScrollerItemVariants>) {
  const controller = useController()
  const self = useRef<HTMLDivElement>(null)
  // 发件箱的消息发送成功后 messageId 会变，ref 随之重新挂载
  const observe = useCallback(
    (el: HTMLDivElement) => {
      self.current = el
      return controller.observeItem(el, messageId)
    },
    [controller, messageId],
  )
  // 不随 messageId 重新登记：发送成功时项里的状态照常交叉淡入淡出
  useLayoutEffect(() => trackItem(self.current!), [])
  return (
    <div
      ref={observe}
      data-slot="message-scroller-item"
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
