import { useEffect, useState } from 'react'
import { CopyIcon, RotateCcwIcon, ShareIcon } from 'lucide-react'
import { invitePath } from 'shared/protocol'

import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { OpFailure, call, useConnectionStatus } from '@/sync/client'
import { opErrorMessage } from './errors'

const inviteUrl = (code: string) => `${location.origin}${invitePath(code)}`

/**
 * 群组信息页里的邀请链接：所有成员可以复制与分享，群主可以重置。
 * 链接只在需要时向服务端要，不进本地库，所以连上之后才请求，离线时不可用
 */
export function InviteLink({ chatId, isOwner, title }: { chatId: string; isOwner: boolean; title: string }) {
  const status = useConnectionStatus()
  const [code, setCode] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (status !== 'online') return
    let alive = true
    call('getInvite', { chatId })
      .then((c) => alive && setCode(c))
      .catch((e: unknown) => {
        // 离线由连接状态展示
        if (alive && !(e instanceof OpFailure && e.code === 'offline')) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [chatId, attempt, status])

  const url = code && inviteUrl(code)

  const copy = () =>
    url &&
    navigator.clipboard.writeText(url).then(
      () => toast.add({ title: 'Link copied' }),
      () => toast.add({ type: 'error', title: "Couldn't copy the link" }),
    )
  const share = () => url && navigator.share({ title, url }).catch(() => {})

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Invite link</h2>
        {isOwner && code && <ResetButton chatId={chatId} onReset={setCode} />}
      </div>
      {url ? (
        <InputGroup>
          <InputGroupInput readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger render={<InputGroupButton size="icon-xs" aria-label="Copy link" onClick={() => void copy()} />}>
                <CopyIcon />
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
            {'share' in navigator && (
              <Tooltip>
                <TooltipTrigger render={<InputGroupButton size="icon-xs" aria-label="Share link" onClick={() => void share()} />}>
                  <ShareIcon />
                </TooltipTrigger>
                <TooltipContent>Share link</TooltipContent>
              </Tooltip>
            )}
          </InputGroupAddon>
        </InputGroup>
      ) : status === 'offline' ? (
        <Alert role="status">
          <AlertDescription>Connect to the internet to see the invite link.</AlertDescription>
        </Alert>
      ) : failed ? (
        <Alert>
          <AlertDescription>Couldn’t load the invite link.</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <Skeleton variant="control" className="h-9" />
      )}
      <p className="text-sm text-muted-foreground">Anyone with this link can join and see the whole chat history.</p>
    </section>
  )
}

function ResetButton({ chatId, onReset }: { chatId: string; onReset: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const reset = async () => {
    setPending(true)
    try {
      onReset(await call('resetInvite', { chatId }))
      setOpen(false)
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't reset the link", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        <RotateCcwIcon data-icon="inline-start" />
        Reset
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the invite link?</AlertDialogTitle>
          <AlertDialogDescription>
            The current link will stop working, including where it’s already been shared. Members will see the new link.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void reset()}>
            {pending && <Spinner data-icon="inline-start" />}
            Reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
