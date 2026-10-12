import { Suspense, lazy, useState, type ReactNode } from 'react'
import { Link, useCanGoBack, useRouter, type LinkProps } from '@tanstack/react-router'
import { ArrowLeftIcon, LockIcon, MessageCircleOffIcon, PictureInPicture2Icon } from 'lucide-react'
import { chatPair, isGroupChatId, parseSecretChatId } from 'shared/protocol'

import { SkeletonText } from '@/components/skeleton-text'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/user-avatar'
import { CallButton } from '@/features/calls/call-button'
import { GroupCallBanner, GroupCallButton } from '@/features/calls/group-call-bar'
import { GROUP_CALL_BANNER_HEIGHT, useGroupCallOf } from '@/features/calls/group-session'
import { Composer } from '@/features/composer/composer'
import { useMe } from '@/features/auth/me'
import { BlockedBar } from '@/features/contacts/blocked-bar'
import { ChatMenu } from '@/features/dialogs/chat-menu'
import { usePerson, useUserLookup } from '@/features/contacts/queries'
import { LeftDialogBar } from '@/features/groups/left-dialog-bar'
import { OtherUnread } from '@/features/pip/other-unread'
import { inPip, openPip, pipSupported } from '@/features/pip/pip'
import { useSecretDialog, useSecretEpoch } from '@/features/secret/queries'
import { PlayerSlot } from '@/features/voice/player-bar'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useUsers } from '@/hooks/use-users'
import { formatPresence } from '@/lib/format'
import { fadeInOutMotion } from '@/lib/presence'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { typingText } from '@/lib/typing-text'
import { usePresence, useTyping } from '@/sync/transient'
import type { ComposeTarget } from './compose'
import { useGroupDialog, useViewChat } from './hooks'
import { MessageList } from './message-list'

const ChatSearch = lazy(() => import('@/features/search/chat-search').then((m) => ({ default: m.ChatSearch })))

/** 定位到某条消息：jumpTo 为它的 seq，收到后调用 onJumpHandled */
type Jump = { jumpTo?: number; onJumpHandled?: () => void }

export function ChatPage({ chatId, ...jump }: { chatId: string } & Jump) {
  const me = useMe()
  const pair = chatPair(chatId)
  const peerId = pair?.find((id) => id !== me.id)
  const isGroup = isGroupChatId(chatId)
  const valid = isGroup || (pair?.includes(me.id) === true && peerId !== undefined)

  useViewChat(chatId, valid)

  if (!valid) return <ChatNotFound />
  if (isGroup) return <GroupChat key={chatId} chatId={chatId} {...jump} />
  if (parseSecretChatId(chatId)) return <SecretChat key={chatId} chatId={chatId} peerId={peerId!} {...jump} />
  return <PrivateChat key={chatId} chatId={chatId} peerId={peerId!} {...jump} />
}

/** 秘密聊天：对话行没有了（还没同步到，或被删除了）就是找不到 */
function SecretChat({ chatId, peerId, ...jump }: { chatId: string; peerId: string } & Jump) {
  const dialog = useSecretDialog(chatId)
  if (dialog === undefined) return null
  if (dialog === null) return <ChatNotFound />
  return <PrivateChat chatId={chatId} peerId={peerId} secret {...jump} />
}

/**
 * 私聊与秘密聊天。我拉黑了对方时，输入框换成解除拉黑的底栏，也不能回复；对方账号不存在时为找不到会话。
 * 秘密聊天不能通话、不能置顶消息
 */
