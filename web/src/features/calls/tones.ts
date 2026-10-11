// 来电铃声与回铃音：用 WebAudio 合成，不需要音频文件。回铃音与试听从选定的扬声器出来，
// 来电铃声始终走系统默认的扬声器（选的是耳机、没戴着时也听得到来电）。
// 浏览器的自动播放规则可能让没交互过的标签页静音，来电界面与推送通知才是主要的提醒
import { applySpeaker } from '@/features/av/devices'

export type Tone = { stop: () => void }

/** 新建的 AudioContext 换到选定的扬声器 */
function speakerContext(): AudioContext {
  const ctx = new AudioContext()
  void applySpeaker(ctx)
  return ctx
}

/** 同一台设备开着多个标签页时只让一个响铃 */
const RING_LOCK = 'web-chat-ring'

/** 电话式的蜂鸣（回铃音）：两个频率叠加，on 毫秒响、off 毫秒停，循环 */
function loop(freqs: number[], on: number, off: number, gain: number): Tone {
  const ctx = speakerContext()
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(ctx.destination)
  for (const f of freqs) {
    const osc = ctx.createOscillator()
    osc.frequency.value = f
    osc.connect(out)
    osc.start()
  }
  const period = (on + off) / 1000
  // 提前排好一段时间的包络，之后定时续上，避免依赖定时器的精度
  let scheduled = ctx.currentTime
  const schedule = () => {
    while (scheduled < ctx.currentTime + 10) {
      out.gain.setValueAtTime(0, scheduled)
      out.gain.linearRampToValueAtTime(gain, scheduled + 0.02)
      out.gain.setValueAtTime(gain, scheduled + on / 1000 - 0.02)
      out.gain.linearRampToValueAtTime(0, scheduled + on / 1000)
      scheduled += period
    }
  }
  schedule()
  const timer = setInterval(schedule, 5000)
  return {
    stop: () => {
      clearInterval(timer)
      void ctx.close()
    },
  }
}

/**
 * 来电铃声：木琴似的音色弹一句 A 大调的上行琶音（E–A–C♯–E）再回应两个音，每 2.6 秒一句。
 * 每个音是基音加一个约 4 倍频的泛音，泛音衰减得更快，听起来像敲击而不是电话的蜂鸣
 */
const RING_PHRASE: [at: number, freq: number][] = [
  [0, 659.25],
  [0.13, 880],
  [0.26, 1108.73],
  [0.39, 1318.51],
  [0.68, 1108.73],
  [0.81, 1318.51],
]
const RING_PERIOD = 2.6
const RING_GAIN = 0.12

/** 在 at 时刻敲一个音 */
function strike(ctx: AudioContext, out: AudioNode, at: number, freq: number, gain: number) {
  for (const [ratio, level, decay] of [
    [1, gain, 0.9],
    [3.93, gain * 0.25, 0.18],
  ] as const) {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq * ratio
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(level, at + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    osc.connect(env).connect(out)
    osc.start(at)
    osc.stop(at + decay)
  }
}

/** 从 at 时刻起弹一句铃声 */
function phrase(ctx: AudioContext, at: number): void {
  for (const [offset, freq] of RING_PHRASE) strike(ctx, ctx.destination, at + offset, freq, RING_GAIN)
}

/** 循环的来电铃声，走系统默认的扬声器 */
function ring(): Tone {
  const ctx = new AudioContext()
  // 提前排好一段时间的音，之后定时续上，避免依赖定时器的精度
  let scheduled = ctx.currentTime + 0.05
  const schedule = () => {
    while (scheduled < ctx.currentTime + 10) {
      phrase(ctx, scheduled)
      scheduled += RING_PERIOD
    }
  }
  schedule()
  const timer = setInterval(schedule, 5000)
  return {
    stop: () => {
      clearInterval(timer)
      void ctx.close()
    },
  }
}

/** 试听选定的扬声器：弹一句来电铃声 */
export function playTestTone(): Tone {
  const ctx = speakerContext()
  phrase(ctx, ctx.currentTime + 0.05)
  const timer = setTimeout(() => void ctx.close(), (RING_PERIOD - 0.5) * 1000)
  return {
    stop: () => {
      clearTimeout(timer)
      void ctx.close()
    },
  }
}

/** 来电：拿到锁的标签页响铃，停止时释放锁 */
export function playRingtone(): Tone {
  let tone: Tone | null = null
  let stopped = false
  let release: () => void = () => {}
  void navigator.locks.request(RING_LOCK, { ifAvailable: true }, (lock) => {
    if (!lock || stopped) return
    tone = ring()
    return new Promise<void>((resolve) => (release = resolve))
  })
  return {
    stop: () => {
      stopped = true
      tone?.stop()
      release()
    },
  }
}

/** 呼出：等对方接听时的回铃音 */
export function playRingback(): Tone {
  return loop([440, 480], 1000, 3000, 0.08)
}
