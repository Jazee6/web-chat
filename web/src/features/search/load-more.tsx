import { useEffect, useRef } from 'react'

/** 放在列表末尾：进入可见范围（下方 200px 内）时调用 onVisible，用于滚到底加载更多 */
export function LoadMore({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = ref.current
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && onVisible(), {
      rootMargin: '0px 0px 200px 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [onVisible])
  return <div ref={ref} aria-hidden />
}
