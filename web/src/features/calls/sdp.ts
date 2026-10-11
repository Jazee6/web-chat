// 处理 Realtime SFU 发来的 SDP

/**
 * SFU 的 SDP 偶尔带着找不到主编码的重传格式（先拉过别人的 H265、再发布时，answer 里有 H265 的 rtx 却没有 H265），
 * 浏览器会拒绝整份 SDP：设置之前把这样的 rtx 去掉
 */
export function repairSdp(sdp: string): string {
  const [head, ...sections] = sdp.split('\r\nm=')
  const repaired = sections.map((section) => {
    const lines = section.split('\r\n')
    const rtpmap = new Map(lines.flatMap((l) => (l.startsWith('a=rtpmap:') ? [[l.slice(9).split(' ')[0]!, l] as const] : [])))
    const apt = new Map(lines.flatMap((l) => {
      const m = /^a=fmtp:(\d+) apt=(\d+)/.exec(l)
      return m ? [[m[1]!, m[2]!] as const] : []
    }))
    const orphans = new Set([...rtpmap].filter(([pt, l]) => / rtx\//i.test(l) && !rtpmap.has(apt.get(pt) ?? '')).map(([pt]) => pt))
    if (orphans.size === 0) return section
    const [mline, ...rest] = lines
    const fields = mline!.split(' ')
    return [
      [...fields.slice(0, 3), ...fields.slice(3).filter((pt) => !orphans.has(pt))].join(' '),
      ...rest.filter((l) => !orphans.has(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/.exec(l)?.[1] ?? '')),
    ].join('\r\n')
  })
  return [head, ...repaired].join('\r\nm=')
}
