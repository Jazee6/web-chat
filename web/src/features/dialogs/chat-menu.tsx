import { useState } from 'react'
import { BellIcon, BellOffIcon, EllipsisVerticalIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteDialogAlert } from '@/features/groups/delete-dialog-button'
import { SafetyCodeDialog } from '@/features/secret/safety-code'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { MUTE_OPTIONS, mutedSql, setMuted } from './dialog-state'

/**
 * 会话标题栏的更多菜单：静音与取消静音；秘密聊天还有安全码与删除。
 * 还没有对话行（例如还没有消息的私聊）时不显示
 */
export function ChatMenu({ chatId }: { chatId: string }) {
  const rows = useLiveQuery<{ muted: number; kind: string; name: string | null }>(
    `SELECT ${mutedSql('d.muted_until')} AS muted, d.kind, coalesce(d.title, u.name) AS name
     FROM dialogs d LEFT JOIN people u ON u.id = d.peer_id WHERE d.chat_id = ?`,
    [chatId],
    [topics.dialogs, topics.users],
  )
  const [safetyCode, setSafetyCode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialog = rows?.[0]
  if (!dialog) return null
  const secret = dialog.kind === 'secret'
  const name = dialog.name ?? 'them'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
          <EllipsisVerticalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {secret && (
            <DropdownMenuItem onClick={() => setSafetyCode(true)}>
              <ShieldCheckIcon />
              Safety code
            </DropdownMenuItem>
          )}
          {dialog.muted === 1 ? (
            <DropdownMenuItem onClick={() => void setMuted(chatId, 0)}>
              <BellIcon />
              Unmute
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellOffIcon />
                Mute
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {MUTE_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.label} onClick={() => void setMuted(chatId, option.ms)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {secret && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete chat
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {secret && (
        <>
          <SafetyCodeDialog chatId={chatId} name={name} open={safetyCode} onOpenChange={setSafetyCode} />
          <DeleteDialogAlert chatId={chatId} title={name} secret open={confirmDelete} onOpenChange={setConfirmDelete} />
        </>
      )}
    </>
  )
}
