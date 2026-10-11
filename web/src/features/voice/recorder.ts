// 录语音消息：MediaRecorder 录音，AnalyserNode 取实时音量给录音条显示。
// 录完后解码整段录音，从中算出时长与波形；解码失败时退回录音期间记下的时间与音量。
// 见 docs/architecture/05-media.md § 语音消息
import { useEffect, useRef, useState } from 'react'
import { MAX_VOICE_SECONDS, VOICE_MIME_TYPES } from 'shared/protocol'

import { openMicrophone, type Microphone } from '@/features/av/microphone'
import { blockReload } from '@/lib/reload'
import type { OutgoingMedia } from '@/sync/bridge'
import { downsample, encodeWaveform, rms } from './waveform'

/** 录音码率：语音用 32kbps 足够，5 分钟约 1.3MB */
const BITS_PER_SECOND = 32_000
/** 每隔多久取一次实时音量 */
const LEVEL_INTERVAL_MS = 100
/** 录音条上显示最近多少个音量 */
const LIVE_BARS = 48
/** 不到 1 秒的录音直接丢弃 */
const MIN_MS = 1000
/** 每隔多久把录到的数据交出来：被系统打断时，已经交出来的部分不会丢 */
const TIMESLICE_MS = 1000

/** 单调时钟：从 since 起过了多少毫秒 */
const elapsedSince = (since: number) => performance.now() - since

/** 优先 WebM/Opus（Chrome、Firefox、Safari 18.4+），不支持时退回 MP4 */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const

export type VoiceTake = Extract<OutgoingMedia, { type: 'voice' }>

export type RecorderState =
  | { status: 'idle' }
  | { status: 'starting' }
  /** elapsed：已录的毫秒数；levels：最近的实时音量（0–1），最新的在最后 */
  | { status: 'recording'; elapsed: number; levels: number[] }
  /** 录音被系统打断（切到别的应用、锁屏、来电、麦克风被拔掉）：保留已录的部分，等用户选择发送或删除 */
  | { status: 'interrupted'; take: VoiceTake }

/** 录音失败的原因：没有权限、没有麦克风、浏览器不支持 */
export class RecordError extends Error {
  readonly reason: 'denied' | 'unavailable'
  constructor(reason: 'denied' | 'unavailable') {
    super(reason)
    this.reason = reason
  }
}

export const recordingSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

type Session = {
  mic: Microphone
  recorder: MediaRecorder
  context: AudioContext
  chunks: Blob[]
  levels: number[]
  startedAt: number
  timer: ReturnType<typeof setInterval>
  stopped: Promise<void>
}

/**
 * 录音状态机：idle → starting → recording →（finish / cancel）→ idle；被系统打断时停在 interrupted。
 * onLimit：录满 MAX_VOICE_SECONDS 时自动结束并交出录音；onLost：被打断时什么都没录到（不到 1 秒），已回到 idle
 */
