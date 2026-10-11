import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import './index.css'
import { createAppRouter } from './app/router'
import { Splash } from './app/splash'
import { bootstrap } from './features/auth/session'
import { startGroupCalls } from './features/calls/group-session'
import { startCalls } from './features/calls/session'
import { startPush } from './features/notifications/push'
import { inPip } from './features/pip/pip'
import { requestReload } from './lib/reload'
import { startLeaderElection } from './sync/client'

// 离线外壳与推送通知（以后还有媒体缓存）。开发时 /sw.js 由 vite.config.ts 映射到 src/sw/index.ts
navigator.serviceWorker
  .register('/sw.js', { type: 'module', updateViaCache: 'none' })
  .catch((e: unknown) => console.warn('service worker registration failed', e))
// 发布新版本后，旧页面要按需加载的代码块已经不在了
addEventListener('vite:preloadError', () => requestReload())

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <Splash />
  </StrictMode>,
)

const boot = await bootstrap()
if (boot.me) {
  startLeaderElection(boot.me.id)
  // 画中画小窗里的页面只是又一个标签页，推送由主窗口负责
  if (!inPip) startPush()
  startCalls(boot.me.id)
  startGroupCalls(boot.me.id)
}
// 防止本地库被浏览器在存储压力下清理
void navigator.storage.persist()

const router = createAppRouter(boot)
// 点击通知时，已打开的窗口由 Service Worker 聚焦后告知要打开的会话
navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ k: string; chat_id: string }>) => {
  if (e.data.k === 'open-chat') void router.navigate({ to: '/c/$chatId', params: { chatId: e.data.chat_id } })
})

root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
