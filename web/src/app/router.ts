// 路由（代码定义）。见 docs/architecture/07-client.md § 路由与页面
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import * as v from 'valibot'

import type { Boot } from '@/features/auth/session'
import { HomePage } from './home-page'
import { NotFoundPage } from './not-found-page'
import { viewTransition } from './page-transition'
import { App, Chat, ChatInfo, Join, Login, Pip, Profile, Root, Share } from './routes'

type RouterContext = { boot: Boot }

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Root })

const loginSearch = v.object({ error: v.optional(v.string()) })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search) => {
    const result = v.safeParse(loginSearch, search)
    return result.success ? result.output : {}
  },
  component: Login,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: App,
})

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
})

/** m：定位到这条消息（seq），会话页收到后从地址中去掉 */
const chatSearch = v.object({ m: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))) })

const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/c/$chatId',
  validateSearch: (search) => {
    const result = v.safeParse(chatSearch, search)
    return result.success ? result.output : {}
  },
  component: Chat,
})

const chatInfoRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/c/$chatId/info',
  component: ChatInfo,
})

/** 资料页：另一个用户 */
const profileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/u/$userId',
  component: Profile,
})

/** 邀请链接的落地页 */
const joinRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/join/$code',
  component: Join,
})

/** 系统分享面板的落地页：Service Worker 暂存分享内容后跳转到这里 */
const shareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/share',
  component: Share,
})

/** 画中画小窗里 iframe 加载的页面，见 features/pip/pip.ts */
const pipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pip/$chatId',
  component: Pip,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  pipRoute,
  appRoute.addChildren([homeRoute, chatRoute, chatInfoRoute, profileRoute, joinRoute, shareRoute]),
])

export function createAppRouter(boot: Boot) {
  return createRouter({
    routeTree,
    context: { boot },
    defaultViewTransition: viewTransition,
    defaultNotFoundComponent: NotFoundPage,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
