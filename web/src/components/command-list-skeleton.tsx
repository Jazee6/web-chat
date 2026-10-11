import { SkeletonText } from '@/components/skeleton-text'
import { Skeleton } from '@/components/ui/skeleton'

const WIDTHS = ['w-32', 'w-24', 'w-40']

/** Command 里（小头像与名字的行）列表加载时的占位：与 CommandGroup、CommandItem 同样的内边距和行高 */
export function CommandListSkeleton() {
  return (
    <div className="py-1">
      {WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-2 px-3 py-2">
          <Skeleton variant="avatar" className="size-6 shrink-0" />
          <SkeletonText className={`text-sm ${width}`} />
        </div>
      ))}
    </div>
  )
}
