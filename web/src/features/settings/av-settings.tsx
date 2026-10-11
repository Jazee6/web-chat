import { useEffect, useState } from 'react'
import { Volume2Icon } from 'lucide-react'

import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { openCamera } from '@/features/av/camera'
import {
  avDevicesSupported,
  choose,
  isMirrored,
  requestAvAccess,
  selectedValue,
  speakerSupported,
  SYSTEM_DEFAULT,
  systemDefaultLabel,
  useAvDevices,
  type AvDeviceList,
} from '@/features/av/devices'
import { openMicrophone } from '@/features/av/microphone'
import { aiNoiseSupported } from '@/features/av/noise'
import { setAvPreference, useAvPreferences, type AvKind } from '@/features/av/preferences'
import { useGroupCall } from '@/features/calls/group-session'
import { useCall } from '@/features/calls/session'
import { StreamVideo } from '@/features/calls/streams'
import { playTestTone, type Tone } from '@/features/calls/tones'
import { cn } from '@/lib/utils'
import { FieldSkeleton } from './field-skeleton'

/** 每隔多久取一次麦克风音量 */
const LEVEL_INTERVAL_MS = 100
/** 音量条的下限（dB），低于它显示为空 */
const LEVEL_FLOOR_DB = -60

type Access = 'granted' | 'denied' | 'unavailable'

const ACCESS_DESCRIPTIONS: Record<'mic' | 'camera', Record<Exclude<Access, 'granted'> | 'prompt', string>> = {
  mic: {
    prompt: 'Allow access to choose a microphone and check its level.',
    denied: 'Microphone access is blocked. Allow it in your browser’s site settings.',
    unavailable: 'No microphone was found.',
  },
  camera: {
    prompt: 'Allow access to choose a camera and preview it.',
    denied: 'Camera access is blocked. Allow it in your browser’s site settings.',
    unavailable: 'No camera was found.',
  },
}

/**
 * 音视频设备：本机的麦克风、扬声器、摄像头与 AI 降噪（本机设置，不同步），选中即生效。
 * 打开时不请求权限；授权之后只要开着这一页，麦克风音量与摄像头画面就一直在预览，离开就放掉
 */
export function AvSettings() {
  const list = useAvDevices()
  // 通话中不预览：手机上同时只能开一个麦克风、一个摄像头，会把通话里的挤掉
  const privateCall = useCall().phase
  const groupCall = useGroupCall().phase
  const inCall = privateCall !== 'idle' || groupCall !== 'idle'
  const speakers = speakerSupported && list.devices.speaker.length > 1
  if (!avDevicesSupported) {
    return (
      <div className="px-4 pb-4 md:p-0">
        <FieldDescription>This browser doesn’t support microphones or cameras.</FieldDescription>
      </div>
    )
  }
  if (!list.loaded) {
    return (
      <div className="px-4 pb-4 md:p-0">
        <FieldGroup>
          <FieldSkeleton lines={1}>
            <Skeleton variant="control" className="h-9 w-28" />
          </FieldSkeleton>
          {aiNoiseSupported && (
            <FieldSkeleton lines={2}>
              <Skeleton variant="control" className="h-[18.4px] w-8" />
            </FieldSkeleton>
          )}
          <FieldSkeleton lines={1}>
            <Skeleton variant="control" className="h-9 w-28" />
          </FieldSkeleton>
        </FieldGroup>
      </div>
    )
  }
  return (
    <div className="px-4 pb-4 md:p-0">
      <FieldGroup>
        <DeviceField kind="mic" access="mic" title="Microphone" list={list}>
          {!inCall && <MicLevel />}
        </DeviceField>
        {aiNoiseSupported && <AiNoiseField />}
        {speakers && <DeviceField kind="speaker" title="Speaker" list={list} action={<TestSpeaker />} />}
        <DeviceField kind="camera" access="camera" title="Camera" list={list}>
          {!inCall && <CameraPreview />}
        </DeviceField>
      </FieldGroup>
    </div>
  )
}

