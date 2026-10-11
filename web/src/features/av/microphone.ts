// 麦克风：按本机偏好取选定的麦克风，开着 AI 降噪时接上降噪（这时关掉浏览器自带的降噪，免得降两次）。
// 通话里的麦克风跟着走：换了选择、开关降噪、选定的设备插回来、系统换了默认设备、当前设备被拔掉，都换成新的音轨交给 onTrack；
// 录语音消息时不跟（MediaRecorder 中途换不了轨道），原始音轨结束或被静音时交给 onInterrupted
import { avPreferences, onAvPreferences } from './preferences'
import { avDevices, deviceConstraint, deviceKey, deviceKeyPresent, onAvDevices, refreshAvDevices, trackIsOn, wantedDevice } from './devices'
import { aiNoiseSupported, denoise, DENOISE_SAMPLE_RATE, prepareDenoiser, type Denoiser } from './noise'

export type MicrophoneOptions = {
  /** 跟着设备与偏好换音轨（通话）；false 时不换（录音） */
  follow: boolean
}

/** 因为音轨结束而连续重取的上限，与取到后用满多久算稳定 */
const MAX_ENDED_RETRIES = 3
const STABLE_MS = 5000

type Parts = { raw: MediaStreamTrack; denoiser: Denoiser | null }

export class Microphone {
  /** 要发出去或录下来的音轨：开着降噪时是降噪后的，否则就是麦克风的 */
  track: MediaStreamTrack
  /** follow 时换了音轨 */
  onTrack: ((track: MediaStreamTrack) => void) | null = null
  /** 不 follow 时：麦克风被拔掉、被系统打断（原始音轨结束或被静音） */
  onInterrupted: (() => void) | null = null
  private parts: Parts
  private on = true
  private closed = false
  private rebuilding: Promise<void> = Promise.resolve()
  /** 为之换过的目标设备：换过之后仍对不上（浏览器给的不是它）时不再为它换，免得每次列表变化都断一下 */
  private target: string | null = null
  /** 连续因为音轨结束而重取的次数：取到的总是马上又结束（被别处占用）时停下，不来回抢 */
  private endedRetries = 0
  private context: AudioContext | null
  private readonly follow: boolean
  private readonly unsubscribe: (() => void)[] = []

  constructor(parts: Parts, context: AudioContext | null, { follow }: MicrophoneOptions) {
    this.parts = parts
    this.track = output(parts)
    this.context = context
    this.follow = follow
    this.watch(parts.raw)
    if (!follow) return
    let last = avPreferences()
    this.unsubscribe.push(
      onAvPreferences(() => {
        const next = avPreferences()
        if (next.mic !== last.mic || next.aiNoise !== last.aiNoise) {
          const wanted = wantedDevice('mic')
          this.target = wanted && deviceKey(wanted)
          this.rebuild()
        }
        last = next
      }),
      onAvDevices(() => {
        if (avDevices().devices.mic.length === 0) return
        if (this.target && !deviceKeyPresent('mic', this.target)) this.target = null
        const wanted = wantedDevice('mic')
        if (!wanted || trackIsOn(this.parts.raw, wanted) || deviceKey(wanted) === this.target) return
        this.target = deviceKey(wanted)
        this.rebuild()
      }),
    )
  }

  get enabled() {
    return this.on
  }

  /** 静音只是不出声，音轨照旧 */
  set enabled(on: boolean) {
    this.on = on
    this.track.enabled = on
    this.parts.raw.enabled = on
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const off of this.unsubscribe) off()
    release(this.parts)
    void this.context?.close().catch(() => {})
  }

  private watch(raw: MediaStreamTrack) {
    raw.addEventListener('ended', () => {
      if (this.closed || raw !== this.parts.raw) return
      if (!this.follow) return this.onInterrupted?.()
      if (this.endedRetries++ < MAX_ENDED_RETRIES) this.rebuild()
    })
    raw.addEventListener('mute', () => {
      if (!this.closed && raw === this.parts.raw && !this.follow) this.onInterrupted?.()
    })
  }

  /** 换成新的音轨；一次只换一个。先放掉旧的（手机上同时只能开一个麦克风） */
  private rebuild() {
    this.rebuilding = this.rebuilding.then(async () => {
      if (this.closed) return
      release(this.parts)
      // 通话中途才打开降噪：这时才建 AudioContext（不在用户操作里，停着的话退回自带降噪）
      if (aiNoiseSupported && avPreferences().aiNoise) this.context ??= newContext()
      try {
        const parts = await capture(this.context)
        if (this.closed) return release(parts)
        this.parts = parts
        this.track = output(parts)
        // 用了一会儿才结束的不算连续
        setTimeout(() => {
          if (this.parts === parts && parts.raw.readyState === 'live') this.endedRetries = 0
        }, STABLE_MS)
        this.enabled = this.on
        this.watch(parts.raw)
        this.onTrack?.(this.track)
      } catch (e) {
        // 一个麦克风都没有了：通话照常，等插上设备时再换
        console.warn("couldn't switch the microphone", e)
      }
    })
  }
}

/**
 * 取麦克风。须在用户操作里调用：开着 AI 降噪时同步建好 AudioContext，
 * await 之后再建，Safari 可能让它停着（停着输出的是静音）
 */
export async function openMicrophone(options: MicrophoneOptions): Promise<Microphone> {
  const context = aiNoiseSupported && avPreferences().aiNoise ? newContext() : null
  try {
    const parts = await capture(context)
    void refreshAvDevices()
    return new Microphone(parts, context, options)
  } catch (e) {
    void context?.close().catch(() => {})
    throw e
  }
}

/** 按当前偏好取一次；降噪准备不了或接不上时退回浏览器自带的降噪 */
async function capture(context: AudioContext | null): Promise<Parts> {
  let ai = context !== null && avPreferences().aiNoise
  if (ai) {
    try {
      await prepareDenoiser(context!)
    } catch (e) {
      console.warn('AI noise suppression is unavailable', e)
      ai = false
    }
  }
  const raw = await getRaw(ai)
  if (!ai) return { raw, denoiser: null }
  try {
    return { raw, denoiser: await denoise(raw, context!) }
  } catch (e) {
    console.warn('AI noise suppression is unavailable', e)
    raw.stop()
    return { raw: await getRaw(false), denoiser: null }
  }
}

function newContext() {
  return new AudioContext({ sampleRate: DENOISE_SAMPLE_RATE })
}

async function getRaw(ai: boolean): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceConstraint('mic'), echoCancellation: true, autoGainControl: true, noiseSuppression: !ai },
  })
  return stream.getAudioTracks()[0]!
}

function output(parts: Parts): MediaStreamTrack {
  return parts.denoiser?.track ?? parts.raw
}

function release(parts: Parts) {
  parts.denoiser?.close()
  parts.denoiser?.track.stop()
  parts.raw.stop()
}
