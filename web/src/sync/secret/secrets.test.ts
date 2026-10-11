// Secrets 的编排（加入、追上提交、替别的设备提交、重新加入、解开消息），对着内存里模拟的服务端跑。
// 服务端的真实行为见 server/test/secret.test.ts
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { describe, expect, test, vi } from 'vitest'
import { newSecretChatId, type ClaimedKeyPackage, type Message, type SecretCommit, type SecretDevice } from 'shared/protocol'

import type { Connection } from '../connection'
import { Store, migrate } from '../store'
import { header, type SecretPayload } from './format'
import { Secrets } from './secrets'

// 不可导出的包装密钥在 IndexedDB 里，测试环境没有：前面加一个字节表示用的是哪把，换了的与真实的 AES-GCM 一样抛 OperationError
vi.mock('./wrap', () => ({
  wrap: async (b: Uint8Array) => Uint8Array.of(1, ...b),
  unwrap: async (b: Uint8Array) => {
    if (b[0] !== 1) throw new DOMException('wrong key', 'OperationError')
    return b.slice(1)
  },
}))

const sqlite3 = await sqlite3InitModule()

type Kp = { ref: string; data: string; last: boolean }

/** 模拟服务端：KeyPackage、组里的设备与提交，规则与 ChatDO / UserDO 相同 */
class FakeServer {
  keys = new Map<string, { user: string; kps: Kp[] }>()
  epoch = 0
  leaves: SecretDevice[] = []
  resets: string[] = []
  commits: (SecretCommit & { welcomeFor: string[] })[] = []
  messages: Message[] = []

  private claim(device: string): ClaimedKeyPackage | null {
    const d = this.keys.get(device)
    if (!d) return null
    const i = d.kps.findIndex((k) => !k.last)
    const kp = i >= 0 ? d.kps.splice(i, 1)[0]! : d.kps.find((k) => k.last)
    return kp ? { user_id: d.user, device_id: device, key_package: kp.data } : null
  }

  private devicesOf(user: string) {
    return [...this.keys].filter(([, d]) => d.user === user).map(([id]) => id)
  }

  handle(user: string, device: string, m: string, p: Record<string, any>): unknown {
    switch (m) {
      case 'secrets.keys': {
        const kps = this.keys.get(device)?.kps ?? []
        return { count: kps.filter((k) => !k.last).length, last_resort: kps.some((k) => k.last), device_id: device }
      }
      case 'secrets.publish': {
        const d = this.keys.get(device) ?? { user, kps: [] }
        if (p.replace) d.kps = []
        if (p.last_resort) d.kps = d.kps.filter((k) => !k.last)
        d.kps.push(...p.key_packages.map((k: Kp) => ({ ...k, last: false })))
        if (p.last_resort) d.kps.push({ ...p.last_resort, last: true })
        this.keys.set(device, d)
        return null
      }
      case 'secrets.prepare':
        return {
          key_packages: [...this.devicesOf(p.user_id), ...this.devicesOf(user).filter((id) => id !== device)]
            .map((id) => this.claim(id))
            .filter((k) => k !== null),
        }
      case 'secrets.create':
        this.epoch = 1
        this.leaves = [{ user_id: user, device_id: device }, ...p.adds]
        this.commits.push({ epoch: 1, sender_id: user, device_id: device, date: 0, commit: null, welcome: p.welcome, adds: p.adds, removes: [], welcomeFor: p.adds.map((a: SecretDevice) => a.device_id) })
        return { seq: 1, pts: 1, date: 0 }
      case 'secrets.state':
        if (this.epoch === 0) throw new Error('not_found')
        return {
          epoch: this.epoch,
          leaves: this.leaves,
          devices: Object.fromEntries(['alice', 'bob'].map((u) => [u, this.devicesOf(u)])),
          resets: this.resets,
        }
      case 'secrets.claim':
        return { key_packages: p.devices.map((d: SecretDevice) => this.claim(d.device_id)).filter((k: unknown) => k !== null) }
      case 'secrets.commit':
        if (p.epoch !== this.epoch + 1) throw new Error('stale_epoch')
        this.epoch = p.epoch
        this.leaves = [...this.leaves.filter((l) => !p.removes.includes(l.device_id)), ...p.adds]
        this.resets = this.resets.filter((id) => !p.adds.some((a: SecretDevice) => a.device_id === id) && !p.removes.includes(id))
        this.commits.push({ epoch: p.epoch, sender_id: user, device_id: device, date: 0, commit: p.commit, welcome: p.welcome, adds: p.adds, removes: p.removes, welcomeFor: p.adds.map((a: SecretDevice) => a.device_id) })
        return null
      case 'secrets.commits':
        return {
          commits: this.commits
            .filter((c) => c.epoch > p.after)
            .map(({ welcomeFor, welcome, ...c }) => ({ ...c, ...(welcomeFor.includes(device) && welcome ? { welcome } : {}) })),
        }
      case 'secrets.reset':
        if (!this.resets.includes(device)) this.resets.push(device)
        return null
      default:
        throw new Error(`unexpected ${m}`)
    }
  }
}

