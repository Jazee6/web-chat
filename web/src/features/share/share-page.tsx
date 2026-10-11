import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { Share2Icon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { SidebarPanels } from '@/features/contacts/sidebar-panel'
import { cancelShare, describeShare, setPendingShare } from './pending'
import { readShare, type SharedContent } from './stash'
import { PlayerSlot } from '@/features/voice/player-bar'
import { Splash } from '@/app/splash'

/**
 * 从系统分享面板进来：用对话列表选会话（桌面端在左栏，移动端在主区），
 * 选中后分享的内容预填到输入框，由用户确认后发送
 */
export function SharePage() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const [content, setContent] = useState<SharedContent | null | undefined>(undefined)

  useEffect(() => {
    void readShare()
      .catch(() => null)
      .then((shared) => {
        setPendingShare(shared)
        setContent(shared)
      })
  }, [])

  if (content === undefined) return <Splash />
  if (content === null) return <Navigate to="/" />

  const cancel = () => {
    void cancelShare()
    void navigate({ to: '/' })
  }
  const description = `${describeShare(content)} will be added to the message box so you can review it before sending.`

  if (isMobile) {
    return (
      <div className="flex h-svh flex-col">
        <SidebarPanels>
          <div className="px-2">
            <Alert role="status">
              <Share2Icon />
              <AlertTitle>Choose a chat</AlertTitle>
              <AlertDescription>{description}</AlertDescription>
              <AlertAction>
                <Button size="sm" variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              </AlertAction>
            </Alert>
          </div>
        </SidebarPanels>
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
            <Share2Icon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>Choose a chat</EmptyTitle>
          <EmptyDescription>Pick a chat from the list. {description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
