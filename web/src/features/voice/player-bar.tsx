import { useEffect, useId } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PauseIcon, PlayIcon, XIcon } from 'lucide-react'
import { formatDuration } from 'shared/text'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { useMe } from '@/features/auth/me'
import { CallSlot } from '@/features/calls/call-bar'
import { GroupCallSlot } from '@/features/calls/group-call-bar'
import { barMotion } from '@/features/calls/morph'
import { useCallBar, useGroupCallBar } from '@/features/calls/hooks'
import { inPip } from '@/features/pip/pip'
import { useUsers } from '@/hooks/use-users'
import { locale } from '@/lib/format'
import { cn } from '@/lib/utils'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { POSITION_FORMAT, RATES, close, seek, setRate, toggle, usePlayer, type PlayerState } from './player'

type Playing = PlayerState & { track: NonNullable<PlayerState['track']> }

/**
 * 播放条：放在每个页面标题栏中间的剩余空间里，有语音在播放器里（播放中或暂停着）时才出现。
 * 放得下时显示完整的控件，放不下（窄屏）时只留一个带进度环的按钮，点开再显示完整控件。
 * compact：总是紧凑（例如手机上的对话列表顶栏）。通话界面收起时这里换成通话条
 */
export function PlayerSlot({ compact = false }: { compact?: boolean }) {
  const player = usePlayer()
  // 通话中通话条代替播放条
  const call = useCallBar()
  const group = useGroupCallBar()
  if (call) return <CallSlot view={call} compact={compact} />
  if (group) return <GroupCallSlot view={group} compact={compact} />
  if (!player.track) return null
  return <Slot player={player as Playing} compact={compact} />
}

function Slot({ player, compact }: { player: Playing; compact: boolean }) {
  const { chatId, seq } = player.track
  // 正在播的语音被撤回（或者整个会话从本地删除）：停止
  const rows = useLiveQuery<{ kind: string }>('SELECT kind FROM messages WHERE chat_id = ? AND seq = ?', [chatId, seq], [
    topics.chat(chatId),
  ])
  const gone = rows !== undefined && rows[0]?.kind !== 'media'
  useEffect(() => {
    if (gone) close()
  }, [gone])

  const popover = (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className={cn(!compact && '@xs:hidden')} aria-label="Voice message player" />}
      >
        <span className="relative grid size-8 place-items-center">
          <ProgressRing value={player.position / player.track.duration} />
          {player.loading ? <Spinner /> : player.playing ? <PauseIcon /> : <PlayIcon />}
        </span>
      </PopoverTrigger>
      <PopoverContent>
        <PlayerControls player={player} />
      </PopoverContent>
    </Popover>
  )
  if (compact) return <div ref={barMotion}>{popover}</div>

  // container 没有自身的宽度，只分到剩余空间：至少留出紧凑按钮的宽度，长标题时由标题让出
  return (
    <div ref={barMotion} className="@container flex min-w-9 flex-1 justify-center">
      <div className="hidden w-full max-w-80 @xs:block">
        <PlayerControls player={player} />
      </div>
      {popover}
    </div>
  )
}

/** 播放 / 暂停、发送者（点击定位到那条消息）与进度、已播放的时间、倍速、关闭 */
function PlayerControls({ player }: { player: Playing }) {
  const me = useMe()
  const users = useUsers()
  const navigate = useNavigate()
  const { track } = player
  const name = track.senderId === me.id ? 'You' : (users.get(track.senderId)?.name ?? 'Someone')
  const nextRate = RATES[(RATES.indexOf(player.rate) + 1) % RATES.length]!
  // 滑块的名字只能经 aria-labelledby 传到里面的 input
  const labelId = useId()

  return (
    <div className="flex w-full items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label={player.playing ? 'Pause' : 'Play'} disabled={player.loading} onClick={toggle}>
        {player.loading ? <Spinner /> : player.playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <div className="grid min-w-0 flex-1 gap-1">
        {/* 画中画里只有这一个会话，不跳转 */}
        <Button
          variant="ghost"
          size="xs"
          className="min-w-0 justify-start"
          disabled={inPip}
          onClick={() => void navigate({ to: '/c/$chatId', params: { chatId: track.chatId }, search: { m: track.seq } })}
        >
          <span className="truncate">{name}</span>
        </Button>
        <span id={labelId} className="sr-only">
          Playback position
        </span>
        {/* 值要给数组：单个数值时 Slider 会按 [min, max] 渲染出两个滑块 */}
        <Slider
          size="sm"
          aria-labelledby={labelId}
          min={0}
          max={track.duration}
          step={0.1}
          format={POSITION_FORMAT}
          locale={locale}
          value={[player.position]}
          disabled={player.loading}
          onValueChange={(v) => seek(Array.isArray(v) ? v[0]! : v)}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(player.position)}</span>
      <Button variant="ghost" size="xs" aria-label={`Playback speed ${player.rate}×`} onClick={() => setRate(nextRate)}>
        {player.rate}×
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close player" onClick={close}>
        <XIcon />
      </Button>
    </div>
  )
}

/** 紧凑版按钮外圈的进度环 */
function ProgressRing({ value }: { value: number }) {
  const r = 16
  const length = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="2" className="stroke-muted" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - Math.min(1, value))}
        className="stroke-primary"
      />
    </svg>
  )
}