/** 一类设备的选择，action 并排在选择旁边，children 是下方的预览；需要授权的（麦克风、摄像头）没授权时换成授权按钮 */
function DeviceField({
  kind,
  access,
  title,
  list,
  action,
  children,
}: {
  kind: AvKind
  access?: 'mic' | 'camera'
  title: string
  list: AvDeviceList
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  const chosen = useAvPreferences()[kind]
  const [requesting, setRequesting] = useState(false)
  const [failed, setFailed] = useState<Exclude<Access, 'granted'> | null>(null)
  const id = `av-${kind}`

  if (access && !list.access[access]) {
    const request = async () => {
      setRequesting(true)
      const result = await requestAvAccess(access)
      setRequesting(false)
      setFailed(result === 'granted' ? null : result)
    }
    return (
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{ACCESS_DESCRIPTIONS[access][failed ?? 'prompt']}</FieldDescription>
        </FieldContent>
        <Button variant="outline" disabled={requesting} onClick={() => void request()}>
          {requesting && <Spinner data-icon="inline-start" />}
          Allow access
        </Button>
      </Field>
    )
  }

  const items = [
    { value: SYSTEM_DEFAULT, label: systemDefaultLabel(list, kind) },
    ...list.devices[kind].map((d) => ({ value: d.id, label: d.label })),
  ]
  const select = (
    <Select
      items={items}
      value={selectedValue(list, kind, chosen)}
      onValueChange={(value) => {
        if (value !== null) choose(kind, value)
      }}
    >
      <SelectTrigger id={id} className="min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <Field>
      <FieldLabel htmlFor={id}>{title}</FieldLabel>
      {action ? (
        <ButtonGroup>
          {select}
          {action}
        </ButtonGroup>
      ) : (
        select
      )}
      {children}
    </Field>
  )
}

function AiNoiseField() {
  const { aiNoise } = useAvPreferences()
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="av-ai-noise">AI noise suppression</FieldLabel>
        <FieldDescription>
          Filter out background noise like typing and fans in calls and voice messages. Uses a bit more battery.
        </FieldDescription>
      </FieldContent>
      <Switch id="av-ai-noise" checked={aiNoise} onCheckedChange={(on) => setAvPreference({ aiNoise: on })} />
    </Field>
  )
}

/** 选定麦克风的实时音量（开着 AI 降噪时是降噪后的），跟着选择与降噪开关换 */
function MicLevel() {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    let closed = false
    let release = () => {}
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    const buffer = new Float32Array(analyser.fftSize)
    let source: MediaStreamAudioSourceNode | null = null
    const listen = (track: MediaStreamTrack) => {
      source?.disconnect()
      source = context.createMediaStreamSource(new MediaStream([track]))
      source.connect(analyser)
      void context.resume().catch(() => {})
    }
    void openMicrophone({ follow: true })
      .then((mic) => {
        if (closed) return mic.close()
        mic.onTrack = listen
        listen(mic.track)
        release = () => mic.close()
      })
      .catch((e: unknown) => console.warn("couldn't preview the microphone", e))
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const v of buffer) sum += v * v
      const db = 10 * Math.log10(sum / buffer.length || 1e-10)
      setLevel(Math.max(0, Math.min(1, 1 - db / LEVEL_FLOOR_DB)))
    }, LEVEL_INTERVAL_MS)
    return () => {
      closed = true
      clearInterval(timer)
      release()
      void context.close().catch(() => {})
    }
  }, [])
  return <Progress size="sm" value={Math.round(level * 100)} aria-label="Microphone level" />
}

/** 在选定的扬声器上弹一句来电铃声 */
function TestSpeaker() {
  const [tone, setTone] = useState<Tone | null>(null)
  useEffect(() => () => tone?.stop(), [tone])
  return (
    <Button variant="outline" onClick={() => setTone(playTestTone())}>
      <Volume2Icon data-icon="inline-start" />
      Test
    </Button>
  )
}

/** 选定摄像头的画面，跟着选择换 */
function CameraPreview() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  useEffect(() => {
    let closed = false
    let release = () => {}
    void openCamera()
      .then((camera) => {
        if (closed) return camera.close()
        camera.onStream = setStream
        setStream(camera.stream)
        release = () => camera.close()
      })
      .catch((e: unknown) => console.warn("couldn't preview the camera", e))
    return () => {
      closed = true
      release()
    }
  }, [])
  return (
    <AspectRatio ratio={16 / 9}>
      {stream ? (
        <StreamVideo stream={stream} muted className={cn('size-full rounded-xl object-cover', isMirrored(stream) && '-scale-x-100')} />
      ) : (
        <Skeleton className="size-full" />
      )}
    </AspectRatio>
  )
}
