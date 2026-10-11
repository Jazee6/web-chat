import type { ErrorCode } from 'shared/protocol'

/** DO 之间 RPC 的返回值：业务错误走返回值，不抛异常 */
export type Failure = { ok: false; e: ErrorCode; user_ids?: string[] }
export type Result<T> = { ok: true; r: T } | Failure

export const ok = <T>(r: T): Result<T> => ({ ok: true, r })
/** userIds：与错误有关的用户，原样带给客户端 */
export const err = (e: ErrorCode, userIds?: string[]): Failure => (userIds ? { ok: false, e, user_ids: userIds } : { ok: false, e })

/** 以不超过 limit 的并发执行（Free 套餐同时等待的连接上限为 6） */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
