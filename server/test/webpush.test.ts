import { describe, expect, it } from 'vitest'
import { Vapid, encrypt, fromBase64Url, pushTopic, toBase64Url } from '../src/push/webpush'

describe('encrypt', () => {
  it('与 RFC 8291 § 5 的示例逐字节一致', async () => {
    const body = await encrypt(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        salt: 'DGv6ra1nlYgDCS1FRnbzlw',
      },
    )
    expect(toBase64Url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
        'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
        'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })
})

describe('Vapid', () => {
  async function keyPair() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
    const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    return { d: jwk.d!, publicKey: toBase64Url(raw), verifyKey: pair.publicKey }
  }

  it('JWT 的 aud 为推送服务的 origin，签名可用公钥验证；同一服务复用到临近过期', async () => {
    const { d, publicKey, verifyKey } = await keyPair()
    const vapid = new Vapid(d, publicKey, 'https://chat.jaze.top')
    const now = Date.UTC(2026, 8, 29)
    const header = await vapid.authorization('https://fcm.googleapis.com/fcm/send/abc', now)

    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(k).toBe(publicKey)
    const [h, c, s] = jwt!.split('.') as [string, string, string]
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(c)))
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://chat.jaze.top' })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      fromBase64Url(s),
      new TextEncoder().encode(`${h}.${c}`),
    )
    expect(ok).toBe(true)

    expect(await vapid.authorization('https://fcm.googleapis.com/fcm/send/other', now + 60_000)).toBe(header)
    expect(await vapid.authorization('https://fcm.googleapis.com/fcm/send/abc', now + 11.5 * 3600_000)).not.toBe(header)
  })
})

describe('pushTopic', () => {
  it('是 32 个 base64url 字符', async () => {
    expect(await pushTopic('g:abc')).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})