export function useRecorder({ onLimit, onLost }: { onLimit: (take: VoiceTake | null) => void; onLost: () => void }) {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const session = useRef<Session | null>(null)
  const callbacks = useRef({ onLimit, onLost })
  const busy = useRef(false)
  useEffect(() => {
    callbacks.current = { onLimit, onLost }
    busy.current = state.status !== 'idle'
  })
  // 录音中、被打断后还没发出去时不重载页面（发布了新版本时）
  useEffect(() => blockReload(() => busy.current), [])

  /** 停止录音并释放麦克风（录音指示随之消失），返回录到的数据 */
  const stop = async (): Promise<{ blob: Blob; elapsed: number; levels: number[] } | null> => {
    const s = session.current
    if (!s) return null
    session.current = null
    clearInterval(s.timer)
    const elapsed = elapsedSince(s.startedAt)
    if (s.recorder.state !== 'inactive') s.recorder.stop()
    await s.stopped
    s.mic.close()
    void s.context.close().catch(() => {})
    const mime = s.recorder.mimeType || s.chunks[0]?.type || ''
    return { blob: new Blob(s.chunks, { type: mime }), elapsed, levels: s.levels }
  }

  const interrupt = async () => {
    if (!session.current) return
    const data = await stop()
    const take = data ? await toTake(data) : null
    if (take) {
      setState({ status: 'interrupted', take })
    } else {
      setState({ status: 'idle' })
      callbacks.current.onLost()
    }
  }

  const start = async () => {
    if (session.current || state.status === 'starting') return
    setState({ status: 'starting' })
    // 在用户点击里同步建好 AudioContext：之后（await 之后）再建，Safari 可能让它停在 suspended，实时音量全是零
    const context = typeof AudioContext === 'undefined' ? null : new AudioContext()
    let mic: Microphone
    try {
      if (!recordingSupported || !context) throw new RecordError('unavailable')
      // 用选定的麦克风与 AI 降噪；录音中途不跟着换（MediaRecorder 换不了轨道）
      mic = await openMicrophone({ follow: false })
    } catch (e) {
      void context?.close().catch(() => {})
      setState({ status: 'idle' })
      if (e instanceof RecordError) throw e
      throw new RecordError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
    // 只影响实时波形，恢复不了也照常录
    await context.resume().catch(() => {})
    const stream = new MediaStream([mic.track])
    const mimeType = CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: BITS_PER_SECOND })
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }))
    const startedAt = elapsedSince(0)
    const levels: number[] = []
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      levels.push(rms(buffer))
      const elapsed = elapsedSince(startedAt)
      setState({ status: 'recording', elapsed, levels: levels.slice(-LIVE_BARS) })
      if (elapsed >= MAX_VOICE_SECONDS * 1000) void finishAtLimit()
    }, LEVEL_INTERVAL_MS)
    session.current = { mic, recorder, context, chunks, levels, startedAt, timer, stopped }

    // 被系统打断：麦克风的音轨结束或被静音（iOS 切到后台、来电、麦克风被拔掉），或者录音出错
    mic.onInterrupted = () => void interrupt()
    recorder.addEventListener('error', () => void interrupt())
    recorder.start(TIMESLICE_MS)
    setState({ status: 'recording', elapsed: 0, levels: [] })
  }

  const finishAtLimit = async () => {
    const take = await finish()
    callbacks.current.onLimit(take)
  }

  /** 结束录音，交出要发送的录音；不到 1 秒或者什么都没录到时返回 null。被打断后调用则交出保留的录音 */
  const finish = async (): Promise<VoiceTake | null> => {
    if (state.status === 'interrupted') {
      setState({ status: 'idle' })
      return state.take
    }
    const data = await stop()
    setState({ status: 'idle' })
    return data ? toTake(data) : null
  }

  /** 丢弃录音 */
  const cancel = () => {
    void stop()
    setState({ status: 'idle' })
  }

  // 离开会话（组件卸载）时释放麦克风；要不要丢弃由会话页先确认
  useEffect(
    () => () => {
      void stop()
    },
    [],
  )

  return { state, start, finish, cancel }
}

/** 解码整段录音，得出时长（整秒，1–MAX_VOICE_SECONDS）与波形；不到 1 秒的返回 null */
async function toTake({ blob, elapsed, levels }: { blob: Blob; elapsed: number; levels: number[] }): Promise<VoiceTake | null> {
  if (blob.size === 0) return null
  let seconds = elapsed / 1000
  let samples = levels
  try {
    const context = new OfflineAudioContext(1, 1, 8000)
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    seconds = audio.duration
    samples = pcmLevels(audio.getChannelData(0), audio.sampleRate)
  } catch {
    // 解码不了（个别浏览器解不了自己录的格式）：用录音期间的计时与音量
  }
  if (seconds * 1000 < MIN_MS) return null
  const base = blob.type.split(';')[0] ?? ''
  const mime = (VOICE_MIME_TYPES as readonly string[]).includes(base) ? (base as VoiceTake['mime']) : 'audio/webm'
  return {
    type: 'voice',
    file: new Blob([blob], { type: mime }),
    mime,
    duration: Math.min(MAX_VOICE_SECONDS, Math.max(1, Math.round(seconds))),
    waveform: encodeWaveform(downsample(samples)),
  }
}

/** PCM 每 LEVEL_INTERVAL_MS 一段的音量 */
function pcmLevels(pcm: Float32Array, sampleRate: number): number[] {
  const size = Math.max(1, Math.floor((sampleRate * LEVEL_INTERVAL_MS) / 1000))
  const out: number[] = []
  for (let i = 0; i < pcm.length; i += size) out.push(rms(pcm.subarray(i, i + size)))
  return out
}