/** 一台设备：自己的本地库与 Secrets，经模拟的连接访问服务端 */
function device(server: FakeServer, user: string, deviceId: string) {
  const db = new sqlite3.oo1.DB(':memory:')
  migrate(db)
  const store = new Store(db, user, () => {})
  const conn = {
    online: true,
    request: async (m: string, p: Record<string, any>) => {
      try {
        return { ok: true, r: server.handle(user, deviceId, m, p) }
      } catch (e) {
        return { ok: false, e: (e as Error).message }
      }
    },
  } as unknown as Connection
  const secrets = new Secrets(store, conn, user, { onReady: () => {}, onReplies: () => {} })
  return { user, deviceId, db, store, secrets, epoch: () => store.secretGroup(CHAT)?.epoch ?? null }
}

const CHAT = newSecretChatId('alice', 'bob')

/** 发一条消息：加密后放进模拟服务端，再推给每台设备 */
async function send(server: FakeServer, from: ReturnType<typeof device>, text: string, to: ReturnType<typeof device>[]) {
  const random_id = server.messages.length + 100
  const { cipher } = await from.secrets.encrypt(CHAT, { t: 'text', text, random_id }, { kind: 'message' })
  const seq = server.messages.length + 1
  const m: Message = { chat_id: CHAT, seq, pts: seq, sender_id: from.user, date: seq, kind: 'cipher', cipher }
  server.messages.push(m)
  for (const d of to) {
    d.store.tx(() => d.store.putMessages(CHAT, [m]))
    d.secrets.unseal()
  }
  return seq
}

const shown = (d: ReturnType<typeof device>, seq: number) =>
  d.store.query('SELECT kind, text FROM messages WHERE chat_id = ? AND seq = ?', [CHAT, seq])[0]

/** 把一段加密的内容（不一定合格）作为新消息推给设备 */
async function push(server: FakeServer, from: ReturnType<typeof device>, plaintext: unknown, to: ReturnType<typeof device>) {
  const { cipher } = await from.secrets.encrypt(CHAT, plaintext as SecretPayload, { kind: 'message' })
  const seq = server.messages.length + 1
  const m: Message = { chat_id: CHAT, seq, pts: seq, sender_id: from.user, date: seq, kind: 'cipher', cipher }
  server.messages.push(m)
  to.store.tx(() => to.store.putMessages(CHAT, [m]))
  to.secrets.unseal()
  return seq
}

