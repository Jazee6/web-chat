// 同步 Worker 持有的唯一一条 WebSocket：请求 / 响应配对、心跳、断线重连。
// 见 docs/architecture/03-sync-protocol.md § 传输与帧格式
import * as v from 'valibot'
import {
  CLOSE_OUTDATED,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  HEARTBEAT_MS,
  PING,
  PONG,
  type ErrorCode,
  type Method,
  type MethodResults,
  type methodParams,
  type ServerFrame,
  type Transient,
  type Update,
} from 'shared/protocol'
import type { ConnectionStatus } from './bridge'
import { reconnectDelay } from './logic'

/** 连续多少次握手失败后检查登录状态（浏览器不暴露升级请求的 401，只能看到 1006） */
const HANDSHAKE_FAILURES_BEFORE_AUTH_CHECK = 2

export type RpcResult<M extends Method> =
  | { ok: true; r: MethodResults[M] }
  | { ok: false; e: ErrorCode; user_ids?: string[] }

/** 请求没有发出或连接在响应前断开 */
export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

type Handlers = {
  onOpen: () => void
  onUpdates: (updates: Update[]) => void
  onEvents: (events: Transient[]) => void
  onStatus: (status: ConnectionStatus) => void
  onHandshakeFailures: () => void
  /** 本设备已被移除（CLOSE_REVOKED），连接已永久停止 */
  onRevoked: () => void
  /** 服务端已是新的协议版本（CLOSE_OUTDATED），连接已永久停止，等页面重载 */
  onOutdated: () => void
}

type Pending = { resolve: (res: RpcResult<Method>) => void; reject: (e: Error) => void }

export class Connection {
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'connecting'
  private attempt = 0
  private failedHandshakes = 0
  private nextId = 1
  private pending = new Map<number, Pending>()
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private awaitingPong = false
  private stopped = false

  private readonly url: string
  private readonly handlers: Handlers

  constructor(url: string, handlers: Handlers) {
    this.url = url
    this.handlers = handlers
  }

  get online() {
    return this.status === 'online'
  }

  get currentStatus() {
    return this.status
  }

  start() {
    addEventListener('online', () => this.retryNow())
    this.connect()
  }

  /** 永久停止（退出登录、被顶替、被移除） */
  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.detach(new OfflineError())
    ws?.close(1000, 'stopped')
    this.setStatus('offline')
  }

  request<M extends Method>(m: M, p: v.InferInput<(typeof methodParams)[M]>): Promise<RpcResult<M>> {
    const ws = this.ws
    if (!ws || this.status !== 'online') return Promise.reject(new OfflineError())
    const id = this.nextId++
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject })
      ws.send(JSON.stringify({ t: 'req', id, m, p }))
    })
  }

  private connect() {
    if (this.stopped) return
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    let opened = false

    ws.onopen = () => {
      opened = true
      this.attempt = 0
      this.failedHandshakes = 0
      this.startHeartbeat()
      this.setStatus('online')
      this.handlers.onOpen()
    }
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      if (e.data === PONG) {
        this.awaitingPong = false
        return
      }
      this.onFrame(JSON.parse(e.data) as ServerFrame)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.detach(new OfflineError())
      if (e.code === CLOSE_REPLACED || e.code === CLOSE_REVOKED || e.code === CLOSE_OUTDATED) {
        this.stopped = true
        this.setStatus('offline')
        if (e.code === CLOSE_REVOKED) this.handlers.onRevoked()
        if (e.code === CLOSE_OUTDATED) this.handlers.onOutdated()
        return
      }
      if (!opened && ++this.failedHandshakes >= HANDSHAKE_FAILURES_BEFORE_AUTH_CHECK) {
        this.handlers.onHandshakeFailures()
      }
      this.scheduleRetry()
    }
  }

  private onFrame(frame: ServerFrame) {
    if (frame.t === 'upd') {
      this.handlers.onUpdates(frame.u)
      return
    }
    if (frame.t === 'evt') {
      this.handlers.onEvents(frame.e)
      return
    }
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    pending.resolve(frame.ok ? { ok: true, r: frame.r as never } : { ok: false, e: frame.e, user_ids: frame.user_ids })
  }

  /** 放弃当前连接：拒绝所有未完成请求，不再处理它的事件 */
  private detach(error: Error) {
    clearInterval(this.heartbeat)
    const ws = this.ws
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null
      this.ws = null
    }
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }

  private startHeartbeat() {
    this.awaitingPong = false
    this.heartbeat = setInterval(() => {
      const ws = this.ws
      if (!ws) return
      if (this.awaitingPong) {
        // 上一次心跳没有回音：连接已经死了，不等关闭握手，直接重连
        this.detach(new OfflineError())
        ws.close()
        this.scheduleRetry()
        return
      }
      this.awaitingPong = true
      ws.send(PING)
    }, HEARTBEAT_MS)
  }

  private scheduleRetry() {
    if (this.stopped) return
    this.setStatus('offline')
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), reconnectDelay(this.attempt++))
  }

  private retryNow() {
    if (this.stopped || this.ws) return
    clearTimeout(this.retryTimer)
    this.attempt = 0
    this.connect()
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatus(status)
  }
}
