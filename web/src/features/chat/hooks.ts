import { useEffect } from 'react'

import { closeNotifications } from '@/features/notifications/push'
import { usePageVisible } from '@/hooks/use-page-visible'
import { topics } from '@/sync/bridge'
import { setViewing } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'

export type GroupDialog = { title: string; status: 'member' | 'left' }

/** 标签页正在查看的会话：打开时同步该会话、刷新群成员，离开时注销；页面可见时关掉本机这个会话的通知 */
export function useViewChat(chatId: string, enabled = true) {
  const visible = usePageVisible()
  useEffect(() => {
    if (!enabled) return
    void setViewing(chatId)
    return () => void setViewing(null)
  }, [chatId, enabled])
  useEffect(() => {
    if (enabled && visible) void closeNotifications(chatId)
  }, [chatId, enabled, visible])
}

/** 本地的群组对话行；undefined 表示仍在加载，null 表示没有 */
export function useGroupDialog(chatId: string): GroupDialog | null | undefined {
  const rows = useLiveQuery<GroupDialog>("SELECT title, status FROM dialogs WHERE chat_id = ? AND kind = 'group'", [chatId], [
    topics.dialogs,
  ])
  return rows === undefined ? undefined : (rows[0] ?? null)
}
