import { MessagesSquareIcon } from 'lucide-react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { SidebarPanels } from '@/features/contacts/sidebar-panel'
import { PlayerSlot } from '@/features/voice/player-bar'

/** 首页：移动端主区直接显示对话列表；桌面端列表在左栏，主区为空状态 */
export function HomePage() {
  const { isMobile } = useSidebar()

  if (isMobile) {
    return (
      <div className="flex h-svh flex-col">
        <SidebarPanels />
      </div>
    )
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger />
        <PlayerSlot />
      </header>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>Select a chat</EmptyTitle>
          <EmptyDescription>Pick a conversation from the list, or start a new one.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
