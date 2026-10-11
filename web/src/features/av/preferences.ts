// 音视频设备的本机偏好：选定的麦克风、扬声器、摄像头与 AI 降噪开关。
// deviceId 按浏览器与来源生成，只能存在本机（localStorage），不同步；其他标签页与画中画小窗经 storage 事件跟上
import { useSyncExternalStore } from 'react'

export type AvKind = 'mic' | 'speaker' | 'camera'

/** 各类选定的 deviceId，null 为跟随系统默认 */
export type AvPreferences = Record<AvKind, string | null> & { aiNoise: boolean }

const KEY = 'web-chat:av'
const DEFAULTS: AvPreferences = { mic: null, speaker: null, camera: null, aiNoise: true }

const listeners = new Set<() => void>()
let cached: AvPreferences | null = null

function read(): AvPreferences {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AvPreferences>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

function changed() {
  cached = null
  for (const listener of listeners) listener()
}

addEventListener('storage', (e) => {
  if (e.key === KEY) changed()
})

export function avPreferences(): AvPreferences {
  return (cached ??= read())
}

export function setAvPreference(patch: Partial<AvPreferences>) {
  const next = { ...avPreferences(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存储不可用：只在本页生效
  }
  cached = next
  for (const listener of listeners) listener()
}

/** 订阅偏好的变化（本页设置的与其他页面经 storage 事件传来的） */
export function onAvPreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAvPreferences(): AvPreferences {
  return useSyncExternalStore(onAvPreferences, avPreferences)
}
