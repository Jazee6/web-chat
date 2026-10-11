import { SkeletonText } from '@/components/skeleton-text'
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** 每行名字与第二行的宽度，参差一些 */
const WIDTHS = [
  ['w-2/5', 'w-3/4'],
  ['w-1/3', 'w-2/3'],
  ['w-1/2', 'w-4/5'],
  ['w-1/4', 'w-3/5'],
]

/**
 * 侧栏列表加载时的占位：与 size="lg" 的行（头像、名字与第二行）同样的高度和位置。
 * 第二行随列表：对话列表固定为徽标的高度（h-5），最近通话是一行小字，联系人通常没有第二行
 */
export function MenuListSkeleton({ rows = 'dialog' }: { rows?: 'dialog' | 'call' | 'contact' }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {WIDTHS.map(([name, second], i) => (
            <SidebarMenuItem key={i}>
              <div className="flex h-14 items-center gap-2 px-3">
                <Skeleton variant="avatar" className="size-8 shrink-0" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <SkeletonText className={cn('text-sm', name)} />
                  {rows !== 'contact' && <SkeletonText className={cn('text-xs', rows === 'dialog' && 'h-5', second)} />}
                </div>
              </div>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
