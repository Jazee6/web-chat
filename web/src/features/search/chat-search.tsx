import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileIcon, HistoryIcon, SearchIcon } from 'lucide-react'
import { MAX_PAGE_LIMIT } from 'shared/protocol'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMe } from '@/features/auth/me'
import { useDebounced } from '@/hooks/use-debounced'
import { useIsMobile } from '@/hooks/use-mobile'
import { useUsers } from '@/hooks/use-users'
import { formatDialogDate } from '@/lib/format'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { Highlighted } from './highlighted'
import { LoadMore } from './load-more'
import { messageSearch, searchTerms, type MessageHit } from './sql'

/** 结果每次加载的条数 */
const PAGE = 50
const TITLE = 'Search messages'
const DESCRIPTION = 'Search this chat’s messages on this device.'

/**
 * 会话内搜索：标题栏的按钮或 Cmd/Ctrl+F 打开。选中一条就关闭并定位到它。
 * 关键词与选中项在离开会话前一直保留（组件随会话切换重建）
 */
export function ChatSearch({ chatId }: { chatId: string }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
      }
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [])

  const jump = (seq: number) => {
    setOpen(false)
    void navigate({ to: '/c/$chatId', params: { chatId }, search: { m: seq }, replace: true, viewTransition: false })
  }

  const command = (
    // 关闭时结果随之卸载，cmdk 会把选中项清空：关闭期间不接受
    <Command label={TITLE} shouldFilter={false} value={selected} onValueChange={(value) => open && setSelected(value)}>
      <CommandInput ref={inputRef} placeholder="Search" value={query} onValueChange={setQuery} />
      {/* 关闭时卸载：补齐历史随之停止 */}
      {open && <Results chatId={chatId} query={query} selected={selected} onRestore={setSelected} onSelect={jump} />}
    </Command>
  )

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => setOpen(true)} />}>
          <SearchIcon />
          <span className="sr-only">{TITLE}</span>
        </TooltipTrigger>
        <TooltipContent>{TITLE}</TooltipContent>
      </Tooltip>
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          {/* 触屏打开时默认只聚焦弹层（不弹键盘）；搜索就是要输入，直接聚焦输入框 */}
          <DrawerContent initialFocus={inputRef}>
            <DrawerHeader className="sr-only">
              <DrawerTitle>{TITLE}</DrawerTitle>
              <DrawerDescription>{DESCRIPTION}</DrawerDescription>
            </DrawerHeader>
            {command}
          </DrawerContent>
        </Drawer>
      ) : (
        // 不用 CommandDialog：它把隐藏的标题放在弹窗外面，关着时也留在无障碍树里
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent variant="command" showCloseButton={false}>
            <DialogHeader className="sr-only">
              <DialogTitle>{TITLE}</DialogTitle>
              <DialogDescription>{DESCRIPTION}</DialogDescription>
            </DialogHeader>
            {command}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/**
 * 搜索打开期间挂载：补齐历史的循环在这里，改关键词不会打断，关闭搜索时停止。
 * 重新打开时 Command 是新挂载的，cmdk 会自动选中第一项；打开前的选中项记在 restore 里，结果到达后恢复
 */
function Results({
  chatId,
  query,
  selected,
  onRestore,
  onSelect,
}: {
  chatId: string
  query: string
  selected: string
  onRestore: (value: string) => void
  onSelect: (seq: number) => void
}) {
  const terms = searchTerms(useDebounced(query, 150))
  const backfill = useBackfill(chatId)
  const restore = useRef(selected)
  // 输入框外框只留了上与两侧的 p-1：列表上方补 4px，没有结果时输入框四周与弹窗等距，有结果时列表项与输入框左右对齐
  return (
    <CommandList className="mt-1">
      {terms.length > 0 && (
        <Hits
          key={terms.join(' ')}
          chatId={chatId}
          terms={terms}
          backfill={backfill}
          restore={restore}
          onRestore={onRestore}
          onSelect={onSelect}
        />
      )}
    </CommandList>
  )
}

type Backfill = { running: boolean; start: () => void }

function Hits({
  chatId,
  terms,
  backfill,
  restore,
  onRestore,
  onSelect,
}: {
  chatId: string
  terms: string[]
  backfill: Backfill
  /** 只在第一批结果到达时用一次 */
  restore: RefObject<string>
  onRestore: (value: string) => void
  onSelect: (seq: number) => void
}) {
  const me = useMe()
  const users = useUsers()
  const [limit, setLimit] = useState(PAGE)
  const search = messageSearch(terms, { chatId, limit })
  const hits = useLiveQuery<MessageHit>(search.sql, search.params, [topics.chat(chatId), topics.users])
  // 加载更多会换一个查询：新结果到达前继续显示旧结果
  const [shown, setShown] = useState(hits)
  if (hits !== undefined && hits !== shown) setShown(hits)
  const minSeq = useLiveQuery<{ min_seq: number }>('SELECT min_seq FROM chats WHERE chat_id = ?', [chatId], [
    topics.chat(chatId),
  ])?.[0]?.min_seq

  const itemsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shown || restore.current === '') return
    // cmdk 在结果项挂载后才自动选中第一项：等它选完再恢复
    const frame = requestAnimationFrame(() => {
      const value = restore.current
      restore.current = ''
      if (!shown.some((hit) => String(hit.seq) === value)) return
      onRestore(value)
      requestAnimationFrame(() =>
        itemsRef.current?.querySelector(`[data-value="${value}"]`)?.scrollIntoView({ block: 'nearest' }),
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [shown, restore, onRestore])

  if (!shown) return null
  const incomplete = minSeq !== undefined && minSeq > 1

  return (
    <>
      {shown.length === 0 && !incomplete && <CommandEmpty>No messages found.</CommandEmpty>}
      {shown.length > 0 && (
        <CommandGroup ref={itemsRef}>
          {shown.map((hit) => (
            <CommandItem key={hit.seq} value={String(hit.seq)} showCheck={false} onSelect={() => onSelect(hit.seq)}>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {hit.sender_id === me.id ? 'You' : (users.get(hit.sender_id)?.name ?? 'Someone')}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDialogDate(hit.date)}</span>
                </div>
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  {hit.kind === 'media' && <FileIcon />}
                  <span className="truncate">
                    <Highlighted text={hit.body} terms={terms} />
                  </span>
                </span>
              </div>
            </CommandItem>
          ))}
          {shown.length >= limit && <LoadMore onVisible={() => setLimit(shown.length + PAGE)} />}
        </CommandGroup>
      )}
      {incomplete && (
        <CommandGroup heading={shown.length === 0 ? 'No matches on this device' : undefined}>
          <BackfillItem chatId={chatId} minSeq={minSeq} backfill={backfill} />
        </CommandGroup>
      )}
    </>
  )
}

/** 本设备上的历史不完整时补齐：逐页拉取更早的消息，直到会话开头；卸载时停止 */
function useBackfill(chatId: string): Backfill {
  const [running, setRunning] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const start = async () => {
    setRunning(true)
    try {
      while (alive.current) {
        const { done } = await call('loadOlder', { chatId, limit: MAX_PAGE_LIMIT })
        if (done) break
      }
    } catch {
      if (alive.current) toast.add({ type: 'error', title: "Couldn't load older messages" })
    } finally {
      if (alive.current) setRunning(false)
    }
  }

  return { running, start: () => void start() }
}

function BackfillItem({ chatId, minSeq, backfill }: { chatId: string; minSeq: number; backfill: Backfill }) {
  const topSeq = useLiveQuery<{ top_seq: number }>('SELECT top_seq FROM dialogs WHERE chat_id = ?', [chatId], [
    topics.dialogs,
  ])?.[0]?.top_seq

  let label: ReactNode = (
    <>
      <HistoryIcon />
      Search older messages
    </>
  )
  if (backfill.running) {
    const loaded = topSeq ? Math.round(((topSeq - minSeq + 1) / topSeq) * 100) : 0
    label = (
      <Progress value={loaded} aria-label="Loading older messages" className="w-full">
        <span className="text-muted-foreground">Loading older messages…</span>
      </Progress>
    )
  }

  return (
    <CommandItem value="backfill" showCheck={false} onSelect={() => !backfill.running && backfill.start()}>
      {label}
    </CommandItem>
  )
}
