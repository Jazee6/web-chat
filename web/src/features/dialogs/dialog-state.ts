// 置顶对话与静音：对话列表的右键菜单与会话标题栏的菜单共用。见 CONTEXT.md「置顶对话」「静音」
import { MUTE_FOREVER } from 'shared/protocol'

import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { call } from '@/sync/client'

const HOUR_MS = 60 * 60 * 1000

/** 静音的可选时长；null 为永久 */
export const MUTE_OPTIONS: { label: string; ms: number | null }[] = [
  { label: 'For 1 hour', ms: HOUR_MS },
  { label: 'For 8 hours', ms: 8 * HOUR_MS },
  { label: 'For 1 day', ms: 24 * HOUR_MS },
  { label: 'For 7 days', ms: 7 * 24 * HOUR_MS },
  { label: 'Forever', ms: null },
]

/**
 * SQL 条件：此刻是否静音。到期不改本地库，查询时与当前时间比较；
 * 同步 Worker 在最近一次到期时通知 dialogs 主题，让查询重新执行
 */
export const mutedSql = (column: string) => `${column} > CAST(unixepoch('subsec') * 1000 AS INTEGER)`

export async function setPinned(chatId: string, pinned: boolean) {
  try {
    await call('updateDialog', { chatId, pinned })
  } catch (e) {
    toast.add({ type: 'error', title: pinned ? "Couldn't pin the chat" : "Couldn't unpin the chat", description: opErrorMessage(e, 'Try again.') })
  }
}

/** ms 为静音时长，null 为永久，0 为取消静音 */
export async function setMuted(chatId: string, ms: number | null) {
  const mutedUntil = ms === null ? MUTE_FOREVER : ms === 0 ? 0 : Date.now() + ms
  try {
    await call('updateDialog', { chatId, mutedUntil })
  } catch (e) {
    toast.add({ type: 'error', title: ms === 0 ? "Couldn't unmute the chat" : "Couldn't mute the chat", description: opErrorMessage(e, 'Try again.') })
  }
}
