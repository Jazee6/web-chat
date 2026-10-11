import { mediaImgProps } from './media-url'

/**
 * 复制图片：剪贴板普遍只收 PNG，取回后转成 PNG（GIF 只剩第一帧）。
 * ClipboardItem 要在点击的同一轮里创建（Safari），图片数据以 Promise 交给它
 */
export async function copyImage(url: string) {
  const png = (async () => {
    const res = await fetch(url, { referrerPolicy: mediaImgProps.referrerPolicy })
    if (!res.ok) throw new Error(`copy failed: ${res.status}`)
    const blob = await res.blob()
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      return await canvas.convertToBlob({ type: 'image/png' })
    } finally {
      bitmap.close()
    }
  })()
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
