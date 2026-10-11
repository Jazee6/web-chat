import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { LinkIcon, WifiOffIcon } from 'lucide-react'
import { MAX_GROUP_MEMBERS, type InvitePreview } from 'shared/protocol'

import { SkeletonText } from '@/components/skeleton-text'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/user-avatar'
import { OpFailure, call, useConnectionStatus } from '@/sync/client'
import { randomId } from '@/sync/logic'
import { opErrorMessage } from './errors'
import { PlayerSlot } from '@/features/voice/player-bar'

/** 打开邀请链接的原因说明：链接失效、被移除过、群已满 */
const PROBLEMS: Partial<Record<string, { title: string; description: string }>> = {
  not_found: { title: 'Invite link not valid', description: 'This link was reset or doesn’t exist. Ask a member for a new one.' },
  forbidden: { title: 'You can’t join this group', description: 'You were removed from this group. Ask a member to add you back.' },
  chat_full: { title: 'This group is full', description: `Groups can have up to ${MAX_GROUP_MEMBERS} members.` },
}

type State = { k: 'loading' } | { k: 'preview'; preview: InvitePreview } | { k: 'problem'; code: string; message: string }

/** 邀请链接的落地页：先看群名与人数，确认后加入；已经是成员的直接进入会话。连上之后才请求 */
export function JoinPage({ code }: { code: string }) {
  const navigate = useNavigate()
  const status = useConnectionStatus()
  const [state, setState] = useState<State>({ k: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (status !== 'online') return
    let alive = true
    call('checkInvite', { code })
      .then((preview) => {
        if (!alive) return
        if (preview.member) void navigate({ to: '/c/$chatId', params: { chatId: preview.chat_id }, replace: true })
        else setState({ k: 'preview', preview })
      })
      .catch((e: unknown) => {
        // 离线由连接状态展示，重连后再请求
        if (!alive || (e instanceof OpFailure && e.code === 'offline')) return
        setState({ k: 'problem', code: e instanceof OpFailure ? e.code : 'internal', message: opErrorMessage(e, 'Try again in a moment.') })
      })
    return () => {
      alive = false
    }
  }, [code, attempt, navigate, status])

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger />
        <h1 className="truncate font-medium">Invite</h1>
        <PlayerSlot />
      </header>
      {state.k === 'loading' && status === 'offline' ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WifiOffIcon />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>You’re offline</EmptyTitle>
            <EmptyDescription>Connect to the internet to open this invite.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : state.k === 'loading' ? (
        // 与 Preview 同样的头像、群名、人数与按钮
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Skeleton variant="avatar" className="size-10" />
            </EmptyMedia>
            <EmptyTitle>
              <SkeletonText className="w-40" />
            </EmptyTitle>
            <EmptyDescription>
              <SkeletonText className="w-24" />
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Skeleton variant="control" className="h-9 w-28" />
          </EmptyContent>
        </Empty>
      ) : state.k === 'preview' ? (
        <Preview code={code} preview={state.preview} />
      ) : (
        <Problem
          code={state.code}
          message={state.message}
          onRetry={() => {
            setState({ k: 'loading' })
            setAttempt((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}

function Preview({ code, preview }: { code: string; preview: InvitePreview }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  // 同一次加入的重试沿用它
  const [rid] = useState(randomId)
  const full = preview.member_count >= MAX_GROUP_MEMBERS

  const join = async () => {
    setPending(true)
    try {
      await call('joinChat', { code, randomId: rid })
      await navigate({ to: '/c/$chatId', params: { chatId: preview.chat_id }, replace: true })
    } catch (e) {
      const problem = e instanceof OpFailure ? PROBLEMS[e.code] : undefined
      toast.add({ type: 'error', title: problem?.title ?? "Couldn't join the group", description: problem?.description ?? opErrorMessage(e, 'Try again.') })
      setPending(false)
    }
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <UserAvatar name={preview.title} image={null} size="lg" />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>{preview.title}</EmptyTitle>
        <EmptyDescription>
          {preview.member_count === 1 ? '1 member' : `${preview.member_count} members`}
          {full && ' · This group is full'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={pending || full} onClick={() => void join()}>
          {pending && <Spinner data-icon="inline-start" />}
          Join group
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function Problem({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  const problem = PROBLEMS[code]
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LinkIcon />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>{problem?.title ?? 'Couldn’t open this invite'}</EmptyTitle>
        <EmptyDescription>{problem?.description ?? message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {problem ? (
          <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
            Back to chats
          </Button>
        ) : (
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}
