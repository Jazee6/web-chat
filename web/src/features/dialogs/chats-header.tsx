import { Suspense, lazy, useState } from 'react'
import { ContactIcon, EllipsisIcon, LogOutIcon, PhoneIcon, SettingsIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarHeader, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { PlayerSlot } from '@/features/voice/player-bar'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { useSidebarPanel } from '@/features/contacts/panel-context'
import { signOut } from '@/features/auth/session'
import { SearchField } from '@/features/search/global-search'
import { topics } from '@/sync/bridge'
import { useOpened } from '@/hooks/use-opened'
import { useLiveQuery } from '@/sync/live-query'

const SettingsDialog = lazy(() => import('@/features/settings/settings-dialog').then((m) => ({ default: m.SettingsDialog })))

/**
 * 对话列表顶部：搜索框和「更多」菜单（身份、联系人、最近通话、设置、GitHub、退出登录）。
 * 移动端抽屉是全宽的，左侧多一个收起按钮
 */
export function ChatsHeader({ query, onQueryChange }: { query: string; onQueryChange: (query: string) => void }) {
  // 手机上对话列表占满主区，播放条也要放在这里；桌面端的播放条在主区的标题栏里
  const { isMobile } = useSidebar()
  return (
    <SidebarHeader variant="toolbar">
      <SidebarTrigger className="hidden in-data-[mobile=true]:inline-flex" />
      <SearchField value={query} onChange={onQueryChange} />
      {isMobile && <PlayerSlot compact />}
      <MoreMenu />
    </SidebarHeader>
  )
}

function MoreMenu() {
  const me = useMe()
  const { setPanel } = useSidebarPanel()
  const unsent = useLiveQuery<{ n: number }>('SELECT count(*) AS n FROM outbox', [], [topics.outbox])?.[0]?.n ?? 0
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsOpened = useOpened(settingsOpen)
  const [signingOut, setSigningOut] = useState(false)

  const doSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      setSigningOut(false)
      setConfirmOpen(false)
      toast.add({ type: 'error', title: "Couldn't sign out", description: 'Check your connection and try again.' })
    }
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} />}>
            <EllipsisIcon />
            <span className="sr-only">More</span>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="flex items-center gap-2">
                <UserAvatar name={me.name} image={me.image} />
                <div className="grid">
                  <span className="truncate font-medium text-foreground">{me.name}</span>
                  <span className="truncate">{me.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPanel('contacts')}>
            <ContactIcon />
            Contacts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPanel('calls')}>
            <PhoneIcon />
            Recent calls
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href="https://github.com/Jazee6/web-chat" target="_blank" rel="noreferrer" />}>
            <GithubIcon />
            GitHub
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onClick={() => {
              if (unsent > 0) setConfirmOpen(true)
              else void doSignOut()
            }}
          >
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {settingsOpened && (
        <Suspense>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsent === 1 ? '1 message hasn’t been sent yet.' : `${unsent} messages haven’t been sent yet.`} Signing out
              removes this device’s copy of your chats, and unsent messages will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={signingOut} onClick={() => void doSignOut()}>
              {signingOut && <Spinner data-icon="inline-start" />}
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// lucide 不再提供品牌图标，这里内联 GitHub 标志
function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3" />
    </svg>
  )
}
