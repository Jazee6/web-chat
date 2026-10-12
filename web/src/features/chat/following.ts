// 正在贴底阅读的会话：页面在前台、停在最新一条处，新消息一到就读到。
// 未读数由序号相减得到，来消息时要等消息进入视口、上报已读后才归零；对话列表与角标不为它显示未读数，免得闪一下
import { useSyncExternalStore } from 'react'

let following: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setFollowing(chatId: string | null) {
  if (chatId === following) return
  following = chatId
  for (const listener of listeners) listener()
}

/** 不再贴底阅读这个会话；已经换成别的会话时不动 */
export function stopFollowing(chatId: string) {
  if (following === chatId) setFollowing(null)
}

/** 正在贴底阅读的会话；没有时为 null */
export function useFollowingChat(): string | null {
  return useSyncExternalStore(subscribe, () => following)
}
