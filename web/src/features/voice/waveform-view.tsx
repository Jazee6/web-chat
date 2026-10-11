import { cn } from '@/lib/utils'

/** 波形：每个采样一根竖条，已播放的部分不透明 */
export function Waveform({ samples, progress, className }: { samples: number[]; progress: number; className?: string }) {
  const played = Math.round(progress * samples.length)
  return (
    <div className={cn('flex h-6 w-40 items-center gap-px', className)} aria-hidden>
      {samples.map((s, i) => (
        <span
          key={i}
          className={cn('h-[max(8%,calc(var(--level)*100%))] flex-1 rounded-full bg-current', i >= played && 'opacity-35')}
          style={{ '--level': s } as React.CSSProperties}
        />
      ))}
    </div>
  )
}
