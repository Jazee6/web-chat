import { PhoneIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Person } from '@/features/contacts/queries'
import { useConnectionStatus } from '@/sync/client'
import { useGroupCall } from './group-session'
import { startCall, useCall } from './session'

/** 私聊标题栏的呼叫按钮：总是以语音开始，通话中再开摄像头。对方不是我的联系人时只走中继 */
export function CallButton({ chatId, peerId, person }: { chatId: string; peerId: string; person: Person | undefined }) {
  const view = useCall()
  const online = useConnectionStatus() === 'online'
  const group = useGroupCall()
  const busy = (view.phase !== 'idle' && view.phase !== 'ended') || group.phase !== 'idle'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={!online || busy || person === undefined}
            onClick={() => void startCall(chatId, peerId, person?.contact !== true)}
          />
        }
      >
        <PhoneIcon />
        <span className="sr-only">Call</span>
      </TooltipTrigger>
      <TooltipContent>Call</TooltipContent>
    </Tooltip>
  )
}
