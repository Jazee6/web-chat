import { Suspense, lazy, useRef } from 'react'
import {
  ChevronDownIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneIcon,
  PhoneOffIcon,
  PictureInPicture2Icon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { UserAvatar } from '@/components/user-avatar'
import { isMirrored } from '@/features/av/devices'
import { cn } from '@/lib/utils'
import { useCallStatus, usePeer } from './hooks'
import {
  acceptCall,
  flipCamera,
  hangUp,
  screenShareSupported,
  setMinimized,
  toggleCamera,
  toggleMic,
  toggleScreen,
  useCall,
  type CallView,
} from './session'
import { useGroupCall } from './group-session'
import { CameraControl, MicControl } from './device-controls'
import { morphCall, screenMotion } from './morph'
import { StreamAudio, StreamVideo, Tip } from './streams'

const GroupCallLayer = lazy(() => import('./group-call-screen').then((m) => ({ default: m.GroupCallLayer })))

/**
 * 通话层：挂在应用布局上，有通话时覆盖整个窗口；收起后只留对方的声音，头部显示通话条。
 * 对方的声音总在这里播放，与界面是否收起无关
 */
export function CallLayer() {
  const view = useCall()
  const inGroupCall = useGroupCall().phase !== 'idle'
  return (
    <>
      {view.remote && <StreamAudio stream={view.remote.audio} />}
      {view.phase !== 'idle' && !view.minimized && <CallScreen view={view} />}
      {inGroupCall && (
        <Suspense>
          <GroupCallLayer />
        </Suspense>
      )}
    </>
  )
}

function CallScreen({ view }: { view: CallView }) {
  const person = usePeer(view.peerId)
  const status = useCallStatus(view)
  const mainVideo = useRef<HTMLVideoElement>(null)
  const name = person?.name ?? ''
  // 对方在共享屏幕时屏幕是主画面，摄像头缩到角落；否则摄像头是主画面
  const main = view.remote && view.peer.screen ? view.remote.screen : view.remote && view.peer.camera ? view.remote.camera : null
  const corner = view.remote && view.peer.screen && view.peer.camera ? view.remote.camera : null
  const live = view.phase === 'connecting' || view.phase === 'active'
  // 对方关了麦克风：像群组通话的名字标签一样标出来，免得以为是线路没声音
  const peerMuted = view.phase === 'active' && !view.peer.mic ? (
    <Badge variant="secondary">
      <MicOffIcon data-icon="inline-start" />
      Muted
    </Badge>
  ) : null

  return (
    <div ref={screenMotion} data-call-screen="" className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {main ? (
          <StreamVideo ref={mainVideo} stream={main} className="size-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <UserAvatar name={name} image={person?.image ?? null} size="xl" />
            <span className="text-xl font-medium">{name}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{status}</span>
            {peerMuted}
          </div>
        )}
        {main && (
          <div className="app-blur absolute inset-x-0 top-0 flex flex-col items-center px-4 py-3">
            <span className="font-medium">{name}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{status}</span>
            {peerMuted}
          </div>
        )}
        <div className="absolute right-3 bottom-3 flex flex-col items-end gap-2">
          {corner && <StreamVideo stream={corner} className="w-32 rounded-xl" />}
          {view.camera && <StreamVideo stream={view.camera} muted className={cn('w-32 rounded-xl', isMirrored(view.camera) && '-scale-x-100')} />}
        </div>
        <div className="absolute top-3 left-3 flex gap-1">
          {live && (
            <Tip label="Minimize">
              <Button variant="floating" size="icon" onClick={() => morphCall(() => setMinimized(true))}>
                <ChevronDownIcon />
              </Button>
            </Tip>
          )}
          {main && document.pictureInPictureEnabled && (
            <Tip label="Picture-in-picture">
              <Button variant="floating" size="icon" onClick={() => void mainVideo.current?.requestPictureInPicture().catch(() => {})}>
                <PictureInPicture2Icon />
              </Button>
            </Tip>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 p-6">
        {view.phase === 'incoming' ? (
          <>
            <Tip label="Decline">
              <Button variant="destructive" size="icon-lg" onClick={() => void hangUp()}>
                <PhoneOffIcon />
              </Button>
            </Tip>
            <Tip label="Accept">
              <Button size="icon-lg" onClick={() => void acceptCall(person?.contact !== true)}>
                <PhoneIcon />
              </Button>
            </Tip>
          </>
        ) : view.phase === 'ended' ? null : (
          <>
            <MicControl on={view.mic} onToggle={toggleMic} />
            <CameraControl on={view.camera !== null} disabled={!live} onToggle={() => void toggleCamera()} onFlip={flipCamera} />
            {screenShareSupported && (
              <Tip label={view.screen ? 'Stop sharing' : 'Share screen'}>
                <Toggle variant="outline" size="lg" pressed={view.screen !== null} disabled={!live} onPressedChange={() => void toggleScreen()}>
                  <MonitorUpIcon />
                </Toggle>
              </Tip>
            )}
            <Tip label="End call">
              <Button variant="destructive" size="icon-lg" onClick={() => void hangUp()}>
                <PhoneOffIcon />
              </Button>
            </Tip>
          </>
        )}
      </div>
    </div>
  )
}
