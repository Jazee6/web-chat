import { useEffect, useState, type CSSProperties } from 'react'
import { Outlet } from '@tanstack/react-router'
import { MonitorOffIcon, WifiOffIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { MeContext } from '@/features/auth/me'
import { CallLayer } from '@/features/calls/call-layer'
import { signIn, type Boot } from '@/features/auth/session'
import { SidebarPanels } from '@/features/contacts/sidebar-panel'
import { useUnreadBadge } from '@/features/notifications/badge'
import { Splash } from './splash'
import { useConnectionStatus } from '@/sync/client'

/** 登录后的布局：左栏对话列表或联系人列表（桌面可完全收起，移动端为抽屉），右侧为当前页面 */
export function AppLayout({ boot }: { boot: Boot }) {
  if (!boot.me) {
    if (boot.reason === 'offline') return <Offline />
    return boot.reason === 'removed' ? <Removed /> : <RedirectToSignIn />
  }

  return (
    <MeContext value={boot.me}>
      <Notifications />
      <ConnectionBar />
      <CallLayer />
      <SidebarProvider style={{ '--sidebar-width': '18rem' } as CSSProperties}>
        <Sidebar>
          <SidebarPanels />
          {/* 只是鼠标拖拽区，键盘用标题栏的按钮；不再读出第二个同名按钮 */}
          <SidebarRail aria-hidden />
        </Sidebar>
        {/* 换页时只有右侧的页面参与过渡（index.css），侧栏不动 */}
        <SidebarInset className="[view-transition-name:page]">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </MeContext>
  )
}

/** 角标与 favicon 跟随未读总数 */
function Notifications() {
  useUnreadBadge()
  return null
}

/** 没连上服务器时，页面顶部显示一条不定进度条 */
function ConnectionBar() {
  const status = useConnectionStatus()
  if (status === 'online') return null
  return (
    <Progress
      value={null}
      size="xs"
      aria-label={status === 'connecting' ? 'Connecting' : 'Waiting for network'}
      className="fixed inset-x-0 top-0 z-50"
    />
  )
}

// 每次页面加载只发起一次登录：开发模式下 StrictMode 会把 effect 执行两次，
// 两次 signIn 各生成一个 OAuth state，回调时可能对不上（State mismatch）
let signInStarted = false

/** 没有独立的登录页：未登录时直接跳转到 IdP，跳转前保持启动画面 */
function RedirectToSignIn() {
  useEffect(() => {
    if (signInStarted) return
    signInStarted = true
    void signIn()
  }, [])
  return <Splash />
}

/** 本设备在其他设备上被移除：本地数据已清空，由用户决定是否重新登录 */
function Removed() {
  const [redirecting, setRedirecting] = useState(false)
  return (
    <Empty className="h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MonitorOffIcon />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={1}>This device was removed</EmptyTitle>
        <EmptyDescription>
          You were signed out from another device, and your chats were cleared from this one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true)
            signIn().catch(() => setRedirecting(false))
          }}
        >
          {redirecting && <Spinner data-icon="inline-start" />}
          Sign in again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function Offline() {
  return (
    <Empty className="h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WifiOffIcon />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={1}>You’re offline</EmptyTitle>
        <EmptyDescription>Connect to the internet to sign in.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => location.reload()}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}
