import { useState } from 'react'
import { CheckIcon, StickerIcon } from 'lucide-react'
import { STICKER_SIZE, type SealedMedia, type Sticker } from 'shared/protocol'

import { ResponsiveDialog } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { mediaImgProps, mediaUrl } from '@/features/media/media-url'
import { useSealedUrls } from '@/features/secret/sealed-media'
import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'
import { addStickerFromMessage } from './add'

/** 贴纸在会话里显示的长边 */
const STICKER_DISPLAY = 160

type SealedSticker = Extract<SealedMedia, { type: 'sticker' }>

/**
 * 按长边 size 显示一张贴纸（放不下时按比例缩到可用宽度）：没有底色，透明处透出背景；
 * 还没取到（秘密聊天解开之前）时显示同样大小的 Skeleton
 */
export function StickerImage({ src, w, h, size = STICKER_DISPLAY }: { src: string | null; w: number; h: number; size?: number }) {
  const style = { '--w': `${Math.round((w * size) / Math.max(w, h))}px`, '--ratio': w / h } as React.CSSProperties
  if (!src) return <Skeleton className="aspect-(--ratio) w-(--w) max-w-full" style={style} />
  return (
    <img
      src={src}
      alt="Sticker"
      {...mediaImgProps}
      decoding="async"
      draggable={false}
      className="aspect-(--ratio) w-(--w) max-w-full rounded-xl object-contain"
      style={style}
    />
  )
}

/**
 * 已发送的贴纸消息：点开是放大的预览，可以添加到我的贴纸（chatId / seq 为这条消息；秘密聊天里不给，不能添加）。
 * 秘密聊天的贴纸取回后解开
 */
export function StickerMessage({ sticker, chatId, seq }: { sticker: Sticker | SealedSticker; chatId?: string; seq?: number }) {
  const [open, setOpen] = useState(false)
  const [sealed] = useSealedUrls(['secret' in sticker ? { key: sticker.key, secret: sticker.secret, role: 'main', type: sticker.mime } : null])
  const src = 'secret' in sticker ? sealed! : mediaUrl(sticker.key)
  return (
    <>
      <button type="button" className="block cursor-zoom-in" aria-label="Open sticker" onClick={() => setOpen(true)}>
        <StickerImage src={src} w={sticker.w} h={sticker.h} />
      </button>
      {open && (
        <StickerPreview
          src={src}
          sticker={sticker}
          save={chatId !== undefined && seq !== undefined ? { chatId, seq } : null}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}

const SAVED_SQL = 'SELECT 1 AS x FROM stickers WHERE key = ?'

/** 放大的预览（原尺寸，长边最大 STICKER_SIZE）：save 为 null 时不能添加 */
function StickerPreview({
  src,
  sticker,
  save,
  onOpenChange,
}: {
  src: string | null
  sticker: Sticker | SealedSticker
  save: { chatId: string; seq: number } | null
  onOpenChange: (open: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  const saved = (useLiveQuery(SAVED_SQL, [sticker.key], [topics.stickers])?.length ?? 0) > 0
  const add = async () => {
    if (!save) return
    setAdding(true)
    await addStickerFromMessage(save.chatId, save.seq)
    setAdding(false)
  }
  return (
    <ResponsiveDialog
      open
      onOpenChange={onOpenChange}
      title="Sticker"
      description={save ? 'Add it to your stickers to send it anytime.' : 'Stickers in secret chats can’t be saved.'}
    >
      {(Footer) => (
        <>
          {/* 没有底部时自己留出 Drawer 的下边距 */}
          <div className={save ? 'flex justify-center px-4 md:px-0' : 'flex justify-center px-4 pb-4 md:p-0'}>
            <StickerImage src={src} w={sticker.w} h={sticker.h} size={Math.min(STICKER_SIZE, Math.max(sticker.w, sticker.h))} />
          </div>
          {save && (
            <Footer>
              <Button disabled={adding || saved} onClick={() => void add()}>
                {adding ? <Spinner data-icon="inline-start" /> : saved ? <CheckIcon data-icon="inline-start" /> : <StickerIcon data-icon="inline-start" />}
                {saved ? 'In your stickers' : 'Add to stickers'}
              </Button>
            </Footer>
          )}
        </>
      )}
    </ResponsiveDialog>
  )
}
