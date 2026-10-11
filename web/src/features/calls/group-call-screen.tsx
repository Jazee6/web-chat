import { useRef } from 'react'
import { ChevronDownIcon, MicOffIcon, MonitorUpIcon, PhoneOffIcon, PictureInPicture2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { isMirrored } from '@/features/av/devices'
import { useGroupDialog } from '@/features/chat/hooks'
import { useUsers } from '@/hooks/use-users'
import { cn } from '@/lib/utils'
import {
  flipGroupCamera,
  focusOf,
  leaveGroupCall,
  setGroupMinimized,
  toggleGroupCamera,
  toggleGroupMic,
  toggleGroupScreen,
  togglePinned,
  useGroupCall,
  type Focus,
  type GroupView,
} from './group-session'
import { groupCallDuration, useNow } from './hooks'
import { morphCall, screenMotion } from './morph'
import { screenShareSupported } from './session'
import { CameraControl, MicControl } from './device-controls'
import { StreamAudio, StreamVideo, Tip } from './streams'

/** 群组通话层：在通话里时覆盖整个窗口；收起后只留别人的声音，头部显示通话条 */
export function GroupCallLayer() {
  const view = useGroupCall()
  if (view.phase === 'idle') return null
  return (
    <>
      {Object.entries(view.remote).map(([userId, media]) => media.mic && <StreamAudio key={userId} stream={media.mic} />)}
      {!view.minimized && <GroupCallScreen view={view} />}
    </>
  )
}

/** 宫格的列数：1 人一列，4 人以内两列，9 人以内三列，再多四列 */
const COLUMNS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4']

/** 宫格里的一格：某人的摄像头（没开时是头像），或某人的屏幕 */
type TileItem = { userId: string; slot: 'camera' | 'screen'; stream: MediaStream | null; mine: boolean }

function GroupCallScreen({ view }: { view: GroupView }) {
  const me = useMe()
  const users = useUsers()
  const dialog = useGroupDialog(view.chatId ?? '')
  const now = useNow(view.phase === 'active')
  const focusVideo = useRef<HTMLVideoElement>(null)
  const call = view.call
  const participants = call?.participants ?? []
  const muted = new Set(participants.filter((p) => p.muted).map((p) => p.user_id))
  const speaking = new Set(view.speaking)

  const tiles: TileItem[] = participants.flatMap((p) => {
    const mine = p.user_id === me.id
    const camera = mine ? view.camera : (view.remote[p.user_id]?.camera ?? null)
    const screen = mine ? view.screen : (view.remote[p.user_id]?.screen ?? null)
    const items: TileItem[] = [{ userId: p.user_id, slot: 'camera', stream: camera, mine }]
    if (p.tracks.screen || (mine && screen)) items.push({ userId: p.user_id, slot: 'screen', stream: screen, mine })
    return items
  })
  const focus = focusOf(view)
  const isFocus = (t: TileItem) => focus !== null && t.userId === focus.userId && t.slot === focus.slot
  const big = tiles.find(isFocus)
  const rest = big ? tiles.filter((t) => !isFocus(t)) : tiles
  const status = view.phase === 'joining' ? 'Joining…' : groupCallDuration(view, now)
  const count = participants.length
  const columns = rest.length <= 1 ? 0 : rest.length <= 4 ? 1 : rest.length <= 9 ? 2 : 3

  const tile = (t: TileItem, size: 'grid' | 'big' | 'strip') => (
    <Tile
      key={`${t.userId}:${t.slot}`}
      item={t}
      size={size}
      name={t.mine ? 'You' : (users.get(t.userId)?.name ?? '')}
      image={users.get(t.userId)?.image ?? null}
      muted={t.slot === 'camera' && (t.mine ? !view.mic : muted.has(t.userId))}
      speaking={t.slot === 'camera' && speaking.has(t.userId)}
      videoRef={size === 'big' ? focusVideo : undefined}
      onClick={t.stream ? () => togglePinned({ userId: t.userId, slot: t.slot } satisfies Focus) : undefined}
    />
  )

  return (
    <div ref={screenMotion} data-call-screen="" className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Tip label="Minimize">
          <Button variant="ghost" size="icon" onClick={() => morphCall(() => setGroupMinimized(true))}>
            <ChevronDownIcon />
          </Button>
        </Tip>
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{dialog?.title ?? 'Group call'}</span>
          <span className="truncate text-xs/4 text-muted-foreground tabular-nums">
            {count === 1 ? '1 participant' : `${count} participants`} · {status}
          </span>
        </div>
        {big?.stream && document.pictureInPictureEnabled && (
          <Tip label="Picture-in-picture">
            <Button variant="ghost" size="icon" onClick={() => void focusVideo.current?.requestPictureInPicture().catch(() => {})}>
              <PictureInPicture2Icon />
            </Button>
          </Tip>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3">
        {big ? (
          <>
            <div className="flex min-h-0 flex-1">{tile(big, 'big')}</div>
            {rest.length > 0 && <div className="flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28">{rest.map((t) => tile(t, 'strip'))}</div>}
          </>
        ) : (
          <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-2', COLUMNS[columns])}>
            {rest.map((t) => tile(t, 'grid'))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-3 p-6">
        <MicControl on={view.mic} disabled={view.phase !== 'active'} onToggle={() => void toggleGroupMic()} />
        <CameraControl
          on={view.camera !== null}
          disabled={view.phase !== 'active'}
          onToggle={() => void toggleGroupCamera()}
          onFlip={flipGroupCamera}
        />
        {screenShareSupported && (
          <Tip label={view.screen ? 'Stop sharing' : 'Share screen'}>
            <Toggle
              variant="outline"
              size="lg"
              pressed={view.screen !== null}
              disabled={view.phase !== 'active'}
              onPressedChange={() => void toggleGroupScreen()}
            >
              <MonitorUpIcon />
            </Toggle>
          </Tip>
        )}
        <Tip label="Leave call">
          <Button variant="destructive" size="icon-lg" onClick={() => void leaveGroupCall()}>
            <PhoneOffIcon />
          </Button>
        </Tip>
      </div>
    </div>
  )
}

function Tile({
  item,
  size,
  name,
  image,
  muted,
  speaking,
  videoRef,
  onClick,
}: {
  item: TileItem
  size: 'grid' | 'big' | 'strip'
  name: string
  image: string | null
  muted: boolean
  speaking: boolean
  videoRef?: React.Ref<HTMLVideoElement>
  onClick?: () => void
}) {
  const label = item.slot === 'screen' ? (item.mine ? 'Your screen' : `${name}’s screen`) : name
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring',
        size === 'strip' ? 'aspect-video h-full shrink-0' : 'size-full',
        speaking && 'ring-2 ring-primary',
        onClick && 'cursor-pointer',
      )}
    >
      {item.stream ? (
        <StreamVideo
          ref={videoRef}
          stream={item.stream}
          muted
          className={cn(
            'size-full',
            item.slot === 'screen' || size === 'big' ? 'object-contain' : 'object-cover',
            item.mine && item.slot === 'camera' && isMirrored(item.stream) && '-scale-x-100',
          )}
        />
      ) : (
        <UserAvatar name={name} image={image} size={size === 'strip' ? 'default' : 'xl'} />
      )}
      <Badge variant="overlay" className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)]">
        {muted && <MicOffIcon data-icon="inline-start" />}
        <span className="truncate">{label}</span>
      </Badge>
    </button>
  )
}
