// 一对一通话与群组通话共用的小工具
import { toBase64 } from '@/lib/base64'
import { OpFailure } from '@/sync/client'

/** 通话失败的原因，message 直接显示给用户 */
export class CallError extends Error {}

/**
 * 信令与 SDP 压缩后再发：不做 trickle ICE 的 SDP 带着全部候选，群组通话拉的路数多了也会变长，
 * 都可能超过帧的上限；内容重复多，压缩后约剩四分之一
 */
export async function deflate(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function inflate(data: string): Promise<string> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** 通话结束时显示的原因；codes 为各自特有的错误码的说法 */
export function callErrorText(e: unknown, codes: Partial<Record<string, string>> = {}): string {
  if (e instanceof CallError) return e.message
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'Microphone access was denied'
  if (!(e instanceof OpFailure)) return 'Call failed'
  const own = codes[e.code]
  if (own) return own
  switch (e.code) {
    case 'busy':
      return 'You’re already in a call'
    case 'offline':
      return 'You’re offline'
    case 'call_ended':
      return 'The call has ended'
    default:
      return 'Call failed'
  }
}

export function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}
