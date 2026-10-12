import { Suspense, cloneElement, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowDownIcon,
  AtSignIcon,
  CopyIcon,
  ForwardIcon,
  MessageCircleIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ReplyIcon,
  RotateCwIcon,
  StickerIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react'
import {
  EDIT_WINDOW_MS,
  MAX_PAGE_LIMIT,
  MAX_PINNED_MESSAGES,
  REACTIONS,
  RECALL_WINDOW_MS,
  parseSecretChatId,
  type ForwardFrom,
  type AlbumItem,
  type Sticker,
  type Media,
  type Voice,
  type MessageEntity,
  type ReactionEmoji,
  type Reactions,
  type ServiceAction,
} from 'shared/protocol'

import { SkeletonText } from '@/components/skeleton-text'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent, BubbleReactions } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ButtonGroup } from '@/components/ui/button-group'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Progress } from '@/components/ui/progress'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMe } from '@/features/auth/me'
import { opErrorMessage } from '@/features/groups/errors'
import { usePageVisible } from '@/hooks/use-page-visible'
import { useUsers, type UserInfo } from '@/hooks/use-users'
import { copyImage } from '@/features/media/copy-image'
import { mediaImgProps, mediaUrl, thumbhashUrl } from '@/features/media/media-url'
import { useSealedUrls } from '@/features/secret/sealed-media'
import { PendingMedia, SentMedia } from '@/features/media/message-media'
import { addStickerFromImage, addStickerFromMessage } from '@/features/stickers/add'
import { PendingVoice, VoiceMessage } from '@/features/voice/voice-message'
import type { OutboxMedia, OutboxVoice } from '@/sync/store'
import { inPip } from '@/features/pip/pip'
import { formatDayHeading, formatTime, isSameDay } from '@/lib/format'
import { describeMediaJson } from '@/lib/media-text'
import { describeAction, describeRecall, linkOnly } from 'shared/text'
import { topics } from '@/sync/bridge'
import { OpFailure, call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { randomId } from '@/sync/logic'
import type { ComposeTarget } from './compose'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from './message-scroller'
import { useController, useMessageScroller, useMessageScrollerVisibility } from './message-scroller-controller'
import { WINDOW_STEP, latestWindow, reachesLatest, windowAround } from './message-window'
import { fadeMotion, popMotion } from './item-motion'
import { setFollowing, stopFollowing, useFollowingChat } from './following'
import { MessageText } from './message-text'
import { PendingLinkCard, SentLinkCard } from '@/features/link/link-card'
import { PINNED_SQL, PinnedBar, type PinnedRow } from './pinned-bar'

const ForwardDialog = lazy(() => import('./forward-dialog').then((m) => ({ default: m.ForwardDialog })))

/** 定位到的消息高亮多久 */
const HIGHLIGHT_MS = 2000
/** 与上一条相隔这么久（或跨天）就另起一组，组首显示日期与时刻 */
const GROUP_GAP_MS = 15 * 60 * 1000

type MessageRow = {
  seq: number | null
  sender_id: string | null
  date: number
  /** cipher：秘密聊天里还没解开的；broken：解不开（验证失败）的。本设备加入之前的（sealed）不显示 */
  kind: 'text' | 'media' | 'service' | 'recalled' | 'cipher' | 'broken'
  text: string | null
  /** 提及（MessageEntity[] 的 JSON） */
  entities: string | null
  /** 媒体消息的 media（JSON）：已发送的为 Media[]，发件箱里的为 OutboxMedia[] */
  media: string | null
  /** 服务消息的动作（JSON） */
  action: string | null
  state: 'pending' | 'failed' | null
  /** 发送失败的原因：blocked 表示对方拉黑了我，或我拉黑了对方 */
  error: string | null
  random_id: number | null
  edit_date: number | null
  reply_to: number | null
  /** 回应（Reactions 的 JSON） */
  reactions: string | null
  pinned_at: number | null
  /** 转发来源（ForwardFrom 的 JSON） */
  fwd_from: string | null
  /** 链接预览：已发送的为 LinkPreview（JSON），发件箱里的为 OutboxLink（JSON）；没有卡片为 NULL */
  preview: string | null
  /** 被回复的消息；本地还没有时 reply_seq 为 null */
  reply_seq: number | null
  reply_sender_id: string | null
  /** 被回复的可能是本设备加入之前、不显示的消息 */
  reply_kind: MessageRow['kind'] | 'sealed' | null
  reply_text: string | null
  reply_media: string | null
  reply_action: string | null
}

// 已落库的消息取一个窗口（见 MessageWindow）：?2 为 anchor，?3 为 before，?4 为 after。
// 最新窗口里，发件箱待发送的消息接在最后；发送失败的按时间留在原位，否则后面照常发出去的消息会排到它前面。
// 只取 min_seq 之后连续的部分：更早的行只是回复引用或编辑过的旧消息，中间可能有空洞
const MESSAGES_SQL = `
  SELECT x.seq, x.sender_id, x.date, x.kind, x.text, x.entities, x.media, x.action, x.state, x.error, x.random_id, x.edit_date, x.reply_to,
    x.reactions, x.pinned_at, x.fwd_from, x.preview, r.seq AS reply_seq, r.sender_id AS reply_sender_id, r.kind AS reply_kind, r.text AS reply_text, r.media AS reply_media,
    r.action AS reply_action
  FROM (
    SELECT 0 AS outbox, seq, sender_id, date, kind, text, entities, media, action, NULL AS state, NULL AS error, random_id, edit_date, reply_to,
      reactions, pinned_at, fwd_from, preview
    FROM (
      SELECT * FROM messages
      WHERE chat_id = ?1 AND seq >= coalesce((SELECT min_seq FROM chats WHERE chat_id = ?1), 1) AND (?2 IS NULL OR seq < ?2) AND kind != 'sealed'
      ORDER BY seq DESC LIMIT ?3
    )
    UNION ALL
    SELECT 0, seq, sender_id, date, kind, text, entities, media, action, NULL, NULL, random_id, edit_date, reply_to, reactions, pinned_at,
      fwd_from, preview
    FROM (
      SELECT * FROM messages
      WHERE chat_id = ?1 AND ?2 IS NOT NULL AND seq >= max(?2, coalesce((SELECT min_seq FROM chats WHERE chat_id = ?1), 1)) AND kind != 'sealed'
      ORDER BY seq LIMIT ?4
    )
    UNION ALL
    SELECT 1, NULL, NULL, created_at, kind, text, entities, media, NULL, state, error, random_id, NULL, reply_to, NULL, NULL, NULL, link
    FROM outbox WHERE chat_id = ?1 AND ?2 IS NULL
  ) x LEFT JOIN messages r ON r.chat_id = ?1 AND r.seq = x.reply_to
  ORDER BY coalesce(x.state = 'pending', 0), x.date, x.outbox, x.seq`

type ReadState = { top_seq: number; last_read_seq: number; peer_read_seq: number }

/** 向上分页，直到本地连续的部分包含 seq（或已到会话开头）。定位到更早的回复引用之前调用 */
async function loadUntil(chatId: string, seq: number) {
  for (;;) {
    const [state] = await call('query', { sql: 'SELECT min_seq FROM chats WHERE chat_id = ?', params: [chatId] })
    if (!state || Number(state.min_seq) <= seq) return
    const { done } = await call('loadOlder', { chatId, limit: MAX_PAGE_LIMIT })
    if (done) return
  }
}

/** 自己发的消息的状态，只显示在自己发的最后一条下面；群组暂不展示已读回执 */
type Delivery = 'pending' | 'sent' | 'read' | null

const DELIVERY_TEXT = { pending: 'Sending…', sent: 'Sent', read: 'Read' } as const

const rowKey = (row: MessageRow) => (row.seq !== null ? `m${row.seq}` : `o${row.random_id}`)
/** React key：自己发的消息按 random_id，发送成功从发件箱换成已落库的消息时沿用同一个元素，入场动画不被打断 */
const elementKey = (row: MessageRow) => (row.random_id !== null ? `r${row.random_id}` : rowKey(row))

/** 标题栏（h-14）与置顶条（h-16）的高度 */
const HEADER_HEIGHT = 56
const PINNED_BAR_HEIGHT = 64

export function MessageList({
  chatId,
  isGroup,
  emptyText,
  canPin,
  onCompose,
  jumpTo,
  onJumpHandled,
  topInset = 0,
}: {
  chatId: string
  isGroup: boolean
  /** 标题栏下方还浮着的横条（群组通话）的高度，消息与置顶条再往下让出这么多 */
  topInset?: number
  emptyText: string
  /** 能否置顶与取消置顶消息：群组的群主，或私聊双方 */
  canPin: boolean
  /** 回复与编辑：交给输入框；只读对话不传 */
  onCompose?: (target: ComposeTarget) => void
  /** 定位到这条消息；收到后调用 onJumpHandled，同一条可以再次定位 */
  jumpTo?: number
  onJumpHandled?: () => void
}) {
  const me = useMe()
  const users = useUsers()
  const [win, setWin] = useState(() => (jumpTo === undefined ? latestWindow() : windowAround(jumpTo)))
  const rows = useLiveQuery<MessageRow>(MESSAGES_SQL, [chatId, win.anchor, win.before, win.after], [
    topics.chat(chatId),
  ])
  const state = useLiveQuery<{ min_seq: number }>('SELECT min_seq FROM chats WHERE chat_id = ?', [chatId], [
    topics.chat(chatId),
  ])
  const readRows = useLiveQuery<ReadState>(
    'SELECT top_seq, last_read_seq, peer_read_seq FROM dialogs WHERE chat_id = ?',
    [chatId],
    [topics.dialogs],
  )
  const read = readRows?.[0]
  const unread = read ? Math.max(0, read.top_seq - read.last_read_seq) : 0
  const pinned = useLiveQuery<PinnedRow>(PINNED_SQL, [chatId], [topics.chat(chatId)]) ?? []
  // 秘密聊天：本设备加入之前的消息（sealed）在这里读不了、不显示；在分界之后读得到的第一条上方说明一句。
  // 按分界定位，不按窗口：窗口顶上的那条不一定紧挨着分界
  const sealed = useLiveQuery<{ last: number | null; first_readable: number | null }>(
    `SELECT s.last, (SELECT min(seq) FROM messages WHERE chat_id = ?1 AND kind != 'sealed' AND seq > s.last) AS first_readable
     FROM (SELECT max(seq) AS last FROM messages WHERE chat_id = ?1 AND kind = 'sealed') s`,
    [chatId],
    [topics.chat(chatId)],
  )?.[0]
  const lastSealed = sealed?.last ?? null
  // 未读提及：服务端记下的 seq 里，本地已读位置之后的
  const mentions = useLiveQuery<{ first: number | null; n: number }>(
    `SELECT min(j.value) AS first, count(*) AS n FROM dialogs d, json_each(d.unread_mentions) j
     WHERE d.chat_id = ? AND j.value > d.last_read_seq`,
    [chatId],
    [topics.dialogs],
  )?.[0]

  // 定位：等当前窗口的查询结果里出现目标（latest 表示回到底部，unread 表示首条未读），再重建滚动容器，
  // 让它按新的滚动锚点（没有锚点时为底部）重新定位。epoch 为滚动容器的版本
  const [pending, setPending] = useState<number | 'latest' | 'unread' | null>(jumpTo ?? null)
  const [epoch, setEpoch] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [seenJumpTo, setSeenJumpTo] = useState(jumpTo)
  if (jumpTo !== seenJumpTo) {
    setSeenJumpTo(jumpTo)
    if (jumpTo !== undefined) {
      setWin(windowAround(jumpTo))
      setPending(jumpTo)
    }
  }
  const goLatest = () => {
    setWin(latestWindow())
    setPending('latest')
    // 回到底部就不再以首条未读为锚点（例如从 ?m= 打开时它还没用过）
    setAnchorUsed(true)
  }
  const goTo = (seq: number) => {
    setWin(windowAround(seq))
    setPending(seq)
  }

  // 点击回复引用：定位到被回复的消息，并记下从哪条跳过来的；回到底部按钮先逐级退回这些位置。
  // 只在内存里，离开会话或看到最新一条时清空
  const [back, setBack] = useState<number[]>([])
  const [jumping, setJumping] = useState(false)
  const jumpToReply = async (from: number | null, to: number) => {
    if (jumping) return
    setJumping(true)
    try {
      await loadUntil(chatId, to)
    } catch {
      toast.add({ type: 'error', title: "Couldn't load earlier messages" })
      return
    } finally {
      setJumping(false)
    }
    if (from !== null) setBack((b) => [...b, from])
    goTo(to)
  }

  // 「未读消息」分隔线：标在 readMark 之后别人发的第一条上方，标出来之后本次打开期间固定不动。
  // 初值为打开时的已读位置，未读太多时以首条未读为锚点打开。贴底阅读时新来的消息一到就读到，不标；
  // 离开底部、切到后台时从当时的已读位置起标，回来时看得到之后来的从哪条开始
  const [readMark, setReadMark] = useState<number | null | undefined>(undefined)
  const following = useFollowingChat() === chatId
  if (readRows !== undefined && readMark === undefined) {
    setReadMark(read?.last_read_seq ?? null)
    if (read && unread + 10 > WINDOW_STEP && pending === null) {
      setWin(windowAround(read.last_read_seq + 1, 10))
      setPending('unread')
    }
  }
  // 首条未读只在第一次出现时作为滚动锚点，之后撤掉，免得列表变化时被拉回来
  const [anchorUsed, setAnchorUsed] = useState(false)

  // 锚定窗口时自己发了消息：发件箱接在最新一条之后，回到底部才看得到
  const outboxTop = useLiveQuery<{ t: number | null }>(
    'SELECT max(created_at) AS t FROM outbox WHERE chat_id = ?',
    [chatId],
    [topics.chat(chatId)],
  )?.[0]?.t
  const [seenOutboxTop, setSeenOutboxTop] = useState(outboxTop)
  if (outboxTop !== seenOutboxTop) {
    setSeenOutboxTop(outboxTop)
    const queued = outboxTop != null && seenOutboxTop !== undefined && outboxTop > (seenOutboxTop ?? 0)
    if (queued && win.anchor !== null) goLatest()
  }

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // 进入视口的首条 / 末条：只有仍是当前的首条 / 末条才算数，窗口扩展后旧的报告自然作废
  const [firstSeen, setFirstSeen] = useState<string | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // 向上插入后的补偿是否已经落地（见 ScrollController.settled）：没落地时不再加载，免得一路加载到头
  const [settled, setSettled] = useState(true)
  // 扩大窗口会换一个查询，新结果到达前继续显示旧窗口，否则列表会被卸载、滚动位置丢失
  const [shown, setShown] = useState(rows)
  if (rows !== undefined && rows !== shown) setShown(rows)

  const synced = state !== undefined && state.length > 0
  const minSeq = state?.[0]?.min_seq ?? 1
  const stored = rows?.filter((r) => r.seq !== null) ?? []
  const older = win.anchor === null ? stored.length : stored.filter((r) => r.seq! < win.anchor!).length
  const newer = stored.length - older
  const hasMoreLocal = older >= win.before
  const hasMoreRemote = synced && minSeq > 1
  // 锚定窗口已经包含最新一条：转回最新窗口，之后跟随新消息、显示发件箱
  if (rows !== undefined && reachesLatest(win, stored.map((r) => r.seq!), read?.top_seq)) {
    setWin(latestWindow(Math.max(stored.length, WINDOW_STEP)))
  }
  // 列表还是骨架屏或空状态时没有滚动容器，观察器要等它出现后再挂
  const listShown = shown !== undefined && shown.length > 0 && readRows !== undefined
  const first = shown?.[0]
  const firstKey = first ? rowKey(first) : ''
  const last = shown?.at(-1)
  const lastKey = last ? rowKey(last) : ''
  const firstVisible = firstKey !== '' && firstSeen === firstKey
  const lastVisible = lastKey !== '' && lastSeen === lastKey
  const lastMine = last !== undefined && (last.sender_id ?? me.id) === me.id
  const firstUnread =
    readMark == null
      ? undefined
      : shown?.find((r) => r.seq !== null && r.seq > readMark && r.sender_id !== me.id)
  const firstUnreadKey = firstUnread ? rowKey(firstUnread) : null
  if (readMark !== undefined && read) {
    // 本地消息还没追上最新一条（刚打开、正在同步）时不撤：打开前的未读还没到
    const caughtUp = (stored.at(-1)?.seq ?? 0) >= read.top_seq
    if (following && readMark !== null && !firstUnread && caughtUp) setReadMark(null)
    else if (!following && readMark === null) setReadMark(read.last_read_seq)
  }

  useEffect(() => {
    if (firstUnreadKey && !anchorUsed && listShown && pending === null) setAnchorUsed(true)
  }, [firstUnreadKey, anchorUsed, listShown, pending])

  // 查询结果到达、列表能显示出来后执行定位；目标本地已经没有时（例如重新同步丢弃了旧窗口）回到底部
  useEffect(() => {
    if (pending === null || rows === undefined || readRows === undefined) return
    // 查询结果到达才能定位，还要提示目标不在本地：只能在提交之后做
    // oxlint-disable-next-line react/set-state-in-effect
    setPending(null)
    setEpoch((e) => e + 1)
    if (pending === 'latest' || pending === 'unread') {
      setFocusKey(null)
      return
    }
    const key = `m${pending}`
    if (rows.some((r) => r.seq === pending)) {
      setFocusKey(key)
      setHighlightKey(key)
      return
    }
    setFocusKey(null)
    setWin(latestWindow())
    toast.add({ title: 'This message isn’t on this device' })
  }, [pending, rows, readRows])

  useEffect(() => {
    if (jumpTo !== undefined) onJumpHandled?.()
  }, [jumpTo, onJumpHandled])

  useEffect(() => {
    if (!highlightKey) return
    const timer = setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightKey])

  // 滚动容器只在挂载时用锚点，定位到的消息随每次重建更新；回到底部时两者都没有
  const anchorKey = focusKey ?? (anchorUsed ? null : firstUnreadKey)

  const delivery = (row: MessageRow, mine: boolean): Delivery => {
    if (!mine) return null
    if (row.seq === null) return row.state === 'pending' ? 'pending' : null
    if (isGroup) return 'sent'
    return read && row.seq <= read.peer_read_seq ? 'read' : 'sent'
  }

  // 自己发的最后一条：只在它下面显示状态
  const lastOwn = shown?.findLast((r) => (r.sender_id === null || r.sender_id === me.id) && !isNotice(r))
  const lastOwnKey = lastOwn ? rowKey(lastOwn) : null

  // 最早一条进入视口上方 200px 内就加载更早的消息；向上插入时由 MessageScroller 保持视口里的第一条不动
  useEffect(() => {
    const root = viewportRef.current
    const target = contentRef.current?.firstElementChild
    if (!root || !target) return
    const observer = new IntersectionObserver(
      ([entry]) => setFirstSeen(entry?.isIntersecting ? target.getAttribute('data-message-id') : null),
      { root, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(target)
    return () => {
      observer.disconnect()
      setFirstSeen(null)
    }
    // epoch：滚动容器重建后，首条即使没变也是新的节点
  }, [firstKey, listShown, epoch])

  useEffect(() => {
    if (!firstVisible || !settled || loadingOlder || !rows || pending !== null) return
    const grow = () => setWin((w) => ({ ...w, before: w.before + WINDOW_STEP }))
    if (hasMoreLocal) {
      // 首条进入视口（观察器报告）之后才扩展；只在条件变化时扩展一次，放进渲染会连续扩展
      // oxlint-disable-next-line react/set-state-in-effect
      grow()
      return
    }
    if (!hasMoreRemote) return
    // oxlint-disable-next-line react/set-state-in-effect
    setLoadingOlder(true)
    call('loadOlder', { chatId })
      .then(grow)
      .catch(() => toast.add({ type: 'error', title: "Couldn't load earlier messages" }))
      .finally(() => setLoadingOlder(false))
  }, [firstVisible, settled, loadingOlder, rows, pending, hasMoreLocal, hasMoreRemote, chatId])

  // 锚定窗口：最后一条进入视口下方 200px 内就向下扩展（向下追加不影响视口）。
  // 定位完成前两个方向都不扩展：那时显示的还是旧窗口，首末两条是否可见已经不作数
  const anchored = win.anchor !== null
  useEffect(() => {
    const root = viewportRef.current
    const items = contentRef.current?.querySelectorAll(':scope > [data-message-id]')
    const target = items?.[items.length - 1]
    if (!anchored || pending !== null || !root || !target) return
    const observer = new IntersectionObserver(
      ([entry]) => setLastSeen(entry?.isIntersecting ? target.getAttribute('data-message-id') : null),
      { root, rootMargin: '0px 0px 200px 0px' },
    )
    observer.observe(target)
    return () => {
      observer.disconnect()
      setLastSeen(null)
    }
  }, [lastKey, listShown, anchored, pending, epoch])

  const hasMoreNewer = anchored && newer >= win.after
  useEffect(() => {
    // 与向上扩展相同：只在条件变化时扩展一次
    // oxlint-disable-next-line react/set-state-in-effect
    if (lastVisible && hasMoreNewer && rows && pending === null) setWin((w) => ({ ...w, after: w.after + WINDOW_STEP }))
  }, [lastVisible, hasMoreNewer, rows, pending])

  if (!shown || readRows === undefined || (!synced && shown.length === 0)) return <MessagesSkeleton />

  if (shown.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleIcon />
          </EmptyMedia>
          <EmptyTitle role="heading" aria-level={2}>No messages yet</EmptyTitle>
          <EmptyDescription>{lastSealed !== null ? SEALED_NOTICE : emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // 消息让出浮在上方的标题栏、群组通话的横条与置顶条
  const top = HEADER_HEIGHT + topInset + (pinned.length > 0 ? PINNED_BAR_HEIGHT : 0)

  return (
    <>
      {/* 锚定窗口不跟随底部：否则滚到窗口底部就会一路向下扩展到最新 */}
      {/* 有置顶条时顶部多让出它的高度（h-16） */}
      <MessageScroller
        key={epoch}
        follow={!anchored}
        anchor={anchorKey}
        peek={top > HEADER_HEIGHT ? top + 8 : undefined}
        className="flex-1"
      >
        {!anchored && <FollowOwnMessages lastKey={lastKey} lastMine={lastMine} />}
        <ReportRead chatId={chatId} lastRead={read?.last_read_seq ?? 0} topSeq={read?.top_seq ?? 0} />
        <ReportFollowing chatId={chatId} active={!anchored} />
        <ReportSettled onChange={setSettled} />
        {/* 键盘停在下面的消息列表上（见 navigateMessages），视口本身不再单独占一个 Tab 停留点；
            方向键移到的消息要露在浮着的标题栏与置顶条下面 */}
        <MessageScrollerViewport
          ref={viewportRef}
          tabIndex={-1}
          className="scroll-pt-[calc(var(--top)+0.5rem)]"
          style={{ '--top': `${top}px` } as CSSProperties}
        >
          {/* 子元素只能是消息项：保持视口、判断追加都按子元素算。mt-14 让出浮在上方的标题栏，有置顶条时再让出它 */}
          <MessageScrollerContent
            ref={contentRef}
            className="mx-auto mt-(--top) w-full max-w-3xl"
            style={{ '--top': `${top}px` } as CSSProperties}
            tabIndex={0}
            onKeyDown={navigateMessages}
          >
            {shown.map((row, i) => {
              const prev = shown[i - 1]
              const key = rowKey(row)
              // 不在每条消息上显示时间：按时间分组，组首显示日期与时刻
              const newGroup = !prev || !isSameDay(prev.date, row.date) || row.date - prev.date >= GROUP_GAP_MS
              const mine = row.sender_id === null || row.sender_id === me.id
              // 群组里，别人连续发的消息只在第一条上标出名字
              const showSender =
                isGroup && !mine && (newGroup || prev?.sender_id !== row.sender_id || isNotice(prev))
              return (
                <MessageScrollerItem
                  key={elementKey(row)}
                  messageId={key}
                  variant={key === highlightKey ? 'highlighted' : 'default'}
                >
                  {row.seq !== null && row.seq === sealed?.first_readable && (
                    <Marker variant="center" className="my-1">
                      <MarkerContent>{SEALED_NOTICE}</MarkerContent>
                    </Marker>
                  )}
                  {key === firstUnreadKey && (
                    <Marker variant="separator" className="my-1">
                      <MarkerContent>Unread messages</MarkerContent>
                    </Marker>
                  )}
                  {newGroup && (
                    <Marker variant="center" className="my-1">
                      <MarkerContent>
                        <span className="font-medium">{formatDayHeading(row.date)}</span> {formatTime(row.date)}
                      </MarkerContent>
                    </Marker>
                  )}
                  {isNotice(row) ? (
                    // 撤回后、秘密聊天解开后，气泡与占位在原位交叉淡入淡出
                    <Marker ref={fadeMotion} variant="center" className="my-1">
                      <MarkerContent>
                        {row.kind === 'recalled'
                          ? describeRecall(row.sender_id!, me.id, users)
                          : row.kind === 'cipher'
                            ? <CipherNotice />
                            : row.kind === 'broken'
                              ? SECRET_PLACEHOLDER.broken
                              : describeAction(JSON.parse(row.action!) as ServiceAction, row.sender_id!, me.id, users)}
                      </MarkerContent>
                    </Marker>
                  ) : (
                    <ChatMessage
                      chatId={chatId}
                      isGroup={isGroup}
                      canPin={canPin}
                      row={row}
                      mine={mine}
                      delivery={key === lastOwnKey ? delivery(row, mine) : null}
                      sender={showSender ? users.get(row.sender_id!) : undefined}
                      users={users}
                      onCompose={onCompose}
                      onJumpToReply={(to) => void jumpToReply(row.seq, to)}
                    />
                  )}
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {back.length > 0 && !anchored && read && (
          <OnLatestVisible latestKey={`m${read.top_seq}`} onVisible={() => setBack([])} />
        )}
        {(loadingOlder || jumping) && (
          // 与页面顶部的连接指示条同款，贴在标题栏下沿；有置顶条时贴在置顶条下沿
          <Progress
            value={null}
            size="xs"
            aria-label="Loading earlier messages"
            className="absolute inset-x-0 top-(--top)"
            style={{ '--top': `${top}px` } as CSSProperties}
          />
        )}
        {mentions?.first != null && (
          // 依次定位到未读的提及：读到之后它就从列表里移除，下一次点击到下一条
          <div className="absolute right-4 bottom-4">
            <Button variant="floating" size="icon-sm" onClick={() => void jumpToReply(null, mentions.first!)}>
              <AtSignIcon />
              <span className="sr-only">Next mention</span>
              {mentions.n > 1 && <Badge className="absolute -top-2 -right-2">{mentions.n}</Badge>}
            </Button>
          </div>
        )}
        <MessageScrollerButton
          onClick={(e) => {
            // 从回复引用跳过来的：先退回跳转前的那条
            const from = back.at(-1)
            if (from !== undefined) {
              e.preventDefault()
              setBack((b) => b.slice(0, -1))
              goTo(from)
              return
            }
            // 锚定窗口的底部不是最新一条：换成最新窗口再滚到底
            if (!anchored) return
            e.preventDefault()
            goLatest()
          }}
        >
          <ArrowDownIcon />
          <span className="sr-only">Scroll to end</span>
          {unread > 0 && <Badge className="absolute -top-2 -right-2">{unread}</Badge>}
        </MessageScrollerButton>
      </MessageScroller>
      {/* 放在 MessageScroller 之外：跳转会换 epoch 重建滚动区，置顶条要保住当前显示的是哪一条 */}
      {pinned.length > 0 && (
        <PinnedBar
          top={HEADER_HEIGHT + topInset}
          chatId={chatId}
          pinned={pinned}
          canPin={canPin}
          meId={me.id}
          users={users}
          onJump={(seq) => void jumpToReply(null, seq)}
        />
      )}
    </>
  )
}

/**
 * 消息列表的键盘操作：列表本身是唯一的 Tab 停留点，方向键在消息之间移动（从列表本身进入时先到最新一条），
 * Home / End 到第一条与最后一条；Enter 或 Shift+F10 在气泡旁打开右键菜单。
 * 只处理列表与气泡本身上的按键：气泡里的链接、语音进度条等控件照常使用自己的按键
 */
function navigateMessages(e: React.KeyboardEvent<HTMLDivElement>) {
  const bubbles = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-message-bubble]')]
  const target = e.target as HTMLElement
  const i = bubbles.indexOf(target)
  if (target !== e.currentTarget && i === -1) return
  if (i !== -1 && (e.key === 'Enter' || (e.key === 'F10' && e.shiftKey))) {
    e.preventDefault()
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }),
    )
    return
  }
  const last = bubbles.length - 1
  const next =
    e.key === 'ArrowUp'
      ? i === -1 ? last : i - 1
      : e.key === 'ArrowDown'
        ? i === -1 ? last : i + 1
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? last
            : null
  if (next === null) return
  e.preventDefault()
  const bubble = bubbles[next]
  if (!bubble) return
  // 不让浏览器为聚焦而滚动：只滚到刚好露出，不打乱滚动区的跟随与锚定
  bubble.focus({ preventScroll: true })
  bubble.scrollIntoView({ block: 'nearest' })
}

/**
 * follow 只在已贴底时跟随；自己刚发的消息无论停在哪里都平滑滚到底。
 * 只在最新窗口里、最后一条变化时跟随：挂载时的位置交给滚动锚点（可能是定位的目标）
 */
function FollowOwnMessages({ lastKey, lastMine }: { lastKey: string; lastMine: boolean }) {
  const { scrollToEnd } = useMessageScroller()
  const seen = useRef(lastKey)
  useLayoutEffect(() => {
    if (lastKey === seen.current) return
    seen.current = lastKey
    if (lastKey && lastMine) scrollToEnd()
  }, [lastKey, lastMine, scrollToEnd])
  return null
}

/** 最新一条进入视口时通知一次 */
function OnLatestVisible({ latestKey, onVisible }: { latestKey: string; onVisible: () => void }) {
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const visible = visibleMessageIds.includes(latestKey)
  useEffect(() => {
    if (visible) onVisible()
  }, [visible, onVisible])
  return null
}

/**
 * 页面在前台时，把视口里最新的一条消息上报为已读。
 * 依赖 topSeq：消息可能先于对话行的更新到达，那时上报会被最新一条的位置截住，对话行更新后要再报一次
 */
function ReportRead({ chatId, lastRead, topSeq }: { chatId: string; lastRead: number; topSeq: number }) {
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const visible = usePageVisible()

  useEffect(() => {
    if (!visible) return
    let max = 0
    for (const id of visibleMessageIds) if (id.startsWith('m')) max = Math.max(max, Number(id.slice(1)))
    if (max > lastRead) void call('read', { chatId, maxSeq: max })
  }, [chatId, lastRead, topSeq, visible, visibleMessageIds])
  return null
}

/**
 * 页面在前台、跟随最新窗口且停在底部时，登记为正在贴底阅读的会话（见 following.ts）。
 * 在副作用里直接读滚动状态：挂载时定位在布局副作用里进行，渲染时读到的还是定位前的值
 */
function ReportFollowing({ chatId, active }: { chatId: string; active: boolean }) {
  const controller = useController()
  const visible = usePageVisible()

  useEffect(() => {
    if (!active || !visible) return
    const update = () => (controller.away.get() ? stopFollowing(chatId) : setFollowing(chatId))
    update()
    const unsubscribe = controller.away.subscribe(update)
    return () => {
      unsubscribe()
      stopFollowing(chatId)
    }
  }, [chatId, active, visible, controller])
  return null
}

/** 把滚动容器里补偿是否落地交给外面：MessageList 在滚动容器之外，拿不到它的状态 */
function ReportSettled({ onChange }: { onChange: (settled: boolean) => void }) {
  const controller = useController()
  const settled = useSyncExternalStore(controller.settled.subscribe, controller.settled.get)
  useEffect(() => onChange(settled), [settled, onChange])
  return null
}

function ChatMessage({
  chatId,
  isGroup,
  canPin,
  row,
  mine,
  delivery,
  sender,
  users,
  onCompose,
  onJumpToReply,
}: {
  chatId: string
  isGroup: boolean
  canPin: boolean
  row: MessageRow
  mine: boolean
  delivery: Delivery
  sender: UserInfo | undefined
  users: Map<string, UserInfo>
  onCompose: ((target: ComposeTarget) => void) | undefined
  /** 点击回复引用：定位到被回复的消息 */
  onJumpToReply: (seq: number) => void
}) {
  const me = useMe()
  const seq = row.seq
  // 菜单打开的时刻：据此决定是否还能编辑、撤回（以服务端为准，过期会返回 expired）
  const [openedAt, setOpenedAt] = useState(0)
  const [confirmRecall, setConfirmRecall] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [recalling, setRecalling] = useState(false)
  // 相册里按下的那张图（右键或长按之前先有 pointerdown），菜单里复制的就是它
  const [photo, setPhoto] = useState<string | null>(null)
  // 菜单打开时选中的文字（选区碰到这条消息才算，可以跨多条）：复制的就是它
  const [selection, setSelection] = useState('')
  const bubbleRef = useRef<HTMLDivElement>(null)
  const isText = row.kind === 'text'
  // 纯链接消息带卡片时显示卡片而不是正文；卡片自己有底色，不再套气泡
  const card = isText && row.preview !== null && linkOnly(row.text ?? '') !== null
  // 相册与文件消息不套气泡；语音消息像文本一样套气泡
  const media = row.media ? (JSON.parse(row.media) as (Media | OutboxMedia)[]) : null
  const album = media?.[0]?.type === 'photo' || media?.[0]?.type === 'video'
  const voice = media?.[0]?.type === 'voice' ? media[0] : null
  const secret = parseSecretChatId(chatId) !== null
  // 加入我的贴纸：已发送的、不在秘密聊天里的图片（按下的那张）与贴纸消息
  const canSave = seq !== null && !secret
  const sticker = media?.[0]?.type === 'sticker'
  const summary = row.media ? describeMediaJson(row.media) : (row.text ?? '')
  const fwdFrom = row.fwd_from ? (JSON.parse(row.fwd_from) as ForwardFrom) : null
  // 转发来的消息不能编辑
  const canEdit = isText && mine && fwdFrom === null && onCompose !== undefined && seq !== null && openedAt - row.date < EDIT_WINDOW_MS
  // 只读对话里读得到的消息也可以转发出去；秘密聊天的不能（转发要让服务端读到内容）
  const canForward = seq !== null && (row.kind === 'text' || row.kind === 'media') && !secret
  const canRecall = mine && onCompose !== undefined && seq !== null && openedAt - row.date < RECALL_WINDOW_MS
  const entities = row.entities ? (JSON.parse(row.entities) as MessageEntity[]) : null
  // 只读对话不能回应
  const canReact = onCompose !== undefined && seq !== null && (row.kind === 'text' || row.kind === 'media')
  const reactions = row.reactions ? (JSON.parse(row.reactions) as Reactions) : null
  const myReaction = reactions ? REACTIONS.find((e) => reactions[e]?.includes(me.id)) : undefined
  const footer = [row.edit_date !== null && 'Edited', delivery && DELIVERY_TEXT[delivery]].filter(Boolean).join(' · ')

  const pinnable = canPin && onCompose !== undefined && seq !== null && (row.kind === 'text' || row.kind === 'media')
  const togglePin = () => {
    const pinning = row.pinned_at === null
    const op = pinning ? call('pinMessage', { chatId, seq: seq!, randomId: randomId() }) : call('unpinMessage', { chatId, seq: seq! })
    op.catch((e: unknown) =>
      toast.add({
        type: 'error',
        title: pinning ? "Couldn't pin the message" : "Couldn't unpin the message",
        description:
          e instanceof OpFailure && e.code === 'pin_limit'
            ? `You can pin up to ${MAX_PINNED_MESSAGES} messages. Unpin one first.`
            : opErrorMessage(e, 'Try again.'),
      }),
    )
  }

  // 再点自己的回应是取消，点别的是替换
  const react = (emoji: ReactionEmoji) =>
    call('react', { chatId, seq: seq!, emoji: emoji === myReaction ? null : emoji }).catch((e: unknown) =>
      toast.add({ type: 'error', title: "Couldn't react", description: opErrorMessage(e, 'Try again.') }),
    )

  const copy = () =>
    navigator.clipboard
      .writeText(selection || (row.text ?? ''))
      .catch(() => toast.add({ type: 'error', title: "Couldn't copy text" }))
  const copyPhoto = (url: string) =>
    copyImage(url).catch(() => toast.add({ type: 'error', title: "Couldn't copy the photo" }))

  const recall = async () => {
    setRecalling(true)
    try {
      await call('recallMessage', { chatId, seq: seq! })
      setConfirmRecall(false)
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't recall the message", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setRecalling(false)
    }
  }

  return (
    <Message ref={fadeMotion} align={mine ? 'end' : 'start'}>
      <MessageContent>
        {/* 名字在气泡里另有一份给读屏的，这里不再读 */}
        {sender && <MessageHeader aria-hidden>{sender.name}</MessageHeader>}
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) return
            setOpenedAt(Date.now())
            const sel = window.getSelection()
            const selected = sel && !sel.isCollapsed && bubbleRef.current && sel.containsNode(bubbleRef.current, true)
            setSelection(selected ? sel.toString() : '')
          }}
        >
          <ContextMenuTrigger
            ref={bubbleRef}
            // 键盘：在消息列表里用方向键移到这里，Enter 或 Shift+F10 打开菜单（见 navigateMessages）
            role="article"
            tabIndex={-1}
            data-message-bubble=""
            aria-keyshortcuts="Enter Shift+F10"
            render={
              <Bubble
                variant={(row.kind === 'media' && !voice) || card ? 'ghost' : mine ? 'default' : 'muted'}
                focusable
                reactions={reactions !== null}
              />
            }
            className="select-text"
            onPointerDown={(e) => setPhoto((e.target as Element).closest<HTMLElement>('[data-photo]')?.dataset.photo ?? null)}
          >
            <BubbleContent>
              <span className="sr-only">{mine ? 'You' : (users.get(row.sender_id!)?.name ?? 'Someone')}: </span>
              {fwdFrom && <ForwardedFrom from={fwdFrom} meId={me.id} users={users} />}
              {row.reply_to !== null && <ReplyQuote row={row} meId={me.id} users={users} onClick={onJumpToReply} />}
              {voice ? (
                seq === null ? (
                  <PendingVoice
                    voice={voice as OutboxVoice}
                    randomId={row.random_id!}
                    failed={row.state === 'failed'}
                  />
                ) : (
                  <VoiceMessage chatId={chatId} seq={seq} senderId={row.sender_id!} voice={voice as Voice} />
                )
              ) : row.kind === 'media' ? (
                seq === null ? (
                  <PendingMedia json={row.media!} randomId={row.random_id!} failed={row.state === 'failed'} />
                ) : (
                  <SentMedia json={row.media!} chatId={chatId} seq={seq} />
                )
              ) : card ? (
                seq === null ? (
                  <PendingLinkCard text={row.text!} json={row.preview!} randomId={row.random_id!} />
                ) : (
                  <SentLinkCard text={row.text!} json={row.preview!} />
                )
              ) : (
                // 编辑后新旧正文交叉淡入淡出
                <MessageText key={row.edit_date} ref={fadeMotion} text={row.text ?? ''} entities={entities} />
              )}
            </BubbleContent>
            {reactions && (
              <ReactionChips
                reactions={reactions}
                align={mine ? 'end' : 'start'}
                meId={me.id}
                users={users}
                showNames={isGroup}
                onToggle={canReact ? (e) => void react(e) : undefined}
              />
            )}
          </ContextMenuTrigger>
          <ContextMenuContent>
            {canReact && (
              <>
                <ContextMenuGroup layout="row">
                  {REACTIONS.map((e) => (
                    <ContextMenuItem key={e} size="icon" aria-label={`React with ${e}`} onClick={() => void react(e)}>
                      {e}
                    </ContextMenuItem>
                  ))}
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
            {onCompose && seq !== null && (
              <ContextMenuItem onClick={() => onCompose({ mode: 'reply', seq, senderId: row.sender_id!, text: summary })}>
                <ReplyIcon />
                Reply
              </ContextMenuItem>
            )}
            {canForward && (
              <ContextMenuItem onClick={() => setForwarding(true)}>
                <ForwardIcon />
                Forward
              </ContextMenuItem>
            )}
            {(isText || selection) && (
              <ContextMenuItem onClick={() => void copy()}>
                <CopyIcon />
                {selection ? 'Copy selection' : 'Copy text'}
              </ContextMenuItem>
            )}
            {album && photo && (
              <ContextMenuItem onClick={() => void copyPhoto(photo)}>
                <CopyIcon />
                Copy photo
              </ContextMenuItem>
            )}
            {canSave && ((album && photo) || sticker) && (
              <ContextMenuItem
                onClick={() => void (sticker ? addStickerFromMessage(chatId, seq) : addStickerFromImage(photo!))}
              >
                <StickerIcon />
                Add to stickers
              </ContextMenuItem>
            )}
            {pinnable && (
              <ContextMenuItem onClick={togglePin}>
                {row.pinned_at === null ? <PinIcon /> : <PinOffIcon />}
                {row.pinned_at === null ? 'Pin' : 'Unpin'}
              </ContextMenuItem>
            )}
            {canEdit && (
              <ContextMenuItem
                onClick={() =>
                  onCompose({ mode: 'edit', seq, senderId: me.id, text: row.text ?? '', entities: entities ?? undefined })
                }
              >
                <PencilIcon />
                Edit
              </ContextMenuItem>
            )}
            {canRecall && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => setConfirmRecall(true)}>
                  <Undo2Icon />
                  Recall
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {footer && (
          // 状态变化（Sending… → Sent → Read）时新旧文字交叉淡入淡出
          <MessageFooter key={footer} ref={fadeMotion} variant="attached">
            {footer}
          </MessageFooter>
        )}
        {/* 只在打开时挂载：每条消息都挂一个对话框太重 */}
        {forwarding && (
          <Suspense>
            <ForwardDialog chatId={chatId} seq={seq!} open onOpenChange={setForwarding} />
          </Suspense>
        )}
        <AlertDialog open={confirmRecall} onOpenChange={setConfirmRecall}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Recall this message?</AlertDialogTitle>
              <AlertDialogDescription>It will be removed for everyone in this chat.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={recalling}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={recalling} onClick={() => void recall()}>
                {recalling && <Spinner data-icon="inline-start" />}
                Recall
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {row.error === 'blocked' && (
          <MessageFooter variant="attached">Not delivered. You can’t message this person.</MessageFooter>
        )}
        {row.state === 'failed' && row.random_id !== null && (
          <ButtonGroup>
            <Button variant="outline" size="xs" onClick={() => void call('retry', { randomId: row.random_id! })}>
              <RotateCwIcon data-icon="inline-start" />
              Retry
            </Button>
            <Button variant="outline" size="xs" onClick={() => void call('discard', { randomId: row.random_id! })}>
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </ButtonGroup>
        )}
      </MessageContent>
    </Message>
  )
}

/** 转发来的消息：气泡顶部注明最初的发送者（备注名优先），点名字打开资料页（画中画里不跳转） */
function ForwardedFrom({ from, meId, users }: { from: ForwardFrom; meId: string; users: Map<string, UserInfo> }) {
  const name = from.user_id === meId ? 'You' : (users.get(from.user_id)?.name ?? 'Someone')
  return (
    <p className="text-xs opacity-75">
      Forwarded from{' '}
      {inPip ? (
        <span className="font-medium">{name}</span>
      ) : (
        <Link to="/u/$userId" params={{ userId: from.user_id }} className="font-medium hover:underline">
          {name}
        </Link>
      )}
    </p>
  )
}

const nameList = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * 气泡下沿的回应：每个 emoji 一个标签，显示人数，自己选过的高亮；点击切换自己的回应（只读对话不能点）。
 * 群组里悬停时列出回应的人
 */
function ReactionChips({
  reactions,
  align,
  meId,
  users,
  showNames,
  onToggle,
}: {
  reactions: Reactions
  align: 'start' | 'end'
  meId: string
  users: Map<string, UserInfo>
  showNames: boolean
  onToggle: ((emoji: ReactionEmoji) => void) | undefined
}) {
  return (
    <BubbleReactions ref={fadeMotion} align={align}>
      {REACTIONS.map((e) => {
        const ids = reactions[e]
        if (!ids?.length) return null
        const reacted = ids.includes(meId)
        // 人数变化时新旧数字交叉淡入淡出
        const label = (
          <>
            {e}{' '}
            <span key={ids.length} ref={fadeMotion}>
              {ids.length}
            </span>
          </>
        )
        // 标签本身不带内容：放进 Tooltip 时由 TooltipTrigger 渲染内容
        const chip = onToggle ? (
          <Button
            ref={popMotion}
            variant={reacted ? 'default' : 'ghost'}
            size="xs"
            aria-pressed={reacted}
            onClick={() => onToggle(e)}
          />
        ) : (
          <span ref={popMotion} />
        )
        if (!showNames) return cloneElement(chip, { key: e }, label)
        const names = nameList.format(ids.map((id) => (id === meId ? 'You' : (users.get(id)?.name ?? 'Someone'))))
        return (
          <Tooltip key={e}>
            <TooltipTrigger render={chip}>{label}</TooltipTrigger>
            <TooltipContent>{names}</TooltipContent>
          </Tooltip>
        )
      })}
    </BubbleReactions>
  )
}

/** 气泡里的回复引用：点击定位到被回复的消息；本地还没有时显示占位（不能点），由同步 Worker 拉取 */
function ReplyQuote({
  row,
  meId,
  users,
  onClick,
}: {
  row: MessageRow
  meId: string
  users: Map<string, UserInfo>
  onClick: (seq: number) => void
}) {
  if (row.reply_seq === null) {
    return (
      <Item variant="quote" size="xs">
        <ItemContent>
          {/* 与 ItemTitle、ItemDescription 同样的行高 */}
          <SkeletonText className="w-24 text-sm/snug" />
          <SkeletonText className="w-40 text-sm/normal" />
        </ItemContent>
      </Item>
    )
  }
  const senderId = row.reply_sender_id!
  const name = senderId === meId ? 'You' : (users.get(senderId)?.name ?? 'Someone')
  const text =
    row.reply_kind === 'recalled'
      ? 'Recalled message'
      : row.reply_kind === 'cipher' || row.reply_kind === 'broken'
        ? SECRET_PLACEHOLDER[row.reply_kind]
        : row.reply_kind === 'sealed'
          ? 'Encrypted message'
      : row.reply_action !== null
        ? describeAction(JSON.parse(row.reply_action) as ServiceAction, senderId, meId, users)
        : row.reply_media !== null
          ? describeMediaJson(row.reply_media)
          : row.reply_text
  const first = row.reply_media ? (JSON.parse(row.reply_media) as Media[])[0] : undefined
  return (
    <Item
      variant="quote"
      size="xs"
      render={<button type="button" />}
      className="cursor-pointer text-left hover:bg-current/15"
      onClick={() => onClick(row.reply_seq!)}
    >
      {(first?.type === 'photo' || first?.type === 'video' || first?.type === 'sticker') && (
        <ItemMedia variant="image">
          <QuoteThumb item={first} />
        </ItemMedia>
      )}
      <ItemContent>
        <ItemTitle>
          <span className="sr-only">Reply to </span>
          {name}
        </ItemTitle>
        <ItemDescription>{text}</ItemDescription>
      </ItemContent>
    </Item>
  )
}

/** 引用里的缩略图：预览图（贴纸没有预览图，就是它本身）；秘密聊天的解开之前显示 ThumbHash 占位 */
function QuoteThumb({ item }: { item: AlbumItem | Sticker }) {
  const secret = 'secret' in item ? (item.secret as string) : null
  const [key, role] = item.type === 'sticker' ? [item.key, 'main' as const] : [item.preview_key, 'preview' as const]
  const [sealed] = useSealedUrls([secret ? { key, secret, role } : null])
  const src = secret ? (sealed ?? thumbhashUrl(item.thumbhash)) : mediaUrl(key)
  return <img src={src} alt="" {...mediaImgProps} />
}

/** 秘密聊天里还没解开、解不开的消息的占位 */
const SECRET_PLACEHOLDER = { cipher: 'Decrypting…', broken: 'Couldn’t decrypt this message' } as const
/** 解开通常不到一秒；这么久还没解开，多半是本设备还没拿到密钥 */
const CIPHER_PATIENCE_MS = 10_000

/** 还没解开的消息：先显示 Decrypting…，久了说明在等什么 */
function CipherNotice() {
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), CIPHER_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [])
  return waiting ? 'Waiting for this device to get the key. The message will appear then.' : SECRET_PLACEHOLDER.cipher
}

const SEALED_NOTICE = 'Messages sent before this device joined the chat can’t be read here.'


/** 服务消息、撤回与秘密聊天的占位：居中显示，不是气泡 */
function isNotice(row: MessageRow) {
  return row.kind === 'service' || row.kind === 'recalled' || row.kind === 'cipher' || row.kind === 'broken'
}

/** 消息的占位：与消息列表同样的间距，气泡与一两行文字的气泡同样大小 */
function MessagesSkeleton() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-end gap-1 p-3">
      <BubbleSkeleton className="w-1/2" />
      <BubbleSkeleton className="w-2/5 self-end" />
      <BubbleSkeleton lines={2} className="w-3/5" />
      <BubbleSkeleton className="w-1/3 self-end" />
    </div>
  )
}

/** lines 行文字的气泡 */
function BubbleSkeleton({ lines = 1, className }: { lines?: 1 | 2; className?: string }) {
  return (
    <Skeleton variant="bubble" className={className}>
      <div className={lines === 2 ? 'h-[2lh]' : 'h-[1lh]'} />
    </Skeleton>
  )
}