function PrivateChat({ chatId, peerId, secret = false, ...jump }: { chatId: string; peerId: string; secret?: boolean } & Jump) {
  const person = usePerson(peerId)
  const peer = person?.name != null ? { ...person, name: person.name } : undefined
  const missing = useUserLookup(peerId, person !== undefined && person.name === null) === 'missing'
  const blocked = person?.blocked === true
  const [target, setTarget] = useState<ComposeTarget | null>(null)
  // 恢复草稿里的回复目标；用户已经选了别的目标就不动
  const restoreReply = (t: ComposeTarget) => setTarget((cur) => cur ?? t)
  const presence = usePresence(peerId)
  const typing = useTyping(chatId)
  useDocumentTitle(peer?.name)

  if (missing) return <ChatNotFound />

  return (
    <ChatLayout
      actions={
        <ChatActions chatId={chatId} search={!secret}>
          {!blocked && !secret && <CallButton chatId={chatId} peerId={peerId} person={person} />}
        </ChatActions>
      }
      header={
        peer ? (
          <HeaderLink to="/u/$userId" params={{ userId: peerId }}>
            <UserAvatar name={peer.name} image={peer.image} online={presence?.status === 'online'} />
            <div className="grid min-w-0">
              <h1 className="flex min-w-0 items-center gap-1">
                {secret && <LockIcon className="size-3.5 shrink-0 text-primary" aria-label="Secret chat" />}
                <span className="truncate text-sm font-medium">{peer.name}</span>
              </h1>
              {typing.length > 0 ? (
                <span className="truncate text-xs/4 text-muted-foreground shimmer">{typingText(typing, null)}</span>
              ) : presence ? (
                <span className="truncate text-xs/4 text-muted-foreground">
                  {formatPresence(presence)}
                </span>
              ) : null}
            </div>
          </HeaderLink>
        ) : (
          <HeaderSkeleton />
        )
      }
    >
      <MessageList
        chatId={chatId}
        isGroup={false}
        emptyText={
          secret ? 'Messages in this chat are end-to-end encrypted.' : peer ? `Say hello to ${peer.name}.` : 'Say hello.'
        }
        canPin={!blocked && !secret}
        onCompose={blocked ? undefined : setTarget}
        {...jump}
      />
      {blocked ? (
        <BlockedBar userId={peerId} name={peer?.name ?? null} />
      ) : (
        <>
          {secret && <JoiningBar chatId={chatId} />}
          <Composer chatId={chatId} target={target} onCancel={() => setTarget(null)} onRestoreReply={restoreReply} />
        </>
      )}
    </ChatLayout>
  )
}

function GroupChat({ chatId, ...jump }: { chatId: string } & Jump) {
  const me = useMe()
  const dialog = useGroupDialog(chatId)
  const owner =
    useLiveQuery<{ role: string }>('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, me.id], [
      topics.members(chatId),
    ])?.[0]?.role === 'owner'
  const count = useLiveQuery<{ n: number }>('SELECT count(*) AS n FROM chat_members WHERE chat_id = ?', [chatId], [
    topics.members(chatId),
  ])?.[0]?.n
  const [target, setTarget] = useState<ComposeTarget | null>(null)
  // 恢复草稿里的回复目标；用户已经选了别的目标就不动
  const restoreReply = (t: ComposeTarget) => setTarget((cur) => cur ?? t)
  const member = dialog?.status === 'member'
  const typing = useTyping(chatId)
  const users = useUsers()
  // 群组通话只在顶层窗口里进行；画中画里不显示横条与通话按钮
  const groupCall = useGroupCallOf(chatId)
  const banner = member && !inPip && groupCall !== null
  useDocumentTitle(dialog?.title)

  if (dialog === null) return <ChatNotFound />

  return (
    <ChatLayout
      actions={<ChatActions chatId={chatId}>{member && !inPip && <GroupCallButton chatId={chatId} />}</ChatActions>}
      header={
        dialog ? (
          <HeaderLink to="/c/$chatId/info" params={{ chatId }}>
            <UserAvatar name={dialog.title} image={null} />
            <div className="grid min-w-0">
              <h1 className="truncate text-sm font-medium">{dialog.title}</h1>
              {member && typing.length > 0 ? (
                <span className="truncate text-xs/4 text-muted-foreground shimmer">{typingText(typing, users)}</span>
              ) : member && count ? (
                <span className="truncate text-xs/4 text-muted-foreground">
                  {count === 1 ? '1 member' : `${count} members`}
                </span>
              ) : null}
            </div>
          </HeaderLink>
        ) : (
          <HeaderSkeleton />
        )
      }
    >
      <MessageList
        chatId={chatId}
        isGroup
        emptyText="No messages yet."
        canPin={member && owner}
        onCompose={member ? setTarget : undefined}
        topInset={banner ? GROUP_CALL_BANNER_HEIGHT : 0}
        {...jump}
      />
      {banner && <GroupCallBanner chatId={chatId} />}
      {member && <Composer chatId={chatId} target={target} onCancel={() => setTarget(null)} onRestoreReply={restoreReply} />}
      {dialog?.status === 'left' && <LeftDialogBar chatId={chatId} />}
    </ChatLayout>
  )
}


