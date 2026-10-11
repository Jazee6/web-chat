import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, PhoneIcon, PhoneIncomingIcon, PhoneMissedIcon, PhoneOutgoingIcon, UsersIcon } from 'lucide-react'
import { isGroupChatId, isMissedCall, type CallResult } from 'shared/protocol'
import { describeCall, formatDuration } from 'shared/text'

import { MenuListSkeleton } from '@/components/menu-list-skeleton'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { useSidebarPanel } from '@/features/contacts/panel-context'
import { useListMotion } from '@/hooks/use-list-motion'
import { formatDialogDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { topics } from '@/sync/bridge'
import { useConnectionStatus } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { startCall, useCall } from './session'

type CallRow = {
  call_id: string
  chat_id: string
  seq: number
  peer_id: string
  caller_id: string
  result: CallResult
  duration: number
  date: number
  name: string | null
  image: string | null
  contact: number | null
  blocked: number | null
  /** 群组通话的群名 */
  title: string | null
}

/** 侧栏里的最近通话（见 CONTEXT.md「最近通话」）：点一条回拨 */
export function CallsPanel() {
  const { setPanel } = useSidebarPanel()
  const listRef = useListMotion<HTMLUListElement>()
  const calls = useLiveQuery<CallRow>(
    `SELECT c.*, p.name, p.image, p.contact, p.blocked, d.title
     FROM calls c LEFT JOIN people p ON p.id = c.peer_id LEFT JOIN dialogs d ON d.chat_id = c.chat_id
     ORDER BY c.date DESC, c.call_id`,
    [],
    [topics.calls, topics.users, topics.dialogs],
  )

  return (
    <>
      <SidebarHeader variant="toolbar">
        <SidebarTrigger className="hidden in-data-[mobile=true]:inline-flex" />
        <Button variant="ghost" size="icon" aria-label="Back to chats" onClick={() => setPanel('chats')}>
          <ArrowLeftIcon />
        </Button>
        <h2 className="flex-1 truncate text-sm font-medium">Recent calls</h2>
      </SidebarHeader>
      <SidebarContent>
        {calls === undefined ? (
          <MenuListSkeleton rows="call" />
        ) : calls.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PhoneIcon />
              </EmptyMedia>
              <EmptyTitle role="heading" aria-level={2}>No calls yet</EmptyTitle>
              <EmptyDescription>Calls you make and receive will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu ref={listRef} className="relative">
                {calls.map((call) =>
                  isGroupChatId(call.chat_id) ? <GroupCallItem key={call.call_id} call={call} /> : <CallItem key={call.call_id} call={call} />,
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </>
  )
}

function CallItem({ call }: { call: CallRow }) {
  const me = useMe()
  const view = useCall()
  const online = useConnectionStatus() === 'online'
  const outgoing = call.caller_id === me.id
  const missed = !outgoing && isMissedCall(call.result)
  const Icon = missed ? PhoneMissedIcon : outgoing ? PhoneOutgoingIcon : PhoneIncomingIcon
  const busy = view.phase !== 'idle' && view.phase !== 'ended'

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        disabled={!online || busy || call.blocked === 1}
        onClick={() => void startCall(call.chat_id, call.peer_id, call.contact !== 1)}
      >
        <UserAvatar name={call.name} image={call.image} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn('truncate font-medium', missed && 'text-destructive')}>{call.name ?? ' '}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{describeCall(call.result, outgoing, call.duration)}</span>
            <span className="ml-auto shrink-0">{formatDialogDate(call.date)}</span>
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** 自己加入过的群组通话：点击打开会话 */
function GroupCallItem({ call }: { call: CallRow }) {
  const { setPanel } = useSidebarPanel()
  const { isMobile, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        onClick={() => {
          setPanel('chats')
          if (isMobile) setOpenMobile(false)
          void navigate({ to: '/c/$chatId', params: { chatId: call.chat_id }, search: { m: call.seq } })
        }}
      >
        <UserAvatar name={call.title} image={null} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-medium">{call.title ?? ' '}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <UsersIcon className="size-3 shrink-0" />
            <span className="truncate">Group call ({formatDuration(call.duration)})</span>
            <span className="ml-auto shrink-0">{formatDialogDate(call.date)}</span>
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
