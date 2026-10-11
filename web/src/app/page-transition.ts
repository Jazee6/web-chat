// 页面切换的方向：路由每次换页时给 View Transition 标上 forward / back / same，动画见 index.css。
// 按路由层级判断，与历史方向无关：首页 0 → 会话 1 → 群信息、资料页、加入页 2
import type { ParsedLocation } from '@tanstack/react-router'

export type PageTransition = 'forward' | 'back' | 'same'

/** 首页与分享页（移动端都在主区显示对话列表）是 0，会话是 1，其余更深 */
export function pageDepth(pathname: string): number {
  if (pathname === '/' || pathname === '/share') return 0
  if (/^\/c\/[^/]+\/?$/.test(pathname)) return 1
  return 2
}

export function pageTransition(from: string, to: string): PageTransition {
  const d = pageDepth(to) - pageDepth(from)
  return d > 0 ? 'forward' : d < 0 ? 'back' : 'same'
}

// iOS Safari 的边缘滑动返回自己已经播过页面动画，这时不再叠一层。
// 捕获阶段先于路由自己的 popstate 监听执行，路由换页时取用一次
let uaTransition = false
if (typeof window !== 'undefined') {
  addEventListener('popstate', (e) => void (uaTransition = e.hasUAVisualTransition === true), { capture: true })
}

/** 移动端的侧栏抽屉开着：从抽屉里选中一项时，抽屉收起就是过渡，下面的页面直接换好 */
function drawerOpen() {
  return document.querySelector('[data-slot="sidebar"][data-mobile="true"]') !== null
}

function types({ fromLocation, toLocation, pathChanged }: {
  fromLocation?: ParsedLocation
  toLocation: ParsedLocation
  pathChanged: boolean
}): string[] | false {
  const skipped = uaTransition
  uaTransition = false
  // 只换了查询参数（定位消息）不算换页
  if (!fromLocation || !pathChanged || skipped || drawerOpen()) return false
  return [pageTransition(fromLocation.pathname, toLocation.pathname)]
}

export const viewTransition = { types }
