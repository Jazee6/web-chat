import { useState } from 'react'
import { MenuListSkeleton } from '@/components/menu-list-skeleton'
import { Link, useParams } from '@tanstack/react-router'
import { BellIcon, BellOffIcon, LockIcon, MessageCircleIcon, PinIcon, PinOffIcon, Trash2Icon } from 'lucide-react'
import type { ServiceAction } from 'shared/protocol'

import { Badge } from '@/components/ui/badge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { DeleteDialogAlert } from '@/features/groups/delete-dialog-button'
import { useListMotion } from '@/hooks/use-list-motion'
import { useUsers } from '@/hooks/use-users'
import { formatDialogDate } from '@/lib/format'
import { describeAction, describeMedia, describeRecall } from 'shared/text'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { MUTE_OPTIONS, mutedSql, setMuted, setPinned } from './dialog-state'

export type DialogRow = {
  chat_id: string
  kind: 'private' | 'group' | 'secret'
  status: 'member' | 'left'
  pinned: number
  /** 此刻是否静音（0 / 1） */
  muted: number
  /** 草稿的文字；没有草稿或只有回复目标时为 null */
  draft: string | null
  top_sender_id: string | null
  /** cipher：秘密聊天里还没解开的；sealed：解不开的 */
  top_kind: 'text' | 'album' | 'file' | 'voice' | 'sticker' | 'service' | 'recalled' | 'cipher' | 'sealed' | null
  /** 文本或文件名（还没解开时为密文，不显示） */
  top_text: string | null
  /** 相册的总项数与其中的视频数 */
  top_count: number | null
  top_videos: number | null
  /** 语音消息，或只有一个视频的相册的时长 */
  top_duration: number | null
  top_action: string | null
  top_date: number | null
  unread: number
  /** 有未读提及（0 / 1） */
  mentioned: number
  name: string | null
  image: string | null
}

// 群组显示群名，私聊显示对方资料（备注名优先）；未读数不存计数器，由序号相减得到（见 02 § 写入成本约定）。
// 后面可以接 WHERE（按会话名筛选时，别名 d、u 可用）
export const DIALOGS_FROM = `
  SELECT d.chat_id, d.kind, d.status, d.pinned_rank IS NOT NULL AS pinned, ${mutedSql('d.muted_until')} AS muted, dr.text AS draft,
    d.top_sender_id, d.top_kind, d.top_text, d.top_count, d.top_videos, d.top_duration, d.top_action, d.top_date,
    max(d.top_seq - d.last_read_seq, 0) AS unread,
    EXISTS (SELECT 1 FROM json_each(d.unread_mentions) WHERE value > d.last_read_seq) AS mentioned,
    coalesce(d.title, u.name) AS name, u.image
  FROM dialogs d LEFT JOIN people u ON u.id = d.peer_id LEFT JOIN drafts dr ON dr.chat_id = d.chat_id AND dr.text != ''`

/** 按最后一条消息的时间排序（服务端不保证跨会话顺序，见 03 § 顺序与一致性保证） */
export const DIALOGS_ORDER = 'ORDER BY d.top_date DESC'
/** 对话列表：置顶对话在最上面，后置顶的在前；搜索结果不受置顶影响，仍用 DIALOGS_ORDER */
const DIALOG_LIST_ORDER = 'ORDER BY d.pinned_rank DESC NULLS LAST, d.top_date DESC'

