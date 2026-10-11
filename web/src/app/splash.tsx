import { MessageCircleIcon } from 'lucide-react'

import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

/** 启动画面：确认登录状态（首次打开时要等 get-session）、跳转登录等全屏等待时显示。图标与应用图标同为对话气泡 */
export function Splash() {
  return (
    <div className="flex h-svh flex-col">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>Web Chat</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Spinner />
        </EmptyContent>
      </Empty>
    </div>
  )
}
