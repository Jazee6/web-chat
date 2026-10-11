import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * 一行文字的占位：高度等于这行文字的行高，换成真实文字时不跳。
 * className 给出与真实文字相同的字号、行高（如 text-sm、text-lg）和宽度
 */
export function SkeletonText({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-[1lh] max-w-full items-center', className)}>
      <Skeleton className="h-[0.75lh] w-full" />
    </div>
  )
}
