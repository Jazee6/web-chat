// 同步状态机里与 I/O 无关的判定，全部是纯函数，便于单测。
// 见 docs/architecture/03-sync-protocol.md
import { DEDUP_WINDOW_MS } from 'shared/protocol'

export type Verdict = 'apply' | 'skip' | 'gap'

/**
 * 序列规则（与 Telegram 相同）：
 * - local + count == pts：应用
 * - local + count >  pts：已应用过，丢弃
 * - local + count <  pts：出现缺口
 */
export function classify(local: number, pts: number, count: number): Verdict {
  const expected = local + count
  if (expected === pts) return 'apply'
  return expected > pts ? 'skip' : 'gap'
}

/** 缺口出现后等待乱序更新补齐的时间，超时再拉差量 */
export const GAP_WAIT_MS = 500

/**
 * 把缓存的乱序更新按序号依次应用，直到再次遇到缺口。
 * 返回可以立即应用的更新（按顺序）、仍需等待的更新、以及应用后的本地序号。
 */
export function drain<T extends { pts: number; count: number }>(local: number, pending: T[]) {
  const sorted = [...pending].sort((a, b) => a.pts - b.pts)
  const ready: T[] = []
  const waiting: T[] = []
  for (const item of sorted) {
    const verdict = classify(local, item.pts, item.count)
    if (verdict === 'apply') {
      ready.push(item)
      local = item.pts
    } else if (verdict === 'gap') {
      waiting.push(item)
    }
  }
  return { ready, waiting, local }
}

/**
 * 重发前是否要先对账：去重窗口内的条目直接重发，由服务端按 random_id 去重；
 * 更早的条目先对所在会话执行 sync.chat，按 random_id 确认确实没落库再重发。
 * 留 1 分钟余量，避免客户端与服务端时钟偏差导致在窗口边缘重复落库
 */
export function needsReconcile(createdAt: number, now: number): boolean {
  return now - createdAt >= DEDUP_WINDOW_MS - 60_000
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

/** 重连退避：1s 起指数增长，上限 30s，叠加 ±20% 抖动避免多设备同时重连 */
export function reconnectDelay(attempt: number, random = Math.random()): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
  return Math.round(base * (0.8 + random * 0.4))
}

/** 客户端去重 ID：JS 安全整数范围内的随机正整数 */
export function randomId(): number {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2)) as unknown as [number, number]
  return (hi & 0x1fffff) * 2 ** 32 + lo || 1
}
