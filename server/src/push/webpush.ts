// Web Push 发送：RFC 8291 aes128gcm 载荷加密 + RFC 8292 VAPID 鉴权，全部用 WebCrypto 实现。
// 见 docs/architecture/04-realtime-and-fanout.md § Web Push
import type { PushSubscriptionKeys } from 'shared/protocol'

/** 加密记录的大小上限（RFC 8188 的 rs）；载荷只有一条记录，远小于它 */
const RECORD_SIZE = 4096
/** VAPID JWT 的有效期（RFC 8292 上限 24 小时），过期前 1 小时换新 */
const JWT_TTL_S = 12 * 60 * 60
const JWT_RENEW_S = 60 * 60

export type PushOptions = {
  /** 推送服务最多保留多久（秒），设备离线超过这个时间就丢弃 */
  ttl: number
  urgency: 'very-low' | 'low' | 'normal' | 'high'
  /** 同一 topic 尚未送达的消息会被新消息替换（最多 32 个 base64url 字符） */
  topic?: string
}

/** 测试用：固定发送方的临时密钥与盐，以便与 RFC 8291 的示例比对 */
export type EncryptFixture = { senderPrivate: string; senderPublic: string; salt: string }

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** TextEncoder 的结果总是基于 ArrayBuffer，类型声明写得更宽 */
const utf8 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** 未压缩的 P-256 公钥（0x04 || x || y）加上私钥 d，拼成可导入的 JWK */
function privateJwk(d: string, publicKey: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', d, x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)), ext: true }
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** RFC 8291：用接收方的 p256dh 与 auth 加密载荷，返回 aes128gcm 编码的请求体 */
export async function encrypt(
  plaintext: Uint8Array,
  keys: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  fixture?: EncryptFixture,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(keys.p256dh)
  const authSecret = fromBase64Url(keys.auth)
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' }

  let asPrivate: CryptoKey
  let asPublic: Uint8Array<ArrayBuffer>
  if (fixture) {
    asPublic = fromBase64Url(fixture.senderPublic)
    asPrivate = await crypto.subtle.importKey('jwk', privateJwk(fixture.senderPrivate, asPublic), ecdh, false, ['deriveBits'])
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])) as CryptoKeyPair
    asPrivate = pair.privateKey
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  }
  const salt = fixture ? fromBase64Url(fixture.salt) : new Uint8Array(16)
  if (!fixture) crypto.getRandomValues(salt)

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ecdh, false, [])
  // workers-types 把这个字段声明为 $public，运行时实际读取的是 public
  const ecdhParams = { name: 'ECDH', public: uaKey } as SubtleCryptoDeriveKeyAlgorithm
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, asPrivate, 256))
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  // 唯一的一条记录：内容后跟分隔符 0x02，不加填充
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))),
  )
  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, ciphertext)
}

/** RFC 8292：为每个推送服务（按 origin）签发并缓存 VAPID JWT */
export class Vapid {
  private key: Promise<CryptoKey>
  private tokens = new Map<string, { jwt: string; exp: number }>()

  constructor(
    privateKey: string,
    private readonly publicKey: string,
    private readonly subject: string,
  ) {
    this.key = crypto.subtle.importKey(
      'jwk',
      privateJwk(privateKey, fromBase64Url(publicKey)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  }

  async authorization(endpoint: string, now = Date.now()): Promise<string> {
    const aud = new URL(endpoint).origin
    const nowS = Math.floor(now / 1000)
    let token = this.tokens.get(aud)
    if (!token || token.exp - JWT_RENEW_S <= nowS) {
      const exp = nowS + JWT_TTL_S
      const part = (o: object) => toBase64Url(utf8(JSON.stringify(o)))
      const input = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp, sub: this.subject })}`
      // WebCrypto 的 ECDSA 签名就是 JWS 需要的 r || s 格式
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await this.key, utf8(input))
      token = { jwt: `${input}.${toBase64Url(new Uint8Array(sig))}`, exp }
      this.tokens.set(aud, token)
    }
    return `vapid t=${token.jwt}, k=${this.publicKey}`
  }
}

/** 发一条推送；返回推送服务的响应，404 / 410 表示订阅已失效 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  options: PushOptions,
  vapid: Vapid,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: await vapid.authorization(subscription.endpoint),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttl),
    Urgency: options.urgency,
  }
  if (options.topic) headers.Topic = options.topic
  return fetch(subscription.endpoint, { method: 'POST', headers, body: await encrypt(utf8(payload), subscription) })
}

/** Topic 只能用 base64url 字符且最多 32 个：取会话 ID 的哈希 */
export async function pushTopic(chatId: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(chatId)))).slice(0, 32)
}
