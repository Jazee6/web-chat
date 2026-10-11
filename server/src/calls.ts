// 一对一通话的 ICE 服务器：Cloudflare 的 STUN，加上由 TURN key 签发的短期 TURN 凭据。
// 见 docs/adr/0009-p2p-private-calls-sfu-group-calls.md、docs/architecture/04-realtime-and-fanout.md § 通话
import type { IceServer } from 'shared/protocol'

/** 没有配置 TURN key 时只有 STUN：能直连的照样通，非联系人强制中继的会失败 */
export const STUN_ONLY: IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
/** TURN 凭据的有效期：要比最长的通话更长（上限 48 小时） */
export const TURN_TTL_S = 24 * 60 * 60

type TurnEnv = { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }

/**
 * 签发一组 TURN 凭据。浏览器屏蔽 53 端口，不做 trickle ICE 时这个地址只会白白等到超时，去掉它。
 * 没有配置时返回 STUN；签发失败返回 null（只记日志），由调用方退回 STUN 并尽快重试
 */
export async function fetchIceServers(env: TurnEnv): Promise<IceServer[] | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY
  let res: Response
  try {
    res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_S }),
    })
  } catch (e) {
    console.error('turn credentials failed', { error: String(e) })
    return null
  }
  if (!res.ok) {
    console.error('turn credentials failed', { status: res.status })
    return null
  }
  const { iceServers } = (await res.json()) as { iceServers: IceServer[] }
  return iceServers
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0)
}