describe('Secrets', () => {
  test('start, join, add a device, and rejoin after losing local state', async () => {
    const server = new FakeServer()
    const a1 = device(server, 'alice', 'a1')
    const b1 = device(server, 'bob', 'b1')
    await Promise.all([a1.secrets.onOpen(), b1.secrets.onOpen()])

    // alice 开始秘密聊天，bob 凭 Welcome 加入
    await a1.secrets.start('bob', CHAT, 1)
    await b1.secrets.reconcile(CHAT)
    expect([a1.epoch(), b1.epoch()]).toEqual([1, 1])
    // 创建者自己收到新对话行时的检查不会把自己当成丢了状态的设备
    await a1.secrets.reconcile(CHAT)
    expect(server.resets).toEqual([])
    expect(server.epoch).toBe(1)

    const first = await send(server, a1, 'hello', [a1, b1])
    await vi.waitFor(() => expect(shown(b1, first)).toEqual({ kind: 'text', text: 'hello' }))
    await vi.waitFor(() => expect(shown(a1, first)).toEqual({ kind: 'text', text: 'hello' }))

    // alice 的第二台设备上线：bob 替它提交加入，alice 的第一台追上，第二台凭 Welcome 加入
    const a2 = device(server, 'alice', 'a2')
    await a2.secrets.onOpen()
    await b1.secrets.reconcile(CHAT)
    await a1.secrets.refresh(CHAT)
    await a2.secrets.reconcile(CHAT)
    expect([a1.epoch(), b1.epoch(), a2.epoch()]).toEqual([2, 2, 2])
    const codes = await Promise.all([a1, b1, a2].map((d) => d.secrets.safetyCode(CHAT)))
    expect(codes[1]).toEqual(codes[0])
    expect(codes[2]).toEqual(codes[0])

    // 新设备读不到加入之前的消息（不显示），之后的双方都读得到
    a2.store.tx(() => a2.store.putMessages(CHAT, server.messages))
    a2.secrets.unseal()
    await vi.waitFor(() => expect(shown(a2, first)?.kind).toBe('sealed'))
    expect(a2.secrets.reachedJoin(CHAT, server.messages)).toBe(true)
    const second = await send(server, a2, 'from laptop', [a1, b1])
    await vi.waitFor(() => expect(shown(b1, second)).toEqual({ kind: 'text', text: 'from laptop' }))
    await vi.waitFor(() => expect(shown(a1, second)).toEqual({ kind: 'text', text: 'from laptop' }))
    expect(header(server.messages[1]!.kind === 'cipher' ? server.messages[1]!.cipher : '')?.epoch).toBe(2)

    // bob 的设备丢了本地数据：换掉 KeyPackage，请成员把它重新加入
    // （应用里对话行由 syncUser 同步下来，新对话行触发 reconcile）
    const b1again = device(server, 'bob', 'b1')
    await b1again.secrets.onOpen()
    await b1again.secrets.reconcile(CHAT)
    expect(server.resets).toEqual(['b1'])
    expect(b1again.epoch()).toBeNull()
    await a1.secrets.refresh(CHAT)
    expect(server.epoch).toBe(3)
    await b1again.secrets.reconcile(CHAT)
    await a2.secrets.refresh(CHAT)
    expect([a1.epoch(), a2.epoch(), b1again.epoch()]).toEqual([3, 3, 3])
    expect(server.resets).toEqual([])

    const third = await send(server, b1again, 'back', [a1, a2])
    await vi.waitFor(() => expect(shown(a1, third)).toEqual({ kind: 'text', text: 'back' }))
    await vi.waitFor(() => expect(shown(a2, third)).toEqual({ kind: 'text', text: 'back' }))
  })

  test('a device whose wrapping key is gone rejoins as a new device', async () => {
    const server = new FakeServer()
    const a1 = device(server, 'alice', 'a1')
    const b1 = device(server, 'bob', 'b1')
    await Promise.all([a1.secrets.onOpen(), b1.secrets.onOpen()])
    await a1.secrets.start('bob', CHAT, 1)
    await b1.secrets.reconcile(CHAT)
    const first = await send(server, a1, 'before', [b1])
    await vi.waitFor(() => expect(shown(b1, first)).toEqual({ kind: 'text', text: 'before' }))

    // IndexedDB 被单独清掉、本地库还在：b1 本地的密钥材料都是用旧的包装密钥包的
    const rewrap = (v: unknown) => Uint8Array.of(2, ...(v as Uint8Array).slice(1))
    for (const k of b1.db.selectObjects('SELECT ref, private FROM secret_keys')) {
      b1.db.exec({ sql: 'UPDATE secret_keys SET private = ? WHERE ref = ?', bind: [rewrap(k.private), k.ref as string] })
    }
    for (const g of b1.db.selectObjects('SELECT chat_id, state FROM secret_groups')) {
      b1.db.exec({ sql: 'UPDATE secret_groups SET state = ? WHERE chat_id = ?', bind: [rewrap(g.state), g.chat_id as string] })
    }
    for (const e of b1.db.selectObjects('SELECT chat_id, epoch, key FROM secret_epochs')) {
      b1.db.exec({ sql: 'UPDATE secret_epochs SET key = ? WHERE chat_id = ? AND epoch = ?', bind: [rewrap(e.key), e.chat_id as string, e.epoch as number] })
    }
    await b1.secrets.onOpen()
    await b1.secrets.reconcile(CHAT)
    expect(server.resets).toEqual(['b1'])
    await a1.secrets.refresh(CHAT)
    await b1.secrets.reconcile(CHAT)
    expect([a1.epoch(), b1.epoch()]).toEqual([2, 2])

    // 之前解开的还在；之后的照样读得到
    expect(shown(b1, first)).toEqual({ kind: 'text', text: 'before' })
    const second = await send(server, a1, 'after', [b1])
    await vi.waitFor(() => expect(shown(b1, second)).toEqual({ kind: 'text', text: 'after' }))
  })

  test('a commit raced by another device catches up and retries', async () => {
    const server = new FakeServer()
    const a1 = device(server, 'alice', 'a1')
    const b1 = device(server, 'bob', 'b1')
    await Promise.all([a1.secrets.onOpen(), b1.secrets.onOpen()])
    await a1.secrets.start('bob', CHAT, 1)
    await b1.secrets.reconcile(CHAT)

    // 两台设备同时替新设备提交：只有一个成功，另一个追上后发现已经不用再提交
    const b2 = device(server, 'bob', 'b2')
    await b2.secrets.onOpen()
    await Promise.all([a1.secrets.reconcile(CHAT), b1.secrets.reconcile(CHAT)])
    await b2.secrets.reconcile(CHAT)
    expect(server.epoch).toBe(2)
    expect([a1.epoch(), b1.epoch(), b2.epoch()]).toEqual([2, 2, 2])
  })

  test('media messages carry their keys; malformed content counts as broken', async () => {
    const server = new FakeServer()
    const a1 = device(server, 'alice', 'a1')
    const b1 = device(server, 'bob', 'b1')
    await Promise.all([a1.secrets.onOpen(), b1.secrets.onOpen()])
    await a1.secrets.start('bob', CHAT, 1)
    await b1.secrets.reconcile(CHAT)

    const secret = btoa(String.fromCharCode(...new Uint8Array(32)))
    const key = (name: string) => `test/m/alice/${'A'.repeat(22)}/${name}`
    const photo = { type: 'photo', key: key('sealed'), preview_key: key('preview'), w: 4, h: 3, size: 100, thumbhash: 'AAAA', secret, mime: 'image/gif' }
    const album = await push(server, a1, { t: 'media', media: [photo], random_id: 50 }, b1)
    await vi.waitFor(() => expect(shown(b1, album)?.kind).toBe('media'))
    const row = b1.store.query('SELECT media FROM messages WHERE chat_id = ? AND seq = ?', [CHAT, album])[0]!
    expect(JSON.parse(row.media as string)).toEqual([photo])

    // 待发键、缺密钥、形状不对、甚至只是一个字符串的内容都当作解不开
    const bad = [
      { t: 'media', media: [{ ...photo, key: key('sealed').replace('/m/', '/p/') }], random_id: 51 },
      { t: 'media', media: [{ ...photo, secret: undefined }], random_id: 52 },
      { t: 'text', text: '', random_id: 53 },
      'pending',
    ]
    for (const payload of bad) {
      const seq = await push(server, a1, payload, b1)
      await vi.waitFor(() => expect(shown(b1, seq)?.kind).toBe('broken'))
    }
  })
})
