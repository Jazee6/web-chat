import { Suspense, lazy, useState } from 'react'
import { MessageCirclePlusIcon, SquarePenIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSidebarPanel } from '@/features/contacts/panel-context'
import { useOpened } from '@/hooks/use-opened'

const NewGroup = lazy(() => import('@/features/groups/new-group').then((m) => ({ default: m.NewGroup })))

/**
 * 对话列表右下角的悬浮按钮：新建私聊（切到联系人列表，从联系人发起）/ 群组。
 * hidden 时滑出，菜单打开期间始终显示
 */
export function NewButton({ hidden }: { hidden: boolean }) {
  const { setPanel } = useSidebarPanel()
  const [menuOpen, setMenuOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const groupOpened = useOpened(groupOpen)

  return (
    <>
      <div
        data-active={!hidden || menuOpen}
        className="absolute right-4 bottom-4 transition duration-standard ease-enter data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=false]:duration-fast data-[active=false]:ease-exit motion-safe:data-[active=false]:translate-y-full motion-safe:data-[active=false]:scale-95"
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={<Button size="icon-lg" aria-label="New" />}>
            <SquarePenIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            <DropdownMenuItem onClick={() => setPanel('contacts')}>
              <MessageCirclePlusIcon />
              New chat
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupOpen(true)}>
              <UsersIcon />
              New group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {groupOpened && (
        <Suspense>
          <NewGroup open={groupOpen} onOpenChange={setGroupOpen} />
        </Suspense>
      )}
    </>
  )
}
