import { LogInIcon } from 'lucide-react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { MeContext } from '@/features/auth/me'
import type { Boot } from '@/features/auth/session'
import { ChatPage } from '@/features/chat/chat-page'

/** 画中画小窗里的页面：只有一个会话，没有侧栏；登录等流程都留给主窗口 */
export function PipPage({ boot, chatId }: { boot: Boot; chatId: string }) {
  if (!boot.me) {
    return (
      <Empty className="h-svh">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LogInIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>You’re signed out</EmptyTitle>
          <EmptyDescription>Sign in again in the main window.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <MeContext value={boot.me}>
      <ChatPage key={chatId} chatId={chatId} />
    </MeContext>
  )
}
