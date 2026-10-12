// 推送订阅：属于设备，由用户在本机开启或关闭。标签页取得订阅后交给同步 Worker，由它在每次连接后上报。
// 见 docs/architecture/04-realtime-and-fanout.md § Web Push
import { useSyncExternalStore } from 'react'
import type { PushSubscriptionKeys } from 'shared/protocol'
import { VAPID_PUBLIC_KEY } from '@/lib/deploy'
import { setPushSubscription } from '@/sync/client'

/** 用户在本机关闭了推送；权限仍是 granted，但不订阅 */
const OFF_KEY = 'web-chat:push-off'
/** 本机的开启通知提示已被关掉（每台设备关一次） */
const PROMPTED_KEY = 'web-chat:push-prompted'

/**
 * 本机的推送状态。unavailable：这次部署没有配置推送（没有 VAPID 公钥）；unsupported：浏览器不支持；
 * install：iOS 需要先添加到主屏幕；denied：权限被拒绝，只能在浏览器设置里恢复；off / on：本机关闭 / 开启
 */
export type PushState = 'unavailable' | 'unsupported' | 'install' | 'denied' | 'off' | 'on'

const listeners = new Set<() => void>()

/** 状态由各个 getSnapshot 当场读出（权限、localStorage），这里只通知重新读 */
function changed() {
  for (const listener of listeners) listener()
}

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // 存储不可用：本机开关不能持久
  }
}

/** iOS / iPadOS 上只有添加到主屏幕的网页应用才有推送 */
function needsInstall() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  return ios && !matchMedia('(display-mode: standalone)').matches
}

function pushState(): PushState {
  if (!VAPID_PUBLIC_KEY) return 'unavailable'
  if (!('PushManager' in window) || !('Notification' in window)) return needsInstall() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && !readFlag(OFF_KEY) ? 'on' : 'off'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 直接以状态本身为快照：React Compiler 会把与快照无关的 pushState() 调用缓存下来，状态变了也不重算
export function usePushState(): PushState {
  return useSyncExternalStore(subscribe, pushState)
}

function toBase64Url(buffer: ArrayBuffer | null) {
  const bytes = new Uint8Array(buffer ?? new ArrayBuffer(0))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toKeys(sub: PushSubscription): PushSubscriptionKeys {
  return { endpoint: sub.endpoint, p256dh: toBase64Url(sub.getKey('p256dh')), auth: toBase64Url(sub.getKey('auth')) }
}

const serverKey = () => Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

function sameServerKey(sub: PushSubscription) {
  const key = sub.options.applicationServerKey
  return key !== null && toBase64Url(key) === VAPID_PUBLIC_KEY
}

async function newSubscription(registration: ServiceWorkerRegistration) {
  // 先退掉旧的订阅，endpoint 随之更换
  await (await registration.pushManager.getSubscription())?.unsubscribe()
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey() })
}

/** 登录后启动时调用一次：同步本机订阅；用户在浏览器设置里改了通知权限时再同步一次 */
export function startPush() {
  if (!VAPID_PUBLIC_KEY || !('PushManager' in window)) return
  void syncPushInBackground()
  navigator.permissions
    .query({ name: 'notifications' })
    .then((status) =>
      status.addEventListener('change', () => {
        changed()
        void syncPushInBackground()
      }),
    )
    .catch(() => {})
}

/**
 * 没有用户在等结果，失败时只记一笔，下次启动再试。常见的是浏览器连不上它的推送服务
 * （AbortError: push service not available，例如访问不了 FCM 的网络、没有推送服务的 Chromium）
 */
function syncPushInBackground() {
  return syncPush().catch((e: unknown) => console.warn('push subscription sync failed', e))
}

/**
 * 本机开启时确保已订阅（权限已授予，不需要用户手势），否则退订，然后交给同步 Worker 上报。
 * 上报失败（离线）时同步 Worker 已记下，连上后再报，这里不必处理；下同
 */
async function syncPush() {
  const registration = await navigator.serviceWorker.ready
  let sub = await registration.pushManager.getSubscription()
  if (pushState() !== 'on') {
    await sub?.unsubscribe()
    return setPushSubscription(null).catch(() => {})
  }
  if (!sub || !sameServerKey(sub)) sub = await newSubscription(registration)
  return setPushSubscription(toKeys(sub)).catch(() => {})
}

/** 在本机开启推送；必须由用户点击直接调用（浏览器只在用户手势里弹出权限请求）。返回是否已开启 */
export async function enablePush(): Promise<boolean> {
  const permission = await Notification.requestPermission()
  writeFlag(OFF_KEY, false)
  changed()
  if (permission !== 'granted') return false
  const sub = await newSubscription(await navigator.serviceWorker.ready)
  // 离线时同步 Worker 先记下，连上后上报
  await setPushSubscription(toKeys(sub)).catch(() => {})
  return true
}

export async function disablePush() {
  writeFlag(OFF_KEY, true)
  changed()
  await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe()
  await setPushSubscription(null).catch(() => {})
}

/** 退出登录前：退掉本机的订阅并告知服务端，免得这个浏览器之后还收到本账号的通知。本机开关保持不变 */
export async function releasePush() {
  if (!('PushManager' in window)) return
  await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe()
  await setPushSubscription(null).catch(() => {})
}

/**
 * 本地库被清空时（退出登录、换了账号、本设备被移除）：关掉上一个账号的通知，退掉浏览器里的订阅。
 * 不必告知服务端：旧 endpoint 此后返回 410，服务端随之清除。否则换账号后同一个 endpoint 会上报给新账号，
 * 而旧账号的 session 若仍有效，它的消息还会推到这里
 */
export async function resetPushOnDevice() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  for (const n of await registration.getNotifications()) n.close()
  if ('PushManager' in window) await (await registration.pushManager.getSubscription())?.unsubscribe()
}

/** 每台设备提示开启通知，直到用户开启或点了不再提示 */
export function usePushPrompt() {
  return useSyncExternalStore(subscribe, showPushPrompt)
}

function showPushPrompt() {
  return pushState() === 'off' && Notification.permission === 'default' && !readFlag(PROMPTED_KEY)
}

export function dismissPushPrompt() {
  writeFlag(PROMPTED_KEY, true)
  changed()
}

/** 打开会话且页面可见时：关掉本机这个会话的通知 */
export async function closeNotifications(chatId: string) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  for (const n of (await registration?.getNotifications({ tag: chatId })) ?? []) n.close()
}
