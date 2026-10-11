import { useState, type CSSProperties } from 'react'
import { ListIcon, PinIcon, PinOffIcon } from 'lucide-react'

import { ResponsiveDialog } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { opErrorMessage } from '@/features/groups/errors'
import type { UserInfo } from '@/hooks/use-users'
import { describeMediaJson } from '@/lib/media-text'
import { revealMotion, riseMotion } from '@/lib/presence'
import { call } from '@/sync/client'

/** 置顶着的消息，后置顶的在前 */
export type PinnedRow = { seq: number; sender_id: string; text: string | null; media: string | null }

export const PINNED_SQL = `
  SELECT seq, sender_id, text, media FROM messages
  WHERE chat_id = ? AND pinned_at IS NOT NULL
  ORDER BY pinned_at DESC, seq DESC`

const summary = (row: PinnedRow) => (row.media ? describeMediaJson(row.media) : (row.text ?? ''))

/**
 * 标题栏下方的置顶条：显示一条置顶消息，点击定位过去并换成更早的一条（到头后从最新的重新开始）；
 * 右侧按钮打开全部置顶的列表
 */
export function PinnedBar({
  top,
  chatId,
  pinned,
  canPin,
  meId,
  users,
  onJump,
}: {
  /** 离页面顶部的距离：标题栏，加上方可能还有的群组通话横条 */
  top: number
  chatId: string
  pinned: PinnedRow[]
  /** 能否取消置顶：群主或私聊双方 */
  canPin: boolean
  meId: string
  users: Map<string, UserInfo>
  onJump: (seq: number) => void
}) {
  const [index, setIndex] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  // 置顶列表变短时（取消置顶）从头开始
  const i = index < pinned.length ? index : 0
  const current = pinned[i]
  if (!current) return null

  const unpin = (seq: number) =>
    call('unpinMessage', { chatId, seq }).catch((e: unknown) =>
      toast.add({ type: 'error', title: "Couldn't unpin the message", description: opErrorMessage(e, 'Try again.') }),
    )

  return (
    // 出现时从上往下展开；上方多了或少了群组通话的横条时平滑挪到新位置
    <div
      ref={revealMotion}
      className="app-blur absolute inset-x-0 top-(--top) z-10 flex h-16 items-center gap-1 px-3 transition-all duration-standard ease-enter"
      style={{ '--top': `${top}px` } as CSSProperties}
    >
      <Item
        variant="quote"
        size="xs"
        render={<button type="button" />}
        className="min-w-0 flex-1 cursor-pointer overflow-hidden text-left hover:bg-current/15"
        onClick={() => {
          onJump(current.seq)
          setIndex((i + 1) % pinned.length)
        }}
      >
        <ItemMedia variant="icon">
          <PinIcon />
        </ItemMedia>
        {/* 换到下一条时新的从下面升上来，旧的往上离开 */}
        <ItemContent key={current.seq} ref={riseMotion} className="min-w-0">
          <ItemTitle>{pinned.length > 1 ? `Pinned message ${i + 1} of ${pinned.length}` : 'Pinned message'}</ItemTitle>
          <ItemDescription>{summary(current)}</ItemDescription>
        </ItemContent>
      </Item>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => setListOpen(true)} />}>
          <ListIcon />
          <span className="sr-only">All pinned messages</span>
        </TooltipTrigger>
        <TooltipContent>All pinned messages</TooltipContent>
      </Tooltip>
      <ResponsiveDialog
        open={listOpen}
        onOpenChange={setListOpen}
        title="Pinned messages"
        description={pinned.length === 1 ? '1 pinned message' : `${pinned.length} pinned messages`}
      >
        {(Footer) => (
          <>
            <div className="px-4 md:px-0">
              <ItemGroup>
                {/* 定位按钮与取消置顶按钮并排：按钮不能嵌套 */}
                {pinned.map((row) => (
                  <div key={row.seq} className="flex items-center gap-1">
                    <Item
                      variant="outline"
                      size="sm"
                      render={<button type="button" />}
                      className="min-w-0 flex-1 cursor-pointer text-left hover:bg-muted"
                      onClick={() => {
                        setListOpen(false)
                        onJump(row.seq)
                      }}
                    >
                      <ItemContent className="min-w-0">
                        <ItemTitle>{row.sender_id === meId ? 'You' : (users.get(row.sender_id)?.name ?? 'Someone')}</ItemTitle>
                        <ItemDescription>{summary(row)}</ItemDescription>
                      </ItemContent>
                    </Item>
                    {canPin && (
                      <Tooltip>
                        <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => void unpin(row.seq)} />}>
                          <PinOffIcon />
                          <span className="sr-only">Unpin</span>
                        </TooltipTrigger>
                        <TooltipContent>Unpin</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </ItemGroup>
            </div>
            <Footer>
              <Button variant="outline" onClick={() => setListOpen(false)}>
                Done
              </Button>
            </Footer>
          </>
        )}
      </ResponsiveDialog>
    </div>
  )
}