export function DialogList() {
  const listRef = useListMotion<HTMLUListElement>()
  const rows = useLiveQuery<DialogRow>(`${DIALOGS_FROM} ${DIALOG_LIST_ORDER}`, [], [topics.dialogs, topics.users, topics.drafts])

  if (!rows) {
    return (
      <MenuListSkeleton />
    )
  }

  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={2}>No chats yet</EmptyTitle>
          <EmptyDescription>Add contacts to start a chat or create a group.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu ref={listRef} className="relative">
          {rows.map((row) => (
            <DialogItem key={row.chat_id} row={row} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** 对话列表中的一项：点击打开会话，移动端同时收起抽屉；右键（触屏长按）置顶、静音，只读对话与秘密聊天还可以删除 */
export function DialogItem({ row }: { row: DialogRow }) {
  const me = useMe()
  const users = useUsers()
  const { chatId } = useParams({ strict: false })
  const { isMobile, setOpenMobile } = useSidebar()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deletable = row.status === 'left' || row.kind === 'secret'

  const preview = () => {
    if (row.top_sender_id === null) return null
    if (row.top_kind === 'recalled') return describeRecall(row.top_sender_id, me.id, users)
    if (row.top_kind === 'cipher' || row.top_kind === 'sealed') return 'Encrypted message'
    if (row.top_action !== null) {
      return describeAction(JSON.parse(row.top_action) as ServiceAction, row.top_sender_id, me.id, users)
    }
    // 群组里标出发送者，私聊只标出自己
    const sender =
      row.top_sender_id === me.id ? 'You' : row.kind === 'group' ? (users.get(row.top_sender_id)?.name ?? null) : null
    const text =
      row.top_kind === 'album'
        ? describeMedia({
            kind: 'album',
            count: row.top_count ?? 1,
            ...(row.top_videos !== null ? { videos: row.top_videos } : {}),
            ...(row.top_duration !== null ? { duration: row.top_duration } : {}),
          })
        : row.top_kind === 'file'
          ? describeMedia({ kind: 'file', name: row.top_text ?? '' })
          : row.top_kind === 'voice'
            ? describeMedia({ kind: 'voice', duration: row.top_duration ?? 0 })
            : row.top_kind === 'sticker'
              ? describeMedia({ kind: 'sticker' })
              : row.top_text
    return sender ? `${sender}: ${text}` : text
  }

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              isActive={row.chat_id === chatId}
              render={<Link to="/c/$chatId" params={{ chatId: row.chat_id }} />}
              onClick={() => {
                if (isMobile) setOpenMobile(false)
              }}
            />
          }
        >
          <UserAvatar name={row.name} image={row.image} />
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              {/* 基线取自名字：图标没有文字基线，排在最前面时这一行会比别的行低 */}
              <span className="flex min-w-0 items-baseline gap-1">
                {row.kind === 'secret' && <LockIcon className="size-3.5 shrink-0 self-center text-primary" aria-label="Secret chat" />}
                <span className="truncate font-medium">{row.name ?? ' '}</span>
                {row.muted === 1 && <BellOffIcon className="size-3.5 shrink-0 self-center text-muted-foreground" aria-label="Muted" />}
              </span>
              {row.top_date !== null && (
                <span className="shrink-0 text-xs text-muted-foreground">{formatDialogDate(row.top_date)}</span>
              )}
            </div>
            {/* 固定为徽标的高度：有没有未读数，标题都在同一位置 */}
            <div className="flex h-5 items-center justify-between gap-2">
              {row.draft !== null && row.chat_id !== chatId ? (
                <span className="truncate text-xs text-muted-foreground">
                  <span className="text-destructive">Draft:</span> {row.draft}
                </span>
              ) : (
                <span className="truncate text-xs text-muted-foreground">{preview()}</span>
              )}
              {row.unread > 0 ? (
                <span className="flex shrink-0 items-center gap-1">
                  {/* 提及即使在静音的对话里也醒目 */}
                  {row.mentioned === 1 && (
                    <Badge>
                      <span aria-hidden>@</span>
                      <span className="sr-only">Mentioned</span>
                    </Badge>
                  )}
                  <Badge variant={row.muted === 1 ? 'secondary' : 'default'}>
                    {row.unread}
                    <span className="sr-only"> unread</span>
                  </Badge>
                </span>
              ) : (
                row.pinned === 1 && <PinIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => void setPinned(row.chat_id, row.pinned !== 1)}>
            {row.pinned === 1 ? <PinOffIcon /> : <PinIcon />}
            {row.pinned === 1 ? 'Unpin' : 'Pin'}
          </ContextMenuItem>
          {row.muted === 1 ? (
            <ContextMenuItem onClick={() => void setMuted(row.chat_id, 0)}>
              <BellIcon />
              Unmute
            </ContextMenuItem>
          ) : (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <BellOffIcon />
                Mute
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {MUTE_OPTIONS.map((option) => (
                  <ContextMenuItem key={option.label} onClick={() => void setMuted(row.chat_id, option.ms)}>
                    {option.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {deletable && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete chat
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {deletable && (
        <DeleteDialogAlert
          chatId={row.chat_id}
          title={row.name ?? 'this chat'}
          secret={row.kind === 'secret'}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
        />
      )}
    </SidebarMenuItem>
  )
}
