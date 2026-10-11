import { useState } from 'react'
import { MenuListSkeleton } from '@/components/menu-list-skeleton'
import { Link } from '@tanstack/react-router'
import { FileIcon, SearchIcon, XIcon } from 'lucide-react'
import { isGroupChatId, privateChatId } from 'shared/protocol'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { contactsQuery, type ContactRow } from '@/features/contacts/queries'
import { DIALOGS_FROM, DIALOGS_ORDER, DialogItem, type DialogRow } from '@/features/dialogs/dialog-list'
import { useUsers } from '@/hooks/use-users'
import { formatDialogDate } from '@/lib/format'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { Highlighted } from './highlighted'
import { LoadMore } from './load-more'
import { dialogNameFilter, messageSearch, type MessageHit } from './sql'

/** 消息结果每次加载的条数 */
const PAGE = 50

/** 对话列表顶部的搜索框：Esc 清空 */
export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        placeholder="Search"
        aria-label="Search chats and messages"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('')
        }}
      />
      {value !== '' && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onChange('')}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

/**
 * 全局搜索的结果，替换对话列表：名字匹配的对话、还没有对话的联系人，然后是本设备上匹配的消息（新的在前，滚到底加载更多）。
 * 关键词变化时由调用方换 key 重置分页
 */
export function GlobalSearchResults({ terms }: { terms: string[] }) {
  const [limit, setLimit] = useState(PAGE)
  const filter = dialogNameFilter(terms)
  const chats = useLiveQuery<DialogRow>(`${DIALOGS_FROM} WHERE ${filter.sql} ${DIALOGS_ORDER}`, filter.params, [
    topics.dialogs,
    topics.users,
    topics.drafts,
  ])
  const contactsSql = contactsQuery(terms, { withoutDialog: true })
  const contacts = useLiveQuery<ContactRow>(contactsSql.sql, contactsSql.params, [topics.dialogs, topics.users])
  const search = messageSearch(terms, { limit })
  const messages = useLiveQuery<MessageHit>(search.sql, search.params, [topics.messages, topics.dialogs, topics.users])
  // 加载更多会换一个查询：新结果到达前继续显示旧结果
  const [shown, setShown] = useState(messages)
  if (messages !== undefined && messages !== shown) setShown(messages)

  if (!chats || !contacts || !shown) {
    return (
      <MenuListSkeleton />
    )
  }

  if (chats.length === 0 && contacts.length === 0 && shown.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={2}>No results</EmptyTitle>
          <EmptyDescription>
            Only messages on this device are searched. To search older messages in a chat, open it and search there.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      {chats.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((row) => (
                <DialogItem key={row.chat_id} row={row} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      {contacts.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Contacts</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {contacts.map((contact) => (
                <ContactHitItem key={contact.id} contact={contact} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      {shown.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Messages on this device</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {shown.map((hit) => (
                <MessageHitItem key={`${hit.chat_id}:${hit.seq}`} hit={hit} terms={terms} />
              ))}
            </SidebarMenu>
            {shown.length >= limit && <LoadMore onVisible={() => setLimit(shown.length + PAGE)} />}
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}

/** 一个还没有对话的联系人：点击打开与他的私聊 */
function ContactHitItem({ contact }: { contact: ContactRow }) {
  const me = useMe()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        render={<Link to="/c/$chatId" params={{ chatId: privateChatId(me.id, contact.id) }} />}
        onClick={() => {
          if (isMobile) setOpenMobile(false)
        }}
      >
        <UserAvatar name={contact.name} image={contact.image} />
        <span className="truncate font-medium">{contact.name ?? ' '}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** 一条命中的消息：点击打开会话并定位到它 */
function MessageHitItem({ hit, terms }: { hit: MessageHit; terms: string[] }) {
  const me = useMe()
  const users = useUsers()
  const { isMobile, setOpenMobile } = useSidebar()
  // 群组里标出发送者，私聊只标出自己
  const sender = hit.sender_id === me.id ? 'You' : isGroupChatId(hit.chat_id) ? (users.get(hit.sender_id)?.name ?? null) : null

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        render={<Link to="/c/$chatId" params={{ chatId: hit.chat_id }} search={{ m: hit.seq }} />}
        onClick={() => {
          if (isMobile) setOpenMobile(false)
        }}
      >
        <UserAvatar name={hit.name} image={hit.image} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{hit.name ?? ' '}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatDialogDate(hit.date)}</span>
          </div>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {hit.kind === 'media' && <FileIcon className="size-3 shrink-0" />}
            {/* 发送者名字长时截断它自己，不把命中处挤出可见范围 */}
            {sender && <span className="max-w-1/3 shrink-0 truncate">{sender}:</span>}
            <span className="truncate">
              <Highlighted text={hit.body} terms={terms} />
            </span>
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
