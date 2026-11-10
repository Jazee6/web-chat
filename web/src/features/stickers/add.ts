import { MAX_STICKER_BYTES, MAX_STICKERS } from 'shared/protocol'

import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { mediaImgProps } from '@/features/media/media-url'
import { formatBytes } from '@/lib/format'
import { OpFailure, call } from '@/sync/client'
import { randomId } from '@/sync/logic'
import { StickerError, prepareSticker } from './prepare'

const COUNT_SQL = 'SELECT count(*) AS n FROM stickers'

/**
 * 把一张图片添加到我的贴纸：source 为图片地址（会话里的图片）或本机选的文件。
 * 先看本地的数量，满了就不必处理与上传。结果用 Toast 告知
 */
export async function addStickerFromImage(source: string | Blob) {
  try {
    const [row] = await call('query', { sql: COUNT_SQL, params: [] })
    if (Number(row?.n ?? 0) >= MAX_STICKERS) {
      toast.add({ type: 'error', title: "Couldn't add the sticker", description: describe(new OpFailure('sticker_limit')) })
      return
    }
    const blob = typeof source === 'string' ? await fetchImage(source) : source
    // random_id 在这里生成：换 Leader 时重放的请求会重新上传，服务端据此不加出第二张
    await call('addSticker', { sticker: await prepareSticker(blob), randomId: randomId() })
    toast.add({ type: 'success', title: 'Added to stickers' })
  } catch (e) {
    toast.add({ type: 'error', title: "Couldn't add the sticker", description: describe(e) })
  }
}

/** 把一条贴纸消息里的贴纸添加到我的贴纸：引用同一张，不重新上传 */
export async function addStickerFromMessage(chatId: string, seq: number) {
  try {
    await call('addSticker', { chatId, seq })
    toast.add({ type: 'success', title: 'Added to stickers' })
  } catch (e) {
    toast.add({ type: 'error', title: "Couldn't add the sticker", description: describe(e) })
  }
}

function describe(e: unknown) {
  if (e instanceof StickerError) {
    return e.reason === 'too_large' ? `Stickers can be up to ${formatBytes(MAX_STICKER_BYTES)}.` : 'This image can’t be used as a sticker.'
  }
  return opErrorMessage(e, 'Try again.')
}

async function fetchImage(url: string) {
  const res = await fetch(url, { referrerPolicy: mediaImgProps.referrerPolicy })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  return res.blob()
}
