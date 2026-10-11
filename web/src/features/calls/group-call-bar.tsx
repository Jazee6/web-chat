import { PhoneIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { UserAvatar } from '@/components/user-avatar'
import { useGroupDialog } from '@/features/chat/hooks'
import { useUsers } from '@/hooks/use-users'
import { revealMotion } from '@/lib/presence'
import { useConnectionStatus } from '@/sync/client'
import { inGroupCall, joinGroupCall, setGroupMinimized, useGroupCall, useGroupCallOf, type GroupView } from './group-session'
import { groupCallDuration, useNow } from './hooks'
import { barMotion, morphCall } from './morph'
import { useCall } from './session'

/** 群组通话收起后的通话条：群名与时长，点击回到通话界面。compact：只留图标与时长（窄屏） */
export function GroupCallSlot({ view, compact }: { view: GroupView; compact: boolean }) {
  const dialog = useGroupDialog(view.chatId ?? '')
  const now = useNow(true)
  return (
    <div ref={barMotion} className="flex min-w-9 flex-1 justify-center">
      <Button
        data-call-bar=""
        variant="secondary"
        size="sm"
        className="min-w-0 max-w-80"
        onClick={() => morphCall(() => setGroupMinimized(false))}
      >
        <UsersIcon data-icon="inline-start" />
        {!compact && <span className="truncate">{dialog?.title ?? ''}</span>}
        <span className="tabular-nums">{groupCallDuration(view, now)}</span>
      </Button>
    </div>
  )
}

/** 能不能发起或加入：在线，并且本标签页不在别的通话里 */
function useCanJoin() {
  const online = useConnectionStatus() === 'online'
  const call = useCall()
  const group = useGroupCall()
  return online && (call.phase === 'idle' || call.phase === 'ended') && group.phase === 'idle'
}

/** 群组标题栏的通话按钮：没有通话时发起（开着麦克风），有时加入（静音），自己已在里面时与横条一样回到通话界面 */
export function GroupCallButton({ chatId }: { chatId: string }) {
  const call = useGroupCallOf(chatId)
  const canJoin = useCanJoin()
  const group = useGroupCall()
  const here = inGroupCall(chatId) && group.phase === 'active'
  const label = here ? 'Open call' : call ? 'Join call' : 'Start call'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={!here && !canJoin}
            onClick={() => (here ? morphCall(() => setGroupMinimized(false)) : void joinGroupCall(chatId))}
          />
        }
      >
        <PhoneIcon />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** 标题栏下方的横条：群里有通话时显示参与者与人数，从这里加入；自己在里面时回到通话界面 */
export function GroupCallBanner({ chatId }: { chatId: string }) {
  const call = useGroupCallOf(chatId)
  const users = useUsers()
  const canJoin = useCanJoin()
  const group = useGroupCall()
  if (!call) return null
  const here = inGroupCall(chatId) && group.phase === 'active'
  const count = call.participants.length
  const shown = call.participants.slice(0, 3)
  return (
    <div ref={revealMotion} className="app-blur absolute inset-x-0 top-14 z-10 flex h-12 items-center gap-3 px-3">
      <AvatarGroup className="shrink-0">
        {shown.map((p) => (
          <UserAvatar key={p.user_id} name={users.get(p.user_id)?.name ?? null} image={users.get(p.user_id)?.image ?? null} size="sm" />
        ))}
        {count > shown.length && <AvatarGroupCount>+{count - shown.length}</AvatarGroupCount>}
      </AvatarGroup>
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium">Group call</span>
        <span className="truncate text-xs/4 text-muted-foreground">{count === 1 ? '1 participant' : `${count} participants`}</span>
      </div>
      {here ? (
        <Button size="sm" variant="secondary" onClick={() => morphCall(() => setGroupMinimized(false))}>
          Open
        </Button>
      ) : (
        <Button size="sm" disabled={!canJoin} onClick={() => void joinGroupCall(chatId)}>
          Join
        </Button>
      )}
    </div>
  )
}
