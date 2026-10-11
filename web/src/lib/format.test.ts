import { describe, expect, it } from 'vitest'
import { formatBytes, formatDialogDate, formatLastSeen } from './format'

describe('formatLastSeen', () => {
  const now = new Date(2026, 8, 29, 15, 0).getTime()
  const minute = 60 * 1000

  it('按距今远近选择说法', () => {
    expect(formatLastSeen(0, now)).toBe('last seen a long time ago')
    expect(formatLastSeen(now - 30 * 1000, now)).toBe('last seen just now')
    expect(formatLastSeen(now - minute, now)).toBe('last seen 1 minute ago')
    expect(formatLastSeen(now - 59 * minute, now)).toBe('last seen 59 minutes ago')
    expect(formatLastSeen(now - 2 * 60 * minute, now)).toMatch(/^last seen today at /)
    expect(formatLastSeen(now - 20 * 60 * minute, now)).toMatch(/^last seen yesterday at /)
    expect(formatLastSeen(new Date(2026, 0, 2).getTime(), now)).not.toMatch(/2026/)
    expect(formatLastSeen(new Date(2024, 0, 2).getTime(), now)).toMatch(/2024/)
  })
})

describe('formatBytes', () => {
  it('uses 1024-based units with one decimal', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.0 MB')
  })
})

describe('formatDialogDate', () => {
  const now = new Date(2026, 8, 29, 15, 0).getTime()

  it('昨天与日期分隔条一致，写 Yesterday', () => {
    expect(formatDialogDate(new Date(2026, 8, 28, 23, 0).getTime(), now)).toBe('Yesterday')
    expect(formatDialogDate(new Date(2026, 8, 28, 0, 0).getTime(), now)).toBe('Yesterday')
    expect(formatDialogDate(new Date(2026, 8, 27, 23, 0).getTime(), now)).not.toBe('Yesterday')
  })
})
