import { describe, expect, it } from 'vitest'
import { describeUserAgent, deviceName } from './user-agent'

const name = (ua: string | null) => deviceName(describeUserAgent(ua))

describe('describeUserAgent', () => {
  it('识别常见浏览器与系统', () => {
    expect(
      name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'),
    ).toBe('Chrome · macOS')
    expect(
      name('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'),
    ).toBe('Edge · Windows')
    expect(name('Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0')).toBe('Firefox · Linux')
    expect(
      name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'),
    ).toBe('Safari · macOS')
  })

  it('iPhone 与 Android 算移动设备；iOS 上的 Chrome 仍是 Chrome', () => {
    const iphone = describeUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
    )
    expect(iphone).toEqual({ browser: 'Chrome', os: 'iOS', mobile: true })
    const android = describeUserAgent(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    )
    expect(android).toEqual({ browser: 'Chrome', os: 'Android', mobile: true })
  })

  it('认不出时给出兜底名称', () => {
    expect(name(null)).toBe('Unknown device')
    expect(name('curl/8.0')).toBe('Unknown device')
  })
})
