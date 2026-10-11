import { useId } from 'react'
import { PauseIcon, PlayIcon } from 'lucide-react'
import type { Voice } from 'shared/protocol'
import { formatDuration } from 'shared/text'

import { locale } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/me'
import { fadeOutMotion } from '@/features/chat/item-motion'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import type { OutboxVoice } from '@/sync/store'
import { useUploadProgress } from '@/sync/transient'
import { POSITION_FORMAT, isCurrent, play, seek, toggle, usePlayer, voiceTrack } from './player'
import { IS_UNPLAYED_SQL } from './unplayed'
import { decodeWaveform } from './waveform'
import { Waveform } from './waveform-view'

/**
 * 已发送的语音消息：播放按钮、波形与时长。正在播放器里的那条显示进度，可以在波形上拖动；
 * 别人发来、本设备还没听过的带一个小圆点
 */
export function VoiceMessage({ chatId, seq, senderId, voice }: { chatId: string; seq: number; senderId: string; voice: Voice }) {
  const me = useMe()
  const player = usePlayer()
  const current = isCurrent(player, chatId, seq)
  const unplayed =
    (useLiveQuery<{ unplayed: number }>(IS_UNPLAYED_SQL, [chatId, seq, me.id], [topics.chat(chatId)])?.length ?? 0) > 0
  const mine = senderId === me.id

  const onPlay = () => {
    if (current) {
      toggle()
      return
    }
    play(voiceTrack(chatId, seq, senderId, voice), me.id).catch(() =>
      toast.add({ type: 'error', title: "Couldn't play the voice message", description: 'Check your connection and try again.' }),
    )
  }

  return (
    <VoiceLayout
      mine={mine}
      waveform={voice.waveform}
      duration={voice.duration}
      position={current ? player.position : 0}
      onSeek={current && !player.loading ? seek : undefined}
      button={
        <Button
          variant={mine ? 'inverse' : 'default'}
          size="icon"
          aria-label={`${current && player.playing ? 'Pause' : 'Play'} voice message, ${formatDuration(voice.duration)}`}
          onClick={onPlay}
        >
          {current && player.loading ? <Spinner /> : current && player.playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
      }
    >
      <span className="tabular-nums">{formatDuration(current ? player.position : voice.duration)}</span>
      {unplayed && <Badge variant="dot" aria-label="Not played" />}
    </VoiceLayout>
  )
}

/** 发件箱里的语音消息：发送中把时长换成上传进度（还没开始上传或等服务端确认时为不定进度），发送失败的不显示 */
export function PendingVoice({ voice, randomId, failed }: { voice: OutboxVoice; randomId: number; failed: boolean }) {
  const uploaded = useUploadProgress(randomId)
  const progress = failed ? undefined : uploaded === undefined ? null : Math.round(uploaded * 100)
  return (
    <VoiceLayout
      mine
      waveform={voice.waveform}
      duration={voice.duration}
      position={0}
      button={
        <Button variant="inverse" size="icon" aria-label={`Play voice message, ${formatDuration(voice.duration)}`} disabled>
          {progress !== undefined ? <Spinner /> : <PlayIcon />}
        </Button>
      }
    >
      {progress !== undefined ? (
        <Progress ref={fadeOutMotion} value={progress} size="sm" aria-label="Uploading" className="w-24" />
      ) : (
        <span className="tabular-nums">{formatDuration(voice.duration)}</span>
      )}
    </VoiceLayout>
  )
}

function VoiceLayout({
  mine,
  waveform,
  duration,
  position,
  onSeek,
  button,
  children,
}: {
  mine: boolean
  waveform: string
  /** 时长与已播放的位置（秒） */
  duration: number
  position: number
  /** 只有正在播放器里的那条可以拖动 */
  onSeek?: (position: number) => void
  button: React.ReactNode
  children: React.ReactNode
}) {
  // 滑块的名字只能经 aria-labelledby 传到里面的 input
  const labelId = useId()
  return (
    <div className="flex items-center gap-3">
      {button}
      <div className="grid gap-1">
        <div className="relative">
          <Waveform samples={decodeWaveform(waveform)} progress={duration > 0 ? position / duration : 0} />
          <span id={labelId} className="sr-only">
            Playback position
          </span>
          {/* 值要给数组：单个数值时 Slider 会按 [min, max] 渲染出两个滑块 */}
          <Slider
            variant="overlay"
            aria-labelledby={labelId}
            min={0}
            max={duration}
            step={0.1}
            format={POSITION_FORMAT}
            locale={locale}
            value={[position]}
            disabled={!onSeek}
            onValueChange={(v) => onSeek?.(Array.isArray(v) ? v[0]! : v)}
          />
        </div>
        <div className={cn('flex items-center gap-1.5 text-xs', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {children}
        </div>
      </div>
    </div>
  )
}
