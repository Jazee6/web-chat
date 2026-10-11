// 角标与 favicon：应用打开时按本地库的未读总数更新；应用关闭时由 Service Worker 按推送载荷更新。
// 见 docs/architecture/04-realtime-and-fanout.md § 角标
import { useEffect } from 'react'
import { mutedSql } from '@/features/dialogs/dialog-state'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'

/** 与服务端 UserDO 的算法一致：所有未静音对话（含只读对话）的未读数之和；删除的对话本地已不存在 */
const UNREAD_SQL = `SELECT coalesce(sum(max(top_seq - last_read_seq, 0)), 0) AS n FROM dialogs WHERE NOT ${mutedSql('muted_until')}`

function setFavicon(unread: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = unread ? '/favicon-unread.svg' : '/favicon.svg'
}

/** 退出登录或本地库被清空时：角标与 favicon 回到没有未读的状态 */
export function clearBadge() {
  setFavicon(false)
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {})
}

export function useUnreadBadge() {
  const rows = useLiveQuery<{ n: number }>(UNREAD_SQL, [], [topics.dialogs])
  const unread = rows?.[0]?.n
  useEffect(() => {
    if (unread === undefined) return
    setFavicon(unread > 0)
    // Safari 把 0 当作清除，Chromium 的 0 也不显示；Firefox 不支持角标
    if ('setAppBadge' in navigator) navigator.setAppBadge(unread).catch(() => {})
  }, [unread])
}
