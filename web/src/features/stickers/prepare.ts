// 要添加到我的贴纸的图片：在标签页里处理好再交给同步 Worker 上传。
// 见 docs/architecture/05-media.md § 贴纸
import { MAX_STICKER_BYTES, STICKER_SIZE } from 'shared/protocol'

import { fit, thumbhashOf } from '@/features/media/prepare'
import type { PreparedSticker } from '@/sync/bridge'

const STICKER_QUALITY = 0.9

/** 处理不了：浏览器解码不了（unsupported），或 GIF 与处理后的图超过 MAX_STICKER_BYTES（too_large） */
export class StickerError extends Error {
  readonly reason: 'unsupported' | 'too_large'

  constructor(reason: 'unsupported' | 'too_large') {
    super(reason)
    this.reason = reason
  }
}

/**
 * 静态图缩到长边 STICKER_SIZE 以内（不放大），编码为 WebP；浏览器编不了 WebP 时（Safari）得到的是 PNG，都保留透明。
 * GIF 原样保留动画
 */
export async function prepareSticker(blob: Blob): Promise<PreparedSticker> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    throw new StickerError('unsupported')
  }
  try {
    const thumbhash = thumbhashOf(bitmap)
    if (blob.type === 'image/gif') {
      if (blob.size > MAX_STICKER_BYTES) throw new StickerError('too_large')
      return { file: blob, mime: 'image/gif', w: bitmap.width, h: bitmap.height, thumbhash }
    }
    const { w, h } = fit(bitmap.width, bitmap.height, STICKER_SIZE)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    // 不支持的格式按规范退回 PNG
    let file = await canvas.convertToBlob({ type: 'image/webp', quality: STICKER_QUALITY })
    if (file.type !== 'image/webp' && file.type !== 'image/png') file = await canvas.convertToBlob({ type: 'image/png' })
    if (file.size > MAX_STICKER_BYTES) throw new StickerError('too_large')
    return { file, mime: file.type === 'image/webp' ? 'image/webp' : 'image/png', w, h, thumbhash }
  } finally {
    bitmap.close()
  }
}
