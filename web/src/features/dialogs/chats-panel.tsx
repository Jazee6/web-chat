import { useRef, useState, type ReactNode, type UIEvent } from 'react'

import { SidebarContent } from '@/components/ui/sidebar'
import { GlobalSearchResults } from '@/features/search/global-search'
import { searchTerms } from '@/features/search/sql'
import { PushPrompt } from '@/features/notifications/push-prompt'
import { useDebounced } from '@/hooks/use-debounced'
import { ChatsHeader } from './chats-header'
import { DialogList } from './dialog-list'
import { NewButton } from './new-button'

/** 滚动方向累计超过这么多像素才切换悬浮按钮的显隐，避免抖动 */
const SCROLL_THRESHOLD = 8

/**
 * 对话列表面板：头部（搜索框、更多菜单），children 放在头部下方（没有时显示开启通知的提示），然后是对话列表，右下角悬浮新建按钮；
 * 有搜索词时列表换成全局搜索的结果
 */
export function ChatsPanel({ children }: { children?: ReactNode }) {
  const [query, setQuery] = useState('')
  const terms = searchTerms(useDebounced(query, 150))
  const scroll = useHideOnScrollDown()

  return (
    <>
      <ChatsHeader query={query} onQueryChange={setQuery} />
      {children ?? <PushPrompt />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <SidebarContent onScroll={scroll.onScroll}>
          {terms.length > 0 ? <GlobalSearchResults key={terms.join(' ')} terms={terms} /> : <DialogList />}
        </SidebarContent>
        <NewButton hidden={scroll.hidden} />
      </div>
    </>
  )
}

/** 向下滚动时 hidden，向上滚动或回到顶部（含 iOS 回弹）时恢复 */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false)
  const anchor = useRef(0)

  const onScroll = (e: UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop
    if (top <= 0) {
      anchor.current = 0
      setHidden(false)
      return
    }
    const delta = top - anchor.current
    if (Math.abs(delta) < SCROLL_THRESHOLD) return
    anchor.current = top
    setHidden(delta > 0)
  }

  return { hidden, onScroll }
}
