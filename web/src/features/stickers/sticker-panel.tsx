import { useRef, useState, type RefObject } from 'react'
import { PlusIcon, StickerIcon, Trash2Icon } from 'lucide-react'
import { MAX_STICKERS, type SavedSticker } from 'shared/protocol'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { useIsMobile } from '@/hooks/use-mobile'
import { mediaUrl } from '@/features/media/media-url'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { addStickerFromImage } from './add'
import { StickerImage } from './sticker-message'

const STICKERS_SQL = "SELECT 'sticker' AS type, key, mime, w, h, size, thumbhash, added_at FROM stickers ORDER BY added_at DESC"

/** 面板里贴纸的长边，也是每格的最小边长 */
const CELL = 64

/**
 * 我的贴纸：桌面为输入框上方的弹出面板（anchor 为输入框），手机为 Drawer。点一张立即发出（onSend），面板随之关闭；
 * 「+」从本机选图片添加；右键或长按一张可以移除。新加的排在前面
 */
export function StickerPanel({
  anchor,
  open,
  onOpenChange,
  onSend,
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSend: (sticker: SavedSticker) => void
}) {
  const isMobile = useIsMobile()
  const stickers = useLiveQuery<SavedSticker>(STICKERS_SQL, [], [topics.stickers])
  const inputRef = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const full = (stickers?.length ?? 0) >= MAX_STICKERS

  const add = async (file: File | undefined) => {
    if (!file) return
    setAdding(true)
    await addStickerFromImage(file)
    setAdding(false)
  }
  const remove = (key: string) =>
    call('removeSticker', { key }).catch((e: unknown) =>
      toast.add({ type: 'error', title: "Couldn't remove the sticker", description: opErrorMessage(e, 'Try again.') }),
    )
  const pick = () => inputRef.current?.click()

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        void add(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )
  const addAction = stickers && stickers.length > 0 && (
    <Button variant="ghost" size="icon-sm" aria-label="Add sticker" disabled={adding || full} onClick={pick}>
      {adding ? <Spinner /> : <PlusIcon />}
    </Button>
  )
  const content = (
    <>
      {!stickers ? (
        // 与下面的网格同样的格子
        <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : stickers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StickerIcon />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>No stickers yet</EmptyTitle>
            <EmptyDescription>Add an image from this device, or add photos and stickers from chats.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" disabled={adding} onClick={pick}>
              {adding ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              Add Sticker
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // 方格铺满面板宽度、间距很小；悬停时盖一层蒙层
        <ScrollArea className="max-h-72">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-1">
            {stickers.map((s) => (
              <ContextMenu key={s.key}>
                <ContextMenuTrigger
                  render={<Button variant="overlay" size="tile" aria-label="Send sticker" />}
                  onClick={() => onSend(s)}
                >
                  <StickerImage src={mediaUrl(s.key)} w={s.w} h={s.h} size={CELL} />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem variant="destructive" onClick={() => void remove(s.key)}>
                    <Trash2Icon />
                    Remove
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </ScrollArea>
      )}
    </>
  )

  // 手机上从底部拉出 Drawer，桌面贴着输入框上方弹出；都只在点外面、按 Esc、下拉（Drawer）与发出贴纸时关闭
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(next, details) => (next || !inContextMenu(details.event)) && onOpenChange(next)}>
        <DrawerContent aria-label="Stickers">
          {fileInput}
          {/* 标题与其他 Drawer 一样居中，两侧各留一个图标按钮的宽度 */}
          <DrawerHeader>
            <div className="grid grid-cols-[2rem_1fr_2rem] items-center">
              <span />
              <DrawerTitle>Stickers</DrawerTitle>
              {addAction}
            </div>
          </DrawerHeader>
          <div className="flex flex-col px-4 pb-4">{content}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // 从菜单打开时焦点会回到「+」按钮，不能因此关掉面板
        if (!next && details.reason === 'focus-out') return
        if (!next && inContextMenu(details.event)) return
        onOpenChange(next)
      }}
    >
      <PopoverContent anchor={anchor} side="top" align="start" layout="panel" aria-label="Stickers">
        {fileInput}
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>Stickers</PopoverTitle>
          {addAction}
        </PopoverHeader>
        {content}
      </PopoverContent>
    </Popover>
  )
}

/** 点的是移除贴纸的右键菜单：它在面板之外，但不算点外面 */
function inContextMenu(event: Event | undefined) {
  const target = event?.target
  return target instanceof Element && target.closest('[data-slot=context-menu-content]') !== null
}
