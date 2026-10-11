import type { ReactNode } from 'react'
import { ArrowUpIcon, Trash2Icon } from 'lucide-react'
import { formatDuration } from 'shared/text'

import { Badge } from '@/components/ui/badge'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { RecorderState } from './recorder'
import { Waveform } from './waveform-view'

/** 实时音量（RMS）通常很小，放大后再画，说话时才看得出起伏 */
const LIVE_GAIN = 3
/** 实时波形的竖条数：不足时左边补零，竖条宽度不随录音变化 */
const LIVE_BARS = 48

const liveSamples = (levels: number[]) => [
  ...new Array<number>(Math.max(0, LIVE_BARS - levels.length)).fill(0),
  ...levels.slice(-LIVE_BARS).map((l) => Math.min(1, l * LIVE_GAIN)),
]

/**
 * 录音条：录音时取代输入框，左边删除，右边发送，中间是计时与实时波形。
 * 被系统打断时停下，显示已录的时长，等用户选择发送或删除。top 为回复目标条
 */
export function RecordBar({
  state,
  top,
  onDelete,
  onSend,
}: {
  state: Exclude<RecorderState, { status: 'idle' }>
  top: ReactNode
  onDelete: () => void
  onSend: () => void
}) {
  const remove = (
    <InputGroupButton size="icon-sm" aria-label="Delete recording" onClick={onDelete}>
      <Trash2Icon />
    </InputGroupButton>
  )
  const send = (
    <InputGroupButton
      variant="default"
      size="icon-sm"
      className="ml-auto"
      aria-label="Send voice message"
      disabled={state.status === 'starting'}
      onClick={onSend}
    >
      {state.status === 'starting' ? <Spinner /> : <ArrowUpIcon />}
    </InputGroupButton>
  )
  const body = (
    // 有回复目标时输入框组是纵向排列：自己撑满一行（否则实时波形分不到宽度），左右与回复目标条对齐；
    // 否则在两侧按钮之间垂直居中，与输入框里的文字同高
    <div className={cn('flex min-h-9 min-w-0 flex-1 items-center gap-2', top ? 'self-stretch px-3' : 'px-2')}>
      {state.status === 'interrupted' ? (
        <InputGroupText>Recording stopped · {formatDuration(state.take.duration)}</InputGroupText>
      ) : (
        <>
          <Badge variant="recording" aria-hidden />
          <InputGroupText>
            <span className="tabular-nums">{formatDuration(state.status === 'recording' ? state.elapsed / 1000 : 0)}</span>
          </InputGroupText>
          <Waveform
            samples={liveSamples(state.status === 'recording' ? state.levels : [])}
            progress={1}
            className="w-auto min-w-0 flex-1"
          />
        </>
      )}
    </div>
  )

  return (
    <InputGroup variant="textarea">
      {top ? (
        <>
          <InputGroupAddon align="block-start" className="flex-col items-stretch">
            {top}
          </InputGroupAddon>
          {body}
          <InputGroupAddon align="block-end">
            {remove}
            {send}
          </InputGroupAddon>
        </>
      ) : (
        <>
          <InputGroupAddon align="inline-start">{remove}</InputGroupAddon>
          {body}
          <InputGroupAddon align="inline-end">{send}</InputGroupAddon>
        </>
      )}
    </InputGroup>
  )
}
