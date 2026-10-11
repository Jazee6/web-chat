// 各路由的组件：从地址里取出参数交给页面。不在首屏的页面按需加载（首屏是对话列表与会话页）
import { lazy, useCallback, useEffect } from 'react'
import { Outlet, lazyRouteComponent, useNavigate, useParams, useRouteContext, useSearch } from '@tanstack/react-router'

import { Toaster } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatPage } from '@/features/chat/chat-page'
import { AppLayout } from './app-layout'

const LoginPage = lazy(() => import('@/features/auth/login-page').then((m) => ({ default: m.LoginPage })))
// 会话里点进去的页面：加载完之后同步渲染（React.lazy 即使代码已取回，第一次渲染也要挂起一下），
// 换页的过渡才截得到新页面
const GroupInfoPage = lazyRouteComponent(() => import('@/features/groups/group-info'), 'GroupInfoPage')
const ProfilePage = lazyRouteComponent(() => import('@/features/contacts/profile-page'), 'ProfilePage')
const JoinPage = lazyRouteComponent(() => import('@/features/groups/join-page'), 'JoinPage')
const PipPage = lazy(() => import('@/features/pip/pip-page').then((m) => ({ default: m.PipPage })))
export const Share = lazy(() => import('@/features/share/share-page').then((m) => ({ default: m.SharePage })))

export function Root() {
  return (
    <TooltipProvider>
      <Toaster>
        <Outlet />
      </Toaster>
    </TooltipProvider>
  )
}

export function Login() {
  const { error } = useSearch({ from: '/login' })
  return <LoginPage error={error} />
}

export function App() {
  const { boot } = useRouteContext({ from: '/app' })
  // 首屏之后先把这些页面的代码取回来，免得第一次推入的是一片空白
  useEffect(() => {
    for (const page of [GroupInfoPage, ProfilePage, JoinPage]) void page.preload?.()
  }, [])
  return <AppLayout boot={boot} />
}

export function Chat() {
  const { chatId } = useParams({ from: '/app/c/$chatId' })
  const { m } = useSearch({ from: '/app/c/$chatId' })
  const navigate = useNavigate({ from: '/c/$chatId' })
  const onJumpHandled = useCallback(
    () => void navigate({ search: {}, replace: true, viewTransition: false }),
    [navigate],
  )
  return <ChatPage chatId={chatId} jumpTo={m} onJumpHandled={onJumpHandled} />
}

export function ChatInfo() {
  const { chatId } = useParams({ from: '/app/c/$chatId/info' })
  return <GroupInfoPage chatId={chatId} />
}

export function Profile() {
  const { userId } = useParams({ from: '/app/u/$userId' })
  return <ProfilePage key={userId} userId={userId} />
}

export function Join() {
  const { code } = useParams({ from: '/app/join/$code' })
  return <JoinPage key={code} code={code} />
}

export function Pip() {
  const { boot } = useRouteContext({ from: '/pip/$chatId' })
  const { chatId } = useParams({ from: '/pip/$chatId' })
  return <PipPage boot={boot} chatId={chatId} />
}
