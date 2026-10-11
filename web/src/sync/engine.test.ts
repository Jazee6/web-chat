import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { describe, expect, test, vi } from 'vitest'
import { privateChatId, type Call } from 'shared/protocol'

import type { WorkerMessage } from './bridge'
import type { Connection } from './connection'
import { Engine } from './engine'
import { Store, migrate } from './store'

const sqlite3 = await sqlite3InitModule()

/** 只有 request 的连接：每个请求挂起，由测试决定何时返回 */
function setup() {
  const db = new sqlite3.oo1.DB(':memory:')
  migrate(db)
  const pending = new Map<string, (r: unknown) => void>()
  const conn = {
    request: (method: string) => new Promise((resolve) => pending.set(method, resolve)),
  } as unknown as Connection
  const emitted: WorkerMessage[] = []
  const engine = new Engine(new Store(db, 'me', () => {}), conn, 'me', (m) => emitted.push(m))
  return { engine, pending, emitted }
}

const chatId = privateChatId('me', 'peer')
const ringing: Call = { call_id: 'c1', chat_id: chatId, caller_id: 'peer', callee_id: 'me', state: 'ringing', started_at: 1 }

describe('calls', () => {
  test('接听的结果返回前到达的信令转给接听的标签页', async () => {
    vi.useFakeTimers()
    const { engine, pending, emitted } = setup()
    engine.onEvents([{ type: 'call', call: ringing }])
    const accepted = engine.acceptCall({ chatId, callId: 'c1' }, 'tab1')
    // 服务端已通知主叫方，主叫方的 offer 先于 calls.accept 的返回到达
    engine.onEvents([{ type: 'call', call: { ...ringing, state: 'active' } }])
    engine.onEvents([{ type: 'call_signal', call_id: 'c1', data: 'offer' }])
    expect(emitted).toContainEqual({ k: 'call_signal', tab: 'tab1', call_id: 'c1', data: 'offer' })

    pending.get('calls.accept')!({ ok: true, r: { call: { ...ringing, state: 'active' }, ice_servers: [] } })
    await accepted
    vi.useRealTimers()
  })
})

describe('通话状态', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const states = (emitted: WorkerMessage[]) => emitted.filter((m) => m.k === 'call_state')

  test('新 Worker 第一次问过服务端后，没有通话也告诉标签页；之后重连只在原来有通话时才说', async () => {
    const { engine, pending, emitted } = setup()
    void engine.onOpen()
    pending.get('calls.current')!({ ok: true, r: { call: null } })
    await settle()
    expect(states(emitted)).toEqual([{ k: 'call_state', call: null, tab: null }])

    // 正在拨出、服务端还没有这个通话时重连：不能把它当成结束
    void engine.onOpen()
    pending.get('calls.current')!({ ok: true, r: { call: null } })
    await settle()
    expect(states(emitted)).toHaveLength(1)
  })
})
