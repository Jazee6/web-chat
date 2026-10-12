import { thumbHashToDataURL } from 'thumbhash'
import { MEDIA_ORIGIN } from '@/lib/deploy'

/** 对象键 → 公开地址（直接命中 CDN，不经过 Worker） */
export function mediaUrl(key: string) {
  return `${MEDIA_ORIGIN}/${key}`
}

/**
 * 媒体图片的加载方式：
 * - 一律以 CORS 方式加载。不带 Origin 的响应里没有 Vary: Origin，以 no-cors 方式进了浏览器缓存的图，
 *   查看器再用 fetch 下载时会因为缺少 Access-Control-Allow-Origin 失败
 * - 不带 Referer。jaze.top 区域开着防盗链，Referer 不是本站时 .gif / .jpg / .png 返回 403（开发环境的 localhost 即是）；
 *   也不必把会话地址发给 CDN
 */
export const mediaImgProps = { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' } as const

const placeholders = new Map<string, string>()

/** ThumbHash（base64）→ 占位图的 data URL；同一张图在列表里反复渲染，结果缓存起来 */
export function thumbhashUrl(thumbhash: string) {
  let url = placeholders.get(thumbhash)
  if (!url) {
    url = thumbHashToDataURL(Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0)))
    placeholders.set(thumbhash, url)
  }
  return url
}
