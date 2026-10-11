import { describe, expect, test } from 'vitest'
import { newSecretChatId, parseSecretChatId } from 'shared/protocol'

import { SEALED_MEDIA_OVERHEAD } from 'shared/protocol'
import { header, newMediaSecret, open, openMedia, safetyCode, seal, sealMedia, type Binding, type SecretPayload } from './format'
import * as mls from './mls'

const CHAT = newSecretChatId('alice', 'bob')
const PAIR = parseSecretChatId(CHAT)!

/** 一台设备：KeyPackage 的私钥留在本地，公开部分交给服务端 */
async function device(userId: string, deviceId: string) {
  const kp = await mls.newKeyPackage(userId, deviceId)
  return { userId, deviceId, data: kp.data, secret: kp.secret }
}

async function sealAs(state: Awaited<ReturnType<typeof mls.decodeState>>, senderId: string, payload: unknown, binding: Binding) {
  return seal(payload, {
    chatId: CHAT,
    senderId,
    binding,
    epoch: mls.epochOf(state),
    leaf: mls.ownLeaf(state),
    key: (await mls.epochKey(state, CHAT)).slice(),
    sign: (m) => mls.sign(state, m),
  })
}

async function openAs<T>(state: Awaited<ReturnType<typeof mls.decodeState>>, cipher: string, senderId: string, binding: Binding, chatId = CHAT) {
  return open<T>(cipher, {
    chatId,
    senderId,
    binding,
    key: (await mls.epochKey(state, chatId)).slice(),
    leaves: mls.leavesOf(state),
    verify: mls.verify,
  })
}

describe('secret chats', () => {
  test('devices that join share the epoch key, verify each other, and agree on the safety code', async () => {
    const bob = await device('bob', 'b1')
    expect(mls.keyPackageIdentity(bob.data)).toEqual(['bob', 'b1'])

    const created = await mls.create(CHAT, PAIR, 'alice', 'a1', [bob.data])
    const joined = await mls.join(created.welcome, [bob.secret], PAIR)
    expect(joined).not.toBeNull()
    const a = created.state
    const b = joined!.state
    expect(mls.epochOf(a)).toBe(1)
    expect(mls.epochOf(b)).toBe(1)

    const payload: SecretPayload = { t: 'text', text: 'hi', random_id: 7 }
    const cipher = await sealAs(a, 'alice', payload, { kind: 'message' })
    expect(header(cipher)).toEqual({ epoch: 1, leaf: mls.ownLeaf(a) })
    expect(await openAs<SecretPayload>(b, cipher, 'alice', { kind: 'message' })).toEqual(payload)

    // 挪到别的发送者、别的用途或别的会话名下都验证不过
    expect(await openAs(b, cipher, 'bob', { kind: 'message' })).toBeNull()
    expect(await openAs(b, cipher, 'alice', { kind: 'edit', seq: 1 })).toBeNull()
    expect(await openAs(b, cipher, 'alice', { kind: 'message' }, newSecretChatId('alice', 'bob'))).toBeNull()

    expect(await safetyCode(mls.leavesOf(a))).toEqual(await safetyCode(mls.leavesOf(b)))
    expect(await safetyCode(mls.leavesOf(a))).toHaveLength(12)
  })

  test('a commit adding a device moves everyone to the next epoch and changes the safety code', async () => {
    const bob = await device('bob', 'b1')
    const created = await mls.create(CHAT, PAIR, 'alice', 'a1', [bob.data])
    const b = (await mls.join(created.welcome, [bob.secret], PAIR))!.state
    const before = await safetyCode(mls.leavesOf(b))

    // bob 的第二台设备：由 bob 的第一台提交加入
    const bob2 = await device('bob', 'b2')
    const next = await mls.commit(b, [bob2.data], [])
    const a = await mls.apply(created.state, next.commit)
    const b2 = (await mls.join(next.welcome!, [bob2.secret], PAIR))!.state
    expect([mls.epochOf(a), mls.epochOf(next.state), mls.epochOf(b2)]).toEqual([2, 2, 2])
    expect(await safetyCode(mls.leavesOf(a))).not.toEqual(before)

    const cipher = await sealAs(b2, 'bob', { emoji: '👍' }, { kind: 'react', seq: 3 })
    expect(await openAs(a, cipher, 'bob', { kind: 'react', seq: 3 })).toEqual({ emoji: '👍' })

    // 状态存下再读出来照样能用
    const restored = mls.decodeState(mls.encodeState(a), PAIR)
    expect(await openAs(restored, cipher, 'bob', { kind: 'react', seq: 3 })).toEqual({ emoji: '👍' })

    // 移除第二台设备后，它的签名不再被接受
    const removed = await mls.commit(a, [], [mls.ownLeaf(b2)])
    const later = await sealAs(b2, 'bob', { t: 'text', text: 'late', random_id: 1 }, { kind: 'message' })
    expect(await openAs(removed.state, later, 'bob', { kind: 'message' })).toBeNull()
  })

  test('a welcome only opens with the key package it was made for', async () => {
    const bob = await device('bob', 'b1')
    const other = await device('bob', 'b1')
    const created = await mls.create(CHAT, PAIR, 'alice', 'a1', [bob.data])
    expect(await mls.join(created.welcome, [other.secret], PAIR)).toBeNull()
    expect((await mls.join(created.welcome, [other.secret, bob.secret], PAIR))?.used).toBe(1)
  })

  test('media objects open only with their own key and role, and grow by the fixed overhead', async () => {
    const secret = newMediaSecret()
    const file = new Blob([new Uint8Array([1, 2, 3, 4, 5])])
    const sealed = await sealMedia(file, secret, 'main')
    expect(sealed.size).toBe(file.size + SEALED_MEDIA_OVERHEAD)
    const bytes = await sealed.arrayBuffer()
    expect(new Uint8Array(await openMedia(bytes, secret, 'main'))).toEqual(new Uint8Array([1, 2, 3, 4, 5]))

    // 同一把密钥每次的 nonce 不同
    expect(new Uint8Array(bytes)).not.toEqual(new Uint8Array(await (await sealMedia(file, secret, 'main')).arrayBuffer()))
    // 换了用途（大图与预览图对调）、换了密钥、被改动过的都打不开
    await expect(openMedia(bytes, secret, 'preview')).rejects.toThrow()
    await expect(openMedia(bytes, newMediaSecret(), 'main')).rejects.toThrow()
    const tampered = new Uint8Array(bytes)
    tampered[20]! ^= 1
    await expect(openMedia(tampered.buffer, secret, 'main')).rejects.toThrow()
    await expect(openMedia(new ArrayBuffer(10), secret, 'main')).rejects.toThrow()
  })
})
