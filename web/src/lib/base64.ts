// Uint8Array ↔ base64：标签页、同步 Worker 与 Service Worker 共用

export function toBase64(bytes: Uint8Array): string {
  // 分段展开：大的数组一次展开会超过参数个数上限
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** URL 安全、不带填充的 base64（Web Push 的密钥） */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
