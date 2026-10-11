import { WAVEFORM_LENGTH } from 'shared/protocol'
import { describe, expect, it } from 'vitest'
import { decodeWaveform, downsample, encodeWaveform } from './waveform'

describe('waveform', () => {
  it('每段取峰值并归一化到 0–255', () => {
    const levels = Array.from({ length: WAVEFORM_LENGTH * 2 }, (_, i) => (i % 2 === 0 ? 0.1 : i / (WAVEFORM_LENGTH * 4)))
    const out = downsample(levels)
    expect(out).toHaveLength(WAVEFORM_LENGTH)
    expect(Math.max(...out)).toBe(255)
    expect(out[WAVEFORM_LENGTH - 1]).toBe(255)
  })

  it('采样不足时拉伸；全静音为全零', () => {
    expect(downsample([0.5])).toEqual(new Uint8Array(WAVEFORM_LENGTH).fill(255))
    expect(downsample([])).toEqual(new Uint8Array(WAVEFORM_LENGTH))
    expect(downsample([0, 0, 0])).toEqual(new Uint8Array(WAVEFORM_LENGTH))
  })

  it('编码为 88 个字符的 base64，解码回 0–1', () => {
    const samples = Uint8Array.from({ length: WAVEFORM_LENGTH }, (_, i) => i * 4)
    const encoded = encodeWaveform(samples)
    expect(encoded).toHaveLength(88)
    const decoded = decodeWaveform(encoded)
    expect(decoded[1]).toBeCloseTo(4 / 255)
    expect(decodeWaveform('%%%')).toEqual(new Array(WAVEFORM_LENGTH).fill(0))
  })
})
