// 视频转码的 Web Worker：一次处理一个视频，处理完由标签页结束；中途删除附件时标签页直接 terminate。
// mediabunny 只在这里引入，不进主包。见 docs/architecture/05-media.md § 视频
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type InputVideoTrack,
} from 'mediabunny'
import { MAX_MEDIA_BYTES, PREVIEW_SIZE } from 'shared/protocol'

import { prepareCover } from './prepare'
import { AUDIO_BITRATE, planVideo, scaleEven, videoSeconds } from './video-plan'

/** 标签页 → Worker：要处理的视频 */
export type VideoRequest = { file: File }
/** 处理好的视频；unsupported：浏览器解码或编码不了；too_long：压到最低码率也超过大小上限 */
export type VideoResult =
  | {
      ok: true
      file: Blob
      preview: Blob
      preview_mime: 'image/webp' | 'image/jpeg'
      w: number
      h: number
      duration: number
      thumbhash: string
    }
  | { ok: false; reason: 'unsupported' | 'too_long' }
/** Worker → 标签页：转码进度（0–1）与最后的结果 */
export type VideoMessage = { type: 'progress'; progress: number } | { type: 'done'; result: VideoResult }

/** 帧率只需要估计：读开头这些帧 */
const FPS_SAMPLE_PACKETS = 60
/** AAC 只支持这些采样率，其他的重采样到 48kHz */
const AAC_SAMPLE_RATES = new Set([44100, 48000])

const post = (message: VideoMessage) => self.postMessage(message)

self.onmessage = (e: MessageEvent<VideoRequest>) => {
  process(e.data.file).then(
    (result) => post({ type: 'done', result }),
    (err: unknown) => {
      console.error('video processing failed', err)
      post({ type: 'done', result: { ok: false, reason: 'unsupported' } })
    },
  )
}

async function process(file: File): Promise<VideoResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    return await convert(input, file.size)
  } finally {
    input.dispose()
  }
}

async function convert(input: Input, size: number): Promise<VideoResult> {
  const video = await input.getPrimaryVideoTrack()
  if (!video || !(await video.canDecode())) return { ok: false, reason: 'unsupported' }
  const audio = await input.getPrimaryAudioTrack()
  if (audio && !(await audio.canDecode())) return { ok: false, reason: 'unsupported' }

  const duration = await input.computeDuration()
  const { averagePacketRate } = await video.computePacketStats(FPS_SAMPLE_PACKETS)
  const plan = planVideo({
    codec: video.codec,
    ...(audio ? { audioCodec: audio.codec } : {}),
    width: video.displayWidth,
    height: video.displayHeight,
    frameRate: averagePacketRate,
    duration,
    size,
  })
  if (plan.kind === 'too_long') return { ok: false, reason: 'too_long' }

  // 先做封面：转码要很久，封面出错时早点失败
  const cover = await coverOf(video)
  if (!cover) return { ok: false, reason: 'unsupported' }

  let videoOptions: ConversionVideoOptions = {}
  let audioOptions: ConversionAudioOptions = {}
  if (plan.kind === 'transcode') {
    // 只有一边设宽度和高度时才不会被 contain 成方框；两边都给了且按比例算好，fill 不会变形
    videoOptions = {
      codec: 'avc',
      width: plan.width,
      height: plan.height,
      fit: 'fill',
      ...(plan.frameRate ? { frameRate: plan.frameRate } : {}),
      quality: new Quality({ bitrate: plan.videoBitrate }),
      forceTranscode: true,
    }
    if (audio) {
      const numberOfChannels = Math.min(2, audio.numberOfChannels)
      const sampleRate = AAC_SAMPLE_RATES.has(audio.sampleRate) ? audio.sampleRate : 48000
      // 没有原生 AAC 编码器的浏览器（例如 Firefox）才加载 WASM 编码器
      if (!(await canEncodeAudio('aac', { numberOfChannels, sampleRate }))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
        registerAacEncoder()
      }
      audioOptions = {
        codec: 'aac',
        numberOfChannels,
        sampleRate,
        quality: new Quality({ bitrate: AUDIO_BITRATE }),
        forceTranscode: true,
      }
    }
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: videoOptions,
    audio: audioOptions,
    // 不带原文件的元数据（拍摄位置、设备等）
    tags: () => ({}),
    showWarnings: false,
  })
  // 只处理主视频轨与主音轨（tracks: 'primary'），其余轨道（第二条音轨、字幕等）不算丢掉；
  // 这两条里任何一条被丢掉（解码或编码不了）都不发：否则可能发出没有声音的视频
  if (!conversion.isValid || conversion.discardedTracks.length > 0) return { ok: false, reason: 'unsupported' }
  conversion.onProgress = (progress) => post({ type: 'progress', progress })
  await conversion.execute()

  const buffer = output.target.buffer!
  // 硬件编码器可能超出目标码率
  if (buffer.byteLength > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_long' }
  const result = new Blob([buffer], { type: 'video/mp4' })
  const { width, height } = plan.kind === 'transcode' ? plan : { width: video.displayWidth, height: video.displayHeight }
  return {
    ok: true,
    file: result,
    preview: cover.blob,
    preview_mime: cover.mime,
    w: width,
    h: height,
    duration: videoSeconds(duration),
    thumbhash: cover.thumbhash,
  }
}

/** 封面：第一帧，按文件里的旋转摆正，缩到长边 PREVIEW_SIZE */
async function coverOf(video: InputVideoTrack) {
  const { width, height } = scaleEven(video.displayWidth, video.displayHeight, PREVIEW_SIZE)
  const sink = new CanvasSink(video, { width, height, fit: 'fill', poolSize: 0 })
  const frame = await sink.getCanvas(await video.getFirstTimestamp())
  return frame ? prepareCover(frame.canvas) : null
}
