// 群组通话的 Cloudflare Realtime SFU：App Secret 只在服务端，客户端经 ChatDO 间接操作自己的 session。
// 见 docs/adr/0009-p2p-private-calls-sfu-group-calls.md、docs/architecture/04-realtime-and-fanout.md § 群组通话
import type { SimulcastRid } from 'shared/protocol'

type SfuEnv = { SFU_KEY_ID?: string; SFU_KEY_API_TOKEN?: string }

export type SessionDescription = { type: 'offer' | 'answer'; sdp: string }
type TrackResult = { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }
type TracksResponse = {
  errorCode?: string
  errorDescription?: string
  requiresImmediateRenegotiation?: boolean
  sessionDescription?: SessionDescription
  tracks?: TrackResult[]
}

export class SfuError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}

/**
 * 拉指定的层；发布者不再发这一层（带宽不够）时按字母序退到下一层。
 * priorityOrdering 不用 asciibetical：实测 SFU 会按它估计的下行带宽一路降到最低层，换到 f 也只收到 q
 */
const simulcast = (rid: SimulcastRid) => ({ preferredRid: rid, priorityOrdering: 'none', ridNotAvailable: 'asciibetical' })

/** Realtime SFU 的 HTTPS 接口；没有配置时每个操作都抛 SfuError */
export class Sfu {
  constructor(private readonly env: SfuEnv) {}

  get configured() {
    return Boolean(this.env.SFU_KEY_ID && this.env.SFU_KEY_API_TOKEN)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new SfuError('sfu not configured')
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${this.env.SFU_KEY_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.SFU_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as T & { errorCode?: string; errorDescription?: string }
    if (!res.ok || json.errorCode) {
      throw new SfuError(`${method} ${path.replace(/[0-9a-f]{32,}/g, ':id')}: ${res.status} ${json.errorCode ?? ''} ${json.errorDescription ?? ''}`, res.status)
    }
    return json
  }

  async newSession(): Promise<string> {
    return (await this.request<{ sessionId: string }>('POST', '/sessions/new')).sessionId
  }

  /** 发布本端的 track：offer 里的收发器（mid）对应 track 名；返回 answer */
  async publish(session: string, offer: SessionDescription, tracks: { mid: string; name: string }[]): Promise<SessionDescription> {
    const res = await this.request<TracksResponse>('POST', `/sessions/${session}/tracks/new`, {
      sessionDescription: offer,
      tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.name })),
    })
    const failed = res.tracks?.find((t) => t.errorCode)
    if (failed || !res.sessionDescription) throw new SfuError(`publish: ${failed?.errorCode ?? 'no answer'}`)
    return res.sessionDescription
  }

  /** 拉取别人的 track：返回 SFU 的 offer（要回 answer）与每一路的 mid；拉不到的 mid 为 null */
  async pull(
    session: string,
    tracks: { session: string; name: string; rid?: SimulcastRid }[],
  ): Promise<{ offer: SessionDescription | null; mids: (string | null)[] }> {
    const res = await this.request<TracksResponse>('POST', `/sessions/${session}/tracks/new`, {
      tracks: tracks.map((t) => ({
        location: 'remote',
        sessionId: t.session,
        trackName: t.name,
        ...(t.rid ? { simulcast: simulcast(t.rid) } : {}),
      })),
    })
    const mids = tracks.map((t) => res.tracks?.find((r) => r.trackName === t.name && r.sessionId === t.session && !r.errorCode)?.mid ?? null)
    return { offer: res.requiresImmediateRenegotiation && res.sessionDescription ? res.sessionDescription : null, mids }
  }

  async renegotiate(session: string, answer: SessionDescription): Promise<void> {
    await this.request('PUT', `/sessions/${session}/renegotiate`, { sessionDescription: answer })
  }

  /** 停止发布：offer 为停掉收发器之后的；返回 answer */
  async unpublish(session: string, offer: SessionDescription, mids: string[]): Promise<SessionDescription> {
    const res = await this.request<TracksResponse>('PUT', `/sessions/${session}/tracks/close`, {
      tracks: mids.map((mid) => ({ mid })),
      sessionDescription: offer,
      force: false,
    })
    if (!res.sessionDescription) throw new SfuError('unpublish: no answer')
    return res.sessionDescription
  }

  /** 换一路已拉取的 simulcast 层 */
  async layer(session: string, mid: string, remote: { session: string; name: string }, rid: SimulcastRid): Promise<void> {
    await this.request('PUT', `/sessions/${session}/tracks/update`, {
      tracks: [{ location: 'remote', sessionId: remote.session, trackName: remote.name, mid, simulcast: simulcast(rid) }],
    })
  }

  /**
   * 关掉一个 session 上所有还开着的 track（发布的与拉取的），不需要 SDP：
   * 离开、被移出或掉线超时的人随即停止发出与收到媒体
   */
  async closeAll(session: string): Promise<void> {
    let state: { tracks?: { mid?: string; status?: string }[] }
    try {
      state = await this.request('GET', `/sessions/${session}`)
    } catch (e) {
      // 410：连接已经断开（客户端先关了），SFU 自己会回收
      if (e instanceof SfuError && e.status === 410) return
      throw e
    }
    const mids = (state.tracks ?? []).filter((t) => t.status === 'active' && t.mid).map((t) => ({ mid: t.mid! }))
    for (let i = 0; i < mids.length; i += 64) {
      await this.request('PUT', `/sessions/${session}/tracks/close`, { tracks: mids.slice(i, i + 64), force: true })
    }
  }
}

/** 客户端发来的 SDP 是 deflate-raw 压缩后的 base64（帧有大小上限）；解压后限制在 256KB 以内 */
export async function unpackSdp(data: string): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256 * 1024) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer())
  } catch {
    return null
  }
}
