// 秘密聊天的密文格式、加解密与安全码。不依赖 ts-mls：签名与验证由调用方传入。
// 见 docs/adr/0010-secret-chats-multi-device-mls.md
import { SEALED_MEDIA_OVERHEAD, type ReactionEmoji, type SealedMedia, type SecretPayload } from 'shared/protocol'

export type { SealedMedia, SecretPayload }

/**
 * 密文（base64）：版本（1 字节）| 纪元（4）| 发送设备的叶子序号（4）| nonce（12）| AES-256-GCM 密文 | Ed25519 签名（64）。
 * AES-GCM 的附加数据与签名都覆盖绑定信息：会话、发送者与用途（新消息、编辑第几条、回应第几条），
 * 服务端因此不能把一条密文挪到别的会话、别的发送者名下，也不能把编辑或回应挪到别的消息上
 */
const VERSION = 1
const HEADER = 21
const SIGNATURE = 64

/** 组里的一台设备：叶子序号、身份与签名公钥（base64） */
export type Leaf = { index: number; user_id: string; device_id: string; sig: string }

export type SecretReaction = { emoji: ReactionEmoji }

/** 密文的用途 */
export type Binding = { kind: 'message' } | { kind: 'edit'; seq: number } | { kind: 'react'; seq: number }

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 只读头部：纪元与叶子序号；格式不对返回 null */
export function header(cipher: string): { epoch: number; leaf: number } | null {
  try {
    const head = fromBase64(cipher.slice(0, 32))
    if (head.length < 9 || head[0] !== VERSION) return null
    const view = new DataView(head.buffer)
    return { epoch: view.getUint32(1), leaf: view.getUint32(5) }
  } catch {
    return null
  }
}

const enc = new TextEncoder()

function context(chatId: string, senderId: string, binding: Binding): Uint8Array {
  const use = binding.kind === 'message' ? 'message' : `${binding.kind}:${binding.seq}`
  return enc.encode(`web-chat/secret/v1\n${chatId}\n${senderId}\n${use}\n`)
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function aesKey(raw: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt') {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage])
}

export async function seal(
  plaintext: unknown,
  o: {
    chatId: string
    senderId: string
    binding: Binding
    epoch: number
    leaf: number
    key: Uint8Array<ArrayBuffer>
    sign: (message: Uint8Array) => Promise<Uint8Array>
  },
): Promise<string> {
  const head = new Uint8Array(HEADER)
  const view = new DataView(head.buffer)
  head[0] = VERSION
  view.setUint32(1, o.epoch)
  view.setUint32(5, o.leaf)
  head.set(crypto.getRandomValues(new Uint8Array(12)), 9)
  const ctx = context(o.chatId, o.senderId, o.binding)
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: head.subarray(9), additionalData: concat(ctx, head) },
      await aesKey(o.key, 'encrypt'),
      enc.encode(JSON.stringify(plaintext)),
    ),
  )
  const signature = await o.sign(concat(ctx, head, body))
  return toBase64(concat(head, body, signature))
}

/**
 * 解开并验证：叶子必须属于 senderId，签名与 AES-GCM 都要对得上；不对的返回 null
 */
export async function open<T>(
  cipher: string,
  o: {
    chatId: string
    senderId: string
    binding: Binding
    key: Uint8Array<ArrayBuffer>
    leaves: Leaf[]
    verify: (publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => Promise<boolean>
  },
): Promise<T | null> {
  try {
    const bytes = fromBase64(cipher)
    if (bytes.length < HEADER + 16 + SIGNATURE || bytes[0] !== VERSION) return null
    const head = bytes.subarray(0, HEADER)
    const body = bytes.subarray(HEADER, bytes.length - SIGNATURE)
    const signature = bytes.subarray(bytes.length - SIGNATURE)
    const leaf = o.leaves.find((l) => l.index === new DataView(bytes.buffer).getUint32(5))
    if (!leaf || leaf.user_id !== o.senderId) return null
    const ctx = context(o.chatId, o.senderId, o.binding)
    if (!(await o.verify(fromBase64(leaf.sig), concat(ctx, head, body), signature))) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: head.subarray(9), additionalData: concat(ctx, head) },
      await aesKey(o.key, 'decrypt'),
      body,
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

/**
 * 安全码：所有设备的身份与签名公钥排序后取 SHA-512，前 60 字节每 5 字节换成一组 5 位数，共 12 组。
 * 双方看到的一样，说明双方的设备都是对方以为的那些
 */
export async function safetyCode(leaves: Leaf[]): Promise<string[]> {
  const items = leaves.map((l) => `${l.user_id}\n${l.device_id}\n${l.sig}`).sort()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', enc.encode(items.join('\n\n'))))
  const groups: string[] = []
  for (let i = 0; i < 12; i++) {
    const n = digest.subarray(i * 5, i * 5 + 5).reduce((acc, b) => acc * 256 + b, 0)
    groups.push(String(n % 100000).padStart(5, '0'))
  }
  return groups
}

// ---------- 媒体 ----------

/** 加密媒体对象的两种用途：大图（视频、文件、录音）与预览图（封面），存储不能把两者调换 */
export type MediaRole = 'main' | 'preview'

const mediaContext = (role: MediaRole) => enc.encode(`web-chat/secret-media/v1\n${role}\n`)

/** 新的媒体密钥：每个媒体一把，大图与预览图共用（nonce 各自随机） */
export function newMediaSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
}

/** 加密一个媒体对象：nonce（12 字节）| AES-256-GCM 密文，比原文件多 SEALED_MEDIA_OVERHEAD 字节 */
export async function sealMedia(file: Blob, secret: string, role: MediaRole): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(fromBase64(secret), 'encrypt')
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: mediaContext(role) }, key, await file.arrayBuffer())
  return new Blob([iv, body])
}

/** 解开一个媒体对象；被改动过、密钥或用途不对时抛出 */
export async function openMedia(sealed: ArrayBuffer, secret: string, role: MediaRole): Promise<ArrayBuffer> {
  if (sealed.byteLength < SEALED_MEDIA_OVERHEAD) throw new Error('sealed media too short')
  const key = await aesKey(fromBase64(secret), 'decrypt')
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: mediaContext(role) }, key, sealed.slice(12))
}
