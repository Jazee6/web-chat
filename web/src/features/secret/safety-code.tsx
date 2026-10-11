import { useEffect, useState } from 'react'

import { ResponsiveDialog } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { call } from '@/sync/client'
import { useSecretEpoch } from './queries'

/**
 * 安全码：12 组 5 位数。双方当面或在通话里核对，一样就说明双方的设备都是对方以为的那些。
 * 有设备加入或移除时会变（会话里随之出现一条服务消息）
 */
export function SafetyCodeDialog({
  chatId,
  name,
  open,
  onOpenChange,
}: {
  chatId: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const epoch = useSecretEpoch(chatId)
  // 纪元变化时重新算；null 为本设备还没加入
  const [code, setCode] = useState<{ epoch: number | null; groups: string[] | null } | null>(null)
  useEffect(() => {
    if (!open || epoch === undefined) return
    let live = true
    call('safetyCode', { chatId })
      .then((groups) => live && setCode({ epoch, groups }))
      .catch(() => live && setCode({ epoch, groups: null }))
    return () => {
      live = false
    }
  }, [open, chatId, epoch])
  const current = code !== null && code.epoch === epoch ? code.groups : undefined

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Safety code"
      description={`Compare these numbers with ${name} in person or on a call. If they match, only your and their devices can read this chat.`}
    >
      {(Footer) => (
        <>
          <div className="px-4 md:px-0">
            {current === null ? (
              <p className="text-sm text-muted-foreground">This device hasn’t joined the chat yet.</p>
            ) : (
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 font-mono text-lg tabular-nums">
                {current === undefined
                  ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-7" />)
                  : current.map((group, i) => <span key={i}>{group}</span>)}
              </div>
            )}
          </div>
          <Footer>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </Footer>
        </>
      )}
    </ResponsiveDialog>
  )
}
