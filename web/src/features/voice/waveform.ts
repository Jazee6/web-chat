// 语音消息的波形：WAVEFORM_LENGTH 个 0–255 的音量采样，base64 内联进消息。
// 见 docs/architecture/05-media.md § 语音消息
import { WAVEFORM_LENGTH } from 'shared/protocol'

/**
 * 把录音时按固定间隔采到的音量（0–1）压缩成 WAVEFORM_LENGTH 个采样：每段取峰值，再按整段的最大值归一化，
 * 安静的录音也能看出起伏。采样不足 WAVEFORM_LENGTH 个时按位置拉伸
 */
export function downsample(levels: number[]): Uint8Array {
  const out = new Uint8Array(WAVEFORM_LENGTH)
  if (levels.length === 0) return out
  const peaks = Array.from({ length: WAVEFORM_LENGTH }, (_, i) => {
    const start = Math.floor((i * levels.length) / WAVEFORM_LENGTH)
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / WAVEFORM_LENGTH))
    let peak = 0
    for (let j = start; j < end && j < levels.length; j++) peak = Math.max(peak, levels[j]!)
    return peak
  })
  const max = Math.max(...peaks)
  if (max <= 0) return out
  for (let i = 0; i < WAVEFORM_LENGTH; i++) out[i] = Math.round((peaks[i]! / max) * 255)
  return out
}

export function encodeWaveform(samples: Uint8Array): string {
  return btoa(String.fromCharCode(...samples))
}

/** 解码为 0–1；格式不对时返回全零，不影响播放 */
export function decodeWaveform(waveform: string): number[] {
  try {
    const bytes = atob(waveform)
    return Array.from({ length: WAVEFORM_LENGTH }, (_, i) => (bytes.charCodeAt(i) || 0) / 255)
  } catch {
    return new Array<number>(WAVEFORM_LENGTH).fill(0)
  }
}

/** 一段音频的音量（RMS，0–1）：AnalyserNode 取到的时域采样 */
export function rms(samples: Float32Array): number {
  let sum = 0
  for (const s of samples) sum += s * s
  return Math.min(1, Math.sqrt(sum / samples.length) * 2)
}
