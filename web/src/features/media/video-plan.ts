// 视频怎么处理：只重新封装、重新编码，还是太长发不了。不依赖 mediabunny，可以单独测试。
// 见 docs/architecture/05-media.md § 视频
import { MAX_MEDIA_BYTES, MAX_VIDEO_SECONDS, VIDEO_SIZE } from 'shared/protocol'

/** 满画质的视频码率：长边 1280 的 H.264 */
export const VIDEO_BITRATE = 2_000_000
/** 码率最低降到这里，再低就算太长 */
export const MIN_VIDEO_BITRATE = 700_000
export const AUDIO_BITRATE = 96_000
/** 帧率上限，略高于它的（29.97 / 30.0x）不算超出 */
const MAX_FRAME_RATE = 30
/** 给 MP4 容器与码率波动留的余量：只按上限的 90% 分配码率 */
const BUDGET_RATIO = 0.9

export type VideoSource = {
  /** mediabunny 的编码名：avc、hevc、vp9…；未知为 null */
  codec: string | null
  /** 没有音轨为 undefined，未知编码为 null */
  audioCodec?: string | null
  /** 显示尺寸（已按旋转换算） */
  width: number
  height: number
  frameRate: number
  /** 秒 */
  duration: number
  /** 原文件的字节数 */
  size: number
}

export type VideoPlan =
  | { kind: 'remux' }
  | { kind: 'transcode'; width: number; height: number; frameRate?: number; videoBitrate: number }
  | { kind: 'too_long' }

export function planVideo(src: VideoSource): VideoPlan {
  if (src.duration > MAX_VIDEO_SECONDS) return { kind: 'too_long' }
  const fps = src.frameRate > MAX_FRAME_RATE + 1 ? MAX_FRAME_RATE : undefined
  const fits = Math.max(src.width, src.height) <= VIDEO_SIZE
  const compatible = src.codec === 'avc' && (src.audioCodec === undefined || src.audioCodec === 'aac')
  if (compatible && fits && fps === undefined && src.size <= MAX_MEDIA_BYTES) return { kind: 'remux' }

  const audio = src.audioCodec === undefined ? 0 : AUDIO_BITRATE
  const budget = (MAX_MEDIA_BYTES * 8 * BUDGET_RATIO) / Math.max(1, src.duration) - audio
  if (budget < MIN_VIDEO_BITRATE) return { kind: 'too_long' }
  const { width, height } = scaleEven(src.width, src.height, VIDEO_SIZE)
  return { kind: 'transcode', width, height, ...(fps ? { frameRate: fps } : {}), videoBitrate: Math.min(VIDEO_BITRATE, Math.floor(budget)) }
}

/** 缩放到长边不超过 max，宽高都取偶数：H.264 编码器不接受奇数尺寸 */
export function scaleEven(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h))
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(w), height: even(h) }
}

/** 消息里的时长：整秒，至少 1 */
export const videoSeconds = (duration: number) => Math.max(1, Math.round(duration))
