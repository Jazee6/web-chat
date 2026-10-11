// 通话界面共用的小组件：视频、声音与带提示的按钮
import { useEffect, useRef } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSpeakerOutput } from '@/features/av/devices'
import { cn } from '@/lib/utils'

export function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} aria-label={label} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function StreamVideo({
  stream,
  muted = false,
  className,
  ref,
}: {
  stream: MediaStream
  muted?: boolean
  className?: string
  ref?: React.Ref<HTMLVideoElement>
}) {
  const own = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (own.current && own.current.srcObject !== stream) own.current.srcObject = stream
  }, [stream])
  return (
    <video
      ref={(el) => {
        own.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      autoPlay
      playsInline
      muted={muted}
      className={cn('bg-black', className)}
    />
  )
}

/** 别人的声音，从选定的扬声器出来 */
export function StreamAudio({ stream }: { stream: MediaStream }) {
  const el = useRef<HTMLAudioElement>(null)
  useSpeakerOutput(el)
  useEffect(() => {
    if (el.current && el.current.srcObject !== stream) el.current.srcObject = stream
  }, [stream])
  return <audio ref={el} autoPlay />
}
