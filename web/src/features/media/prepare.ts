// 附件的本地预处理：加入附件栏时就开始，不联网。图片压缩成大图与预览图并算出 ThumbHash，文件保持原样。
// 见 docs/architecture/05-media.md § 客户端处理
import { rgbaToThumbHash } from 'thumbhash'
import { PHOTO_SIZE, PREVIEW_SIZE } from 'shared/protocol'

import type { OutgoingMedia } from '@/sync/bridge'

const PHOTO_QUALITY = 0.85
const PREVIEW_QUALITY = 0.8
/** ThumbHash 要求输入不超过 100×100 */
const THUMBHASH_SIZE = 100

/** 按图片处理的格式：浏览器解码失败的（例如 Chrome 里的 HEIC）改为按文件发送 */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/gif', 'image/bmp'])

export function isPhotoCandidate(file: File) {
  return PHOTO_TYPES.has(file.type)
}

/** 压缩一张图片；解码失败返回 null，由调用方改为按文件发送 */
export async function preparePhoto(file: File): Promise<Extract<OutgoingMedia, { type: 'photo' }> | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const preview = await encode(bitmap, PREVIEW_SIZE, PREVIEW_QUALITY)
    const thumbhash = thumbhashOf(bitmap)
    // GIF 原样上传以保留动画，预览图取第一帧
    if (file.type === 'image/gif') {
      return {
        type: 'photo',
        file,
        mime: 'image/gif',
        preview: preview.blob,
        preview_mime: preview.mime,
        w: bitmap.width,
        h: bitmap.height,
        thumbhash,
      }
    }
    const full = await encode(bitmap, PHOTO_SIZE, PHOTO_QUALITY)
    return {
      type: 'photo',
      file: full.blob,
      mime: full.mime,
      preview: preview.blob,
      preview_mime: preview.mime,
      w: full.w,
      h: full.h,
      thumbhash,
    }
  } finally {
    bitmap.close()
  }
}

/** 链接预览卡片的图片：只压缩成预览图的大小；解码失败（例如不是图片）返回 null。标签页与同步 Worker 都会调用 */
export async function prepareLinkPhoto(blob: Blob) {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  try {
    const { blob: out, mime, w, h } = await encode(bitmap, PREVIEW_SIZE, PREVIEW_QUALITY)
    return { blob: out, mime, w, h, thumbhash: thumbhashOf(bitmap) }
  } finally {
    bitmap.close()
  }
}

/** 视频的封面：一帧画面压缩成预览图并算出 ThumbHash。在转码的 Web Worker 里调用 */
export async function prepareCover(frame: Frame) {
  const { blob, mime } = await encode(frame, PREVIEW_SIZE, PREVIEW_QUALITY)
  return { blob, mime, thumbhash: thumbhashOf(frame) }
}

export function prepareFile(file: File): Extract<OutgoingMedia, { type: 'file' }> {
  return { type: 'file', file, name: file.name || 'file', mime: validMime(file.type) }
}

/** 浏览器给出的类型可能为空或不规范，服务端只接受 type/subtype */
function validMime(type: string) {
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) && type.length <= 127 ? type : 'application/octet-stream'
}

/** 可以画到画布上、有尺寸的画面：图片解码结果，或视频解出的一帧 */
type Frame = ImageBitmap | OffscreenCanvas | HTMLCanvasElement

export function fit(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/**
 * 缩放到长边不超过 max 后编码为 WebP；浏览器不支持编码 WebP 时（Safari）退回 JPEG。
 * JPEG 没有透明通道，透明区域会变黑，所以先铺白底
 */
async function encode(bitmap: Frame, max: number, quality: number) {
  const { w, h } = fit(bitmap.width, bitmap.height, max)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality })
  if (webp.type === 'image/webp') return { blob: webp, mime: 'image/webp' as const, w, h }

  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return { blob: jpeg, mime: 'image/jpeg' as const, w, h }
}

export function thumbhashOf(bitmap: Frame) {
  const { w, h } = fit(bitmap.width, bitmap.height, THUMBHASH_SIZE)
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const hash = rgbaToThumbHash(w, h, ctx.getImageData(0, 0, w, h).data)
  return btoa(String.fromCharCode(...hash))
}
