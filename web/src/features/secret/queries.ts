// 秘密聊天的本地查询。见 docs/adr/0010-secret-chats-multi-device-mls.md
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'

/** 与这个人的秘密聊天（同时最多一个）；undefined 表示仍在加载，null 表示没有 */
export function useSecretChatWith(userId: string): string | null | undefined {
  const rows = useLiveQuery<{ chat_id: string }>(
    "SELECT chat_id FROM dialogs WHERE kind = 'secret' AND peer_id = ? AND status = 'member'",
    [userId],
    [topics.dialogs],
  )
  return rows === undefined ? undefined : (rows[0]?.chat_id ?? null)
}

/** 本地的秘密聊天对话行；undefined 表示仍在加载，null 表示没有（还没同步到，或已被删除） */
export function useSecretDialog(chatId: string): { chat_id: string } | null | undefined {
  const rows = useLiveQuery<{ chat_id: string }>("SELECT chat_id FROM dialogs WHERE chat_id = ? AND kind = 'secret'", [chatId], [
    topics.dialogs,
  ])
  return rows === undefined ? undefined : (rows[0] ?? null)
}

/** 本设备当前所在的纪元；还没加入时为 null，仍在加载为 undefined。纪元变了安全码可能跟着变 */
export function useSecretEpoch(chatId: string): number | null | undefined {
  const rows = useLiveQuery<{ epoch: number }>('SELECT epoch FROM secret_groups WHERE chat_id = ?', [chatId], [topics.secret(chatId)])
  return rows === undefined ? undefined : (rows[0]?.epoch ?? null)
}
