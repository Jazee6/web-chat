// Service Worker 入口：应用外壳缓存、媒体缓存、推送通知与分享目标。见 docs/architecture/07-client.md
// 构建产物固定为 /sw.js；开发时由 vite.config.ts 把 /sw.js 映射到本文件
import type { PushPayload } from 'shared/protocol'
import { matchMedia, putMedia } from '@/features/media/cache'
import { MEDIA_ORIGIN } from '@/lib/deploy'
import { isVideoUrl } from '@/features/media/video-url'
import { isVoiceUrl } from '@/features/voice/voice-url'
import { stashShare } from '@/features/share/stash'

declare const self: ServiceWorkerGlobalScope

type Build = { version: string; files: string[] }

/**
 * 本次构建的外壳文件清单，由 vite.config.ts 的 swBuild 插件在构建产物开头定义。
 * 开发时不存在：不预缓存资源，只缓存首页用于导航回退
 */
declare const __SW_BUILD__: Build | undefined
const build: Build = typeof __SW_BUILD__ === 'undefined' ? { version: 'dev', files: [] } : __SW_BUILD__

const SHELL_PREFIX = 'shell-'
const SHELL = SHELL_PREFIX + build.version
/** SPA 的所有路由都返回同一个 index.html。不用 /index.html 作键：它会被重定向到 /，重定向过的响应不能用于导航 */
const INDEX = '/'
/** 导航网络优先：超过这个时间还没有响应就先用缓存的外壳 */
const NAV_TIMEOUT_MS = 3000

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      await cache.addAll([INDEX, ...build.files])
      // 导航网络优先、资源带哈希，新旧版本不会混用同一份缓存，所以新 SW 立即接管
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== SHELL).map((n) => caches.delete(n)))
      // 导航预加载：SW 启动的同时就发出导航请求，网络优先不必等 SW 启动
      await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share') {
    return e.respondWith(receiveShare(req))
  }
  if (req.method !== 'GET') return
  // 视频不缓存：<video> 用 Range 请求边下边播，直接交给浏览器
  if (url.origin === MEDIA_ORIGIN) return isVideoUrl(req.url) ? undefined : e.respondWith(media(e))
  if (url.origin !== self.location.origin || url.pathname === '/ws') return
  // API 不经过缓存。但 OAuth 回调这类导航已经由导航预加载发出过一次：不调用 respondWith 时浏览器会丢弃预加载
  // 再请求一次，回调的 state 被预加载那次消费掉，后一次就报 state_mismatch
  if (url.pathname.startsWith('/api/')) {
    if (req.mode === 'navigate') e.respondWith(preloadOrFetch(e))
    return
  }
  if (req.mode === 'navigate') e.respondWith(navigate(e))
  else if (url.pathname.startsWith('/assets/')) e.respondWith(fromCache(req))
})

/** 导航请求优先用预加载的响应，没有预加载（SW 还没激活、预加载未启用）才自己请求 */
async function preloadOrFetch(e: FetchEvent): Promise<Response> {
  return ((await e.preloadResponse) as Response | undefined) ?? fetch(e.request)
}

/** 网络优先；离线或超时时用缓存的外壳。缓存里没有外壳时只能等网络 */
async function navigate(e: FetchEvent): Promise<Response> {
  const network = preloadOrFetch(e)
  // 超时先返回缓存时，预加载请求仍要等它结束，否则浏览器会取消它并报警告
  e.waitUntil(network.catch(() => null))
  const timeout = new Promise<null>((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null))
  const first = await Promise.race([network.catch(() => null), timeout])
  if (first) return first
  return (await caches.match(INDEX, { cacheName: SHELL })) ?? network
}

/**
 * 媒体对象写入后不再修改：缓存优先。只存图片（<img> 的请求，含视频的封面）与语音消息的录音（播放器整个取回），
 * 视频不经过这里，文件下载走网络；
 * 两者都以 CORS 方式加载，缓存的是普通响应，下载已缓存的图片、离线播放听过的语音都能直接用
 */
async function media(e: FetchEvent): Promise<Response> {
  const hit = await matchMedia(e.request.url).catch(() => undefined)
  if (hit) return hit
  const res = await fetch(e.request)
  const cacheable = e.request.destination === 'image' || isVoiceUrl(e.request.url)
  if (cacheable && res.status === 200 && res.type === 'cors') {
    e.waitUntil(putMedia(e.request.url, res.clone()).catch(() => {}))
  }
  return res
}

/** 系统分享面板提交的内容：暂存后跳转到 /share 页面选会话（303 让浏览器改用 GET） */
async function receiveShare(req: Request): Promise<Response> {
  await stashShare(await req.formData()).catch(() => {})
  return Response.redirect('/share', 303)
}

/** 带哈希的资源内容不变：缓存优先，未预缓存的（开发或旧版本）走网络 */
async function fromCache(req: Request): Promise<Response> {
  return (await caches.match(req, { cacheName: SHELL })) ?? fetch(req)
}

// ---------- 推送通知 ----------
// 见 docs/architecture/04-realtime-and-fanout.md § Web Push

/** TypeScript 的 lib 里没有 renotify（Safari 不支持，会忽略） */
type ChatNotificationOptions = NotificationOptions & { renotify?: boolean }

/**
 * 每次推送都必须显示通知（userVisibleOnly）。每个会话一条，新消息替换并重新提醒，撤回与编辑静默替换。
 * 来电的通知一直显示到被处理，通话记录到了用同一个 tag 替换它；点开后应用连上服务器即显示来电
 */
self.addEventListener('push', (e) => {
  const payload = e.data?.json() as PushPayload | undefined
  if (!payload) return
  const options: ChatNotificationOptions = {
    body: payload.body,
    tag: payload.chat_id,
    icon: '/icons/icon-192.png',
    data: { chat_id: payload.chat_id },
    silent: payload.silent,
    renotify: !payload.silent,
    requireInteraction: payload.ring === true,
  }
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      // 应用关闭时角标只能在这里更新；Firefox 不支持
      'setAppBadge' in navigator ? navigator.setAppBadge(payload.badge).catch(() => {}) : null,
    ]),
  )
})

/** 点击通知：有打开的窗口就聚焦过去，由页面内路由打开会话；没有就新开一个 */
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const chatId = (e.notification.data as { chat_id?: string } | null)?.chat_id
  e.waitUntil(
    (async () => {
      // 画中画小窗本身（about:blank）和其中嵌套的 iframe 都不能拿来打开会话
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(
        (w) => w.frameType !== 'nested' && new URL(w.url).origin === self.location.origin,
      )
      const client = windows.find((w) => w.focused) ?? windows[0]
      if (!client) {
        await self.clients.openWindow(chatId ? `/c/${encodeURIComponent(chatId)}` : '/')
        return
      }
      await client.focus()
      if (chatId) client.postMessage({ k: 'open-chat', chat_id: chatId })
    })(),
  )
})
