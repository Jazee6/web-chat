import { describe, expect, it } from 'vitest'

import { repairSdp } from './sdp'

const sdp = (...lines: string[]) => lines.join('\r\n')

describe('repairSdp', () => {
  it('去掉找不到主编码的 rtx，连同它的 fmtp 与 rtcp-fb', () => {
    const input = sdp(
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 35 117',
      'a=mid:1',
      'a=rtpmap:96 VP8/90000',
      'a=rtcp-fb:96 nack',
      'a=rtpmap:35 rtx/90000',
      'a=fmtp:35 apt=96',
      'a=rtpmap:117 rtx/90000',
      'a=fmtp:117 apt=116',
      'a=rtcp-fb:117 nack',
      'a=recvonly',
    )
    expect(repairSdp(input)).toBe(
      sdp('v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96 35', 'a=mid:1', 'a=rtpmap:96 VP8/90000', 'a=rtcp-fb:96 nack', 'a=rtpmap:35 rtx/90000', 'a=fmtp:35 apt=96', 'a=recvonly'),
    )
  })

  it('没有问题的 SDP 原样返回，只看同一个 m 段', () => {
    const input = sdp(
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 116 117',
      'a=rtpmap:116 H265/90000',
      'a=rtpmap:117 rtx/90000',
      'a=fmtp:117 apt=116',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
    )
    expect(repairSdp(input)).toBe(input)
  })
})
