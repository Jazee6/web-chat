import { Suspense, lazy, useState, type ReactNode } from 'react'
import { ArrowLeftIcon } from 'lucide-react'

import { MenuListSkeleton } from '@/components/menu-list-skeleton'
import { SkeletonText } from '@/components/skeleton-text'
import { Button } from '@/components/ui/button'
import { SidebarContent, SidebarHeader, SidebarTrigger } from '@/components/ui/sidebar'
import { ChatsPanel } from '@/features/dialogs/chats-panel'
import { PanelContext, type Panel } from './panel-context'

const ContactsPanel = lazy(() => import('./contacts-panel').then((m) => ({ default: m.ContactsPanel })))
const CallsPanel = lazy(() => import('@/features/calls/calls-panel').then((m) => ({ default: m.CallsPanel })))

/**
 * 在对话列表、联系人列表与最近通话之间切换，右侧的页面不受影响。桌面端在左栏，移动端首页与分享页在主区；
 * children 放在对话列表头部下方
 */
export function SidebarPanels({ children }: { children?: ReactNode }) {
  const [panel, setPanel] = useState<Panel>('chats')
  return (
    <PanelContext value={{ panel, setPanel }}>
      <Suspense fallback={<PanelSkeleton onBack={() => setPanel('chats')} />}>
        {panel === 'contacts' ? <ContactsPanel /> : panel === 'calls' ? <CallsPanel /> : <ChatsPanel>{children}</ChatsPanel>}
      </Suspense>
    </PanelContext>
  )
}

/** 联系人、最近通话的代码还没下载完时先占位，布局与两个面板相同 */
function PanelSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SidebarHeader variant="toolbar">
        <SidebarTrigger className="hidden in-data-[mobile=true]:inline-flex" />
        <Button variant="ghost" size="icon" aria-label="Back to chats" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <SkeletonText className="w-32 text-sm" />
      </SidebarHeader>
      <SidebarContent>
        <MenuListSkeleton rows="call" />
      </SidebarContent>
    </>
  )
}
