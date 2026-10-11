import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { fadeInOutMotion } from '@/lib/presence'
import { call } from '@/sync/client'

/** 私聊里我拉黑了对方：代替输入框，要先解除拉黑才能发消息 */
export function BlockedBar({ userId, name }: { userId: string; name: string | null }) {
  const [pending, setPending] = useState(false)

  const unblock = async () => {
    setPending(true)
    try {
      await call('unblock', { userId })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't unblock this person", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={fadeInOutMotion} className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 p-3">
      <span className="text-sm text-muted-foreground">You blocked {name ?? 'this person'}.</span>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void unblock()}>
        {pending && <Spinner data-icon="inline-start" />}
        Unblock
      </Button>
    </div>
  )
}
