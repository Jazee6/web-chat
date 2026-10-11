import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, ContactIcon, InfoIcon, SearchIcon, UserPlusIcon, XIcon } from 'lucide-react'
import { privateChatId } from 'shared/protocol'

import { Badge } from '@/components/ui/badge'
import { MenuListSkeleton } from '@/components/menu-list-skeleton'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { searchTerms } from '@/features/search/sql'
import { useListMotion } from '@/hooks/use-list-motion'
import { AddContact } from './add-contact'
import { useSidebarPanel } from './panel-context'
import { useContacts, type ContactRow } from './queries'

/** 侧栏里的联系人列表：筛选、添加；点一个人打开与他的私聊，并回到对话列表 */
export function ContactsPanel() {
  const { setPanel } = useSidebarPanel()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const terms = searchTerms(query)
  const listRef = useListMotion<HTMLUListElement>(query)
  const contacts = useContacts(terms)

  return (
    <>
      <SidebarHeader variant="toolbar">
        <SidebarTrigger className="hidden in-data-[mobile=true]:inline-flex" />
        <Button variant="ghost" size="icon" aria-label="Back to chats" onClick={() => setPanel('chats')}>
          <ArrowLeftIcon />
        </Button>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            placeholder="Search contacts"
            aria-label="Search contacts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query !== '' && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery('')}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => setAdding(true)} />}>
            <UserPlusIcon />
            <span className="sr-only">Add contact</span>
          </TooltipTrigger>
          <TooltipContent>Add contact</TooltipContent>
        </Tooltip>
      </SidebarHeader>
      <SidebarContent>
        {contacts === undefined ? (
          <MenuListSkeleton rows="contact" />
        ) : contacts.length === 0 ? (
          terms.length > 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle role="heading" aria-level={2}>No contacts found</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ContactIcon />
                </EmptyMedia>
                <EmptyTitle role="heading" aria-level={2}>No contacts yet</EmptyTitle>
                <EmptyDescription>Add people by their email addresses to chat with them or add them to groups.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setAdding(true)}>
                  <UserPlusIcon data-icon="inline-start" />
                  Add contact
                </Button>
              </EmptyContent>
            </Empty>
          )
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu ref={listRef} className="relative">
                {contacts.map((contact) => (
                  <ContactItem key={contact.id} contact={contact} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <AddContact open={adding} onOpenChange={setAdding} />
    </>
  )
}

function ContactItem({ contact }: { contact: ContactRow }) {
  const me = useMe()
  const navigate = useNavigate()
  const { setPanel } = useSidebarPanel()
  const { isMobile, setOpenMobile } = useSidebar()
  const leave = () => {
    setPanel('chats')
    if (isMobile) setOpenMobile(false)
  }
  const aliased = contact.own_name !== null && contact.name !== contact.own_name

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        onClick={() => {
          leave()
          void navigate({ to: '/c/$chatId', params: { chatId: privateChatId(me.id, contact.id) } })
        }}
      >
        <UserAvatar name={contact.name} image={contact.image} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-medium">{contact.name ?? ' '}</span>
          {(aliased || contact.blocked === 1) && (
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {aliased && <span className="truncate">{contact.own_name}</span>}
              {contact.blocked === 1 && <Badge variant="secondary">Blocked</Badge>}
            </span>
          )}
        </div>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        aria-label="View profile"
        render={<Link to="/u/$userId" params={{ userId: contact.id }} />}
        onClick={leave}
      >
        <InfoIcon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  )
}
