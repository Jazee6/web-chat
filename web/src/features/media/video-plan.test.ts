import { describe, expect, it } from 'vitest'
import { MAX_MEDIA_BYTES } from 'shared/protocol'
import { MIN_VIDEO_BITRATE, VIDEO_BITRATE, planVideo, scaleEven, videoSeconds, type VideoSource } from './video-plan'

const MB = 1024 * 1024
const base: VideoSource = { codec: 'avc', audioCodec: 'aac', width: 1280, height: 720, frameRate: 30, duration: 20, size: 5 * MB }

describe('planVideo', () => {
  it('只重新封装已经符合要求的 H.264/AAC 视频，包括没有音轨的', () => {
    expect(planVideo(base)).toEqual({ kind: 'remux' })
    expect(planVideo({ ...base, audioCodec: undefined })).toEqual({ kind: 'remux' })
    expect(planVideo({ ...base, frameRate: 30.5 })).toEqual({ kind: 'remux' })
  })

  it('编码、尺寸、帧率或大小不符合时重新编码', () => {
    expect(planVideo({ ...base, codec: 'hevc' }).kind).toBe('transcode')
    expect(planVideo({ ...base, audioCodec: 'opus' }).kind).toBe('transcode')
    expect(planVideo({ ...base, audioCodec: null }).kind).toBe('transcode')
    expect(planVideo({ ...base, size: MAX_MEDIA_BYTES + 1 }).kind).toBe('transcode')
    expect(planVideo({ ...base, width: 1920, height: 1080 })).toMatchObject({ kind: 'transcode', width: 1280, height: 720 })
    expect(planVideo({ ...base, frameRate: 60 })).toMatchObject({ kind: 'transcode', frameRate: 30 })
    expect(planVideo({ ...base, codec: 'vp9' })).not.toHaveProperty('frameRate')
  })

  it('短视频满码率，长一些的降码率，压到最低码率也放不下的算太长', () => {
    const at = (duration: number) => planVideo({ ...base, codec: 'hevc', duration })
    expect(at(30)).toMatchObject({ videoBitrate: VIDEO_BITRATE })
    const two = at(120)
    expect(two.kind === 'transcode' && two.videoBitrate).toBeLessThan(VIDEO_BITRATE)
    expect(two.kind === 'transcode' && two.videoBitrate).toBeGreaterThanOrEqual(MIN_VIDEO_BITRATE)
    // 码率与音频加起来不超过上限
    if (two.kind === 'transcode') expect(((two.videoBitrate + 96_000) * 120) / 8).toBeLessThan(MAX_MEDIA_BYTES)
    expect(at(180).kind).toBe('transcode')
    expect(at(240)).toEqual({ kind: 'too_long' })
    expect(planVideo({ ...base, duration: 4000 })).toEqual({ kind: 'too_long' })
  })
})

describe('scaleEven', () => {
  it('按长边缩放，宽高取偶数，不放大', () => {
    expect(scaleEven(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 })
    expect(scaleEven(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 })
    expect(scaleEven(1001, 563, 1280)).toEqual({ width: 1002, height: 564 })
    expect(scaleEven(3000, 1, 1280)).toEqual({ width: 1280, height: 2 })
  })
})

describe('videoSeconds', () => {
  it('取整秒，至少 1', () => {
    expect(videoSeconds(0.3)).toBe(1)
    expect(videoSeconds(41.6)).toBe(42)
  })
})