/** 秘密聊天里本设备还没加入：可以先写，加入后才发出去 */
function JoiningBar({ chatId }: { chatId: string }) {
  if (useSecretEpoch(chatId) !== null) return null
  return (
    <div ref={fadeInOutMotion} className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-3 text-sm text-muted-foreground">
      <Spinner />
      Setting up encryption on this device. Messages you send will go out once it’s ready.
    </div>
  )
}

/** 标题栏的占位：与 HeaderLink 里的头像、名字和第二行同样的位置 */
function HeaderSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Skeleton variant="avatar" className="size-8 shrink-0" />
      <div className="grid w-32 min-w-0">
        <SkeletonText className="w-24 text-sm" />
        <SkeletonText className="w-16 text-xs/4" />
      </div>
    </div>
  )
}

/** 标题栏：点进资料页或群组信息；画中画里只显示，不跳转 */
function HeaderLink(props: LinkProps & { children: ReactNode }) {
  if (inPip) return <div className="flex min-w-0 items-center gap-2">{props.children}</div>
  return <Link {...props} className="flex min-w-0 items-center gap-2" />
}

/** 标题栏右侧：呼叫（私聊）、画中画、会话内搜索（秘密聊天没有）与更多菜单；画中画里换成其他会话的未读数 */
function ChatActions({ chatId, search = true, children }: { chatId: string; search?: boolean; children?: ReactNode }) {
  if (inPip) return <OtherUnread chatId={chatId} />
  return (
    <>
      {children}
      {pipSupported && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => void openPip(chatId)} />}>
            <PictureInPicture2Icon />
            <span className="sr-only">Picture-in-picture</span>
          </TooltipTrigger>
          <TooltipContent>Picture-in-picture</TooltipContent>
        </Tooltip>
      )}
      {search && (
        <Suspense>
          <ChatSearch chatId={chatId} />
        </Suspense>
      )}
      <ChatMenu chatId={chatId} />
    </>
  )
}

/**
 * 标题栏最左边：手机上对话列表就是首页，像常见的聊天应用一样是返回箭头；桌面上收起、展开左栏。
 * 返回是后退一步（不新增历史，系统的返回手势不会又回到这个会话）；直接打开的换成首页
 */
function NavButton() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  if (!isMobile) return <SidebarTrigger />
  if (canGoBack) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
        <ArrowLeftIcon />
      </Button>
    )
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Back to chats" nativeButton={false} render={<Link to="/" replace />}>
      <ArrowLeftIcon />
    </Button>
  )
}

function ChatLayout({ header, actions, children }: { header: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex h-svh flex-col">
      {/* 消息视口是滚动容器，标题栏浮在其上方，消息从毛玻璃下滚过 */}
      <header className="app-blur absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 px-3">
        {!inPip && <NavButton />}
        {header}
        <PlayerSlot />
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      {children}
    </div>
  )
}

export function ChatNotFound() {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {!inPip && <NavButton />}
        <PlayerSlot />
      </header>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleOffIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={1}>Chat not found</EmptyTitle>
          <EmptyDescription>This chat doesn’t exist or you’re not a member.</EmptyDescription>
        </EmptyHeader>
        {!inPip && (
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
              Back to chats
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  )
}
