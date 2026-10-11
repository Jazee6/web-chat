// 标签页侧的瞬时状态：私聊对象的在线状态、正在输入、媒体上传进度。只在内存里，由同步 Worker 广播过来。
// 见 docs/architecture/04-realtime-and-fanout.md § 输入中、在线状态
import { useCallback, useSyncExternalStore } from 'react'
import { TYPING_TTL_MS, type Presence, type TypingAction } from 'shared/protocol'

import { blockReload } from '@/lib/reload'

const presence = new Map<string, Presence>()
/** 会话里正在输入的一个用户：打字或录音 */
export type Typist = { user_id: string; action: TypingAction }
/** 会话 → 正在输入的用户 → 动作与过期时间 */
const typing = new Map<string, Map<string, { action: TypingAction; expires: number }>>()
/** 每个会话正在输入的用户列表；只在变化时换新数组，供 useSyncExternalStore 比较 */
const typingSnapshot = new Map<string, Typist[]>()
/** 发件箱里的媒体消息 → 上传进度（0–1） */
const uploads = new Map<number, number>()
// 上传中不重载页面（发布了新版本时）：重载后要从头再传
blockReload(() => uploads.size > 0)
const listeners = new Set<() => void>()
const NONE: Typist[] = []

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyPresence(users: { user_id: string; presence: Presence }[]) {
  for (const u of users) presence.set(u.user_id, u.presence)
  notify()
}

/** action 为 null 表示对方已发出消息，输入中随之结束 */
export function applyTyping(chatId: string, userId: string, action: TypingAction | null) {
  let users = typing.get(chatId)
  if (!users) typing.set(chatId, (users = new Map()))
  if (action === null) {
    if (!users.delete(userId)) return
  } else {
    users.set(userId, { action, expires: Date.now() + TYPING_TTL_MS })
    setTimeout(() => expire(chatId), TYPING_TTL_MS)
  }
  refresh(chatId)
}

function expire(chatId: string) {
  const users = typing.get(chatId)
  if (!users) return
  const now = Date.now()
  let changed = false
  for (const [id, { expires }] of users) {
    if (expires <= now) {
      users.delete(id)
      changed = true
    }
  }
  if (changed) refresh(chatId)
}

function refresh(chatId: string) {
  const users = [...(typing.get(chatId) ?? [])].map(([user_id, { action }]) => ({ user_id, action }))
  if (users.length === 0) typingSnapshot.delete(chatId)
  else typingSnapshot.set(chatId, users)
  notify()
}

export function applyUpload(randomId: number, progress: number | null) {
  if (progress === null) uploads.delete(randomId)
  else uploads.set(randomId, progress)
  notify()
}

/** 媒体消息的上传进度（0–1）；undefined 表示没有在上传 */
export function useUploadProgress(randomId: number | null): number | undefined {
  return useSyncExternalStore(subscribe, () => (randomId === null ? undefined : uploads.get(randomId)))
}

/** 私聊对象的在线状态；undefined 表示还不知道 */
export function usePresence(userId: string): Presence | undefined {
  return useSyncExternalStore(subscribe, () => presence.get(userId))
}

/** 会话里正在输入的其他用户 */
export function useTyping(chatId: string): Typist[] {
  const get = useCallback(() => typingSnapshot.get(chatId) ?? NONE, [chatId])
  return useSyncExternalStore(subscribe, get)
}
