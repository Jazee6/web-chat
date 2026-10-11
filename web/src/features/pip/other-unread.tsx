import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mutedSql } from '@/features/dialogs/dialog-state'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { returnToApp } from './pip'

/** 不计静音的对话，与角标一致 */
const OTHER_UNREAD_SQL = `SELECT coalesce(sum(max(top_seq - last_read_seq, 0)), 0) AS n FROM dialogs
  WHERE chat_id != ? AND NOT ${mutedSql('muted_until')}`

/** 画中画头部：其他会话的未读总数，点击回到主窗口；没有未读时不显示 */
export function OtherUnread({ chatId }: { chatId: string }) {
  const n = useLiveQuery<{ n: number }>(OTHER_UNREAD_SQL, [chatId], [topics.dialogs])?.[0]?.n ?? 0
  if (n === 0) return null
  return (
    <Button variant="ghost" size="sm" onClick={returnToApp}>
      <Badge>{n}</Badge>
      unread elsewhere
    </Button>
  )
}
