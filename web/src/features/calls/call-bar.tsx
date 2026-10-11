import { PhoneIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCallStatus, usePeer } from './hooks'
import { barMotion, morphCall } from './morph'
import { setMinimized, type CallView } from './session'

/** 通话条：对方的名字与时长，点击回到通话界面。compact：只留图标与时长（窄屏） */
export function CallSlot({ view, compact }: { view: CallView; compact: boolean }) {
  const person = usePeer(view.peerId)
  const status = useCallStatus(view)
  return (
    <div ref={barMotion} className="flex min-w-9 flex-1 justify-center">
      <Button
        data-call-bar=""
        variant="secondary"
        size="sm"
        className="min-w-0 max-w-80"
        onClick={() => morphCall(() => setMinimized(false))}
      >
        <PhoneIcon data-icon="inline-start" />
        {!compact && <span className="truncate">{person?.name ?? ''}</span>}
        <span className="tabular-nums">{status}</span>
      </Button>
    </div>
  )
}
