// 推送的投递：找出要推的设备、通知里的名字与角标，推给每台设备并清除失效的订阅。
// 推什么、怎么写由 notify.ts 决定，见 docs/architecture/04-realtime-and-fanout.md § Web Push
import type { Message, PushPayload, PushSubscriptionKeys } from 'shared/protocol'
import type { FanoutEvent } from '../chat-do'
import type { Sql } from '../sql'
import type { PushOptions } from './webpush'

/** 有推送订阅的设备；push 为订阅的 JSON */
export type PushDevice = { id: string; push: string }

/** 发一条推送，返回推送服务的 HTTP 状态（UserDO.sendPush，测试替换为假的实现） */
export type SendPush = (subscription: PushSubscriptionKeys, payload: PushPayload, options: PushOptions) => Promise<number>

/** 这批事件里推过来电通知的那个通话的记录；找到即清掉记下的来电（1 行） */
export function ringRecord(sql: Sql, events: FanoutEvent[], selfId: string): Message | null {
  const pushed = sql.one<{ value: string }>("SELECT value FROM meta WHERE key = 'ring_pushed'")?.value
  if (!pushed) return null
  for (const e of events) {
    const m = e.type === 'new_message' ? e.message : null
    if (m?.kind === 'service' && m.action.type === 'call' && m.action.call_id === pushed && m.sender_id !== selfId) {
      sql.run("DELETE FROM meta WHERE key = 'ring_pushed'")
      return m
    }
  }
  return null
}

/** 有推送订阅、session 仍然有效的设备；session 已失效的清除订阅（每台 1 行） */
export async function pushDevices(sql: Sql, env: Env, selfId: string, now: number): Promise<PushDevice[]> {
  const devices = sql.all<{ id: string; push: string }>('SELECT id, push FROM devices WHERE push IS NOT NULL AND revoked_at IS NULL')
  if (devices.length === 0) return []
  const { results } = await env.DIRECTORY.prepare('SELECT id FROM session WHERE userId = ? AND expiresAt > ?')
    .bind(selfId, new Date(now).toISOString())
    .all<{ id: string }>()
  const alive = new Set(results.map((s) => s.id))
  for (const d of devices) if (!alive.has(d.id)) sql.run('UPDATE devices SET push = NULL WHERE id = ?', d.id)
  return devices.filter((d) => alive.has(d.id))
}

/** 通知里显示的名字：有备注名的联系人用备注名 */
export async function displayNames(sql: Sql, env: Env, ids: string[]): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(ids)]
  const { results } = await env.DIRECTORY.prepare(`SELECT id, name FROM "user" WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .bind(...unique)
    .all<{ id: string; name: string }>()
  const names = new Map(results.map((u) => [u.id, u]))
  const aliases = sql.all<{ user_id: string; alias: string }>(
    `SELECT user_id, alias FROM relations WHERE contact = 1 AND alias IS NOT NULL AND user_id IN (${unique.map(() => '?').join(', ')})`,
    ...unique,
  )
  for (const a of aliases) names.set(a.user_id, { id: a.user_id, name: a.alias })
  return names
}

/** 推给每台设备；推送服务报告订阅失效（404 / 410）时清除（1 行），其他错误只记录，下一条再试 */
export async function pushTo(sql: Sql, send: SendPush, devices: PushDevice[], payload: PushPayload, options: PushOptions) {
  await Promise.all(
    devices.map(async (device) => {
      const status = await send(JSON.parse(device.push) as PushSubscriptionKeys, payload, options)
      if (status >= 200 && status < 300) return
      if (status !== 404 && status !== 410) return console.error('push rejected', { status })
      sql.run('UPDATE devices SET push = NULL WHERE id = ?', device.id)
    }),
  )
}

/** 角标：所有未静音对话（含只读对话）的未读数之和 */
export function unreadTotal(sql: Sql): number {
  return sql.one<{ n: number }>(
    "SELECT coalesce(sum(max(top_seq - last_read_seq, 0)), 0) AS n FROM dialogs WHERE status != 'deleted' AND muted_until <= ?",
    Date.now(),
  )!.n
}
