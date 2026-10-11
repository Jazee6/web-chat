// 媒体：签发预签名 PUT、删除没发出去的对象、校验对象键的归属。
// 文件字节不经过 Worker，见 docs/architecture/05-media.md
import { AwsClient } from 'aws4fetch'
import { Hono } from 'hono'
import * as v from 'valibot'
import {
  DeleteMediaRequest,
  UploadRequest,
  type LinkPreview,
  type Media,
  type Sticker,
  type UploadResponse,
  type UploadTarget,
} from 'shared/protocol'
import { requestIdentity } from './auth'

/** 预签名 PUT 的有效期：一次发送的所有对象要在这段时间内开始上传 */
const UPLOAD_URL_TTL_S = 60 * 60
/** 对象写入后永不修改（改动即新键），CDN 与浏览器都可以永久缓存 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/png': 'png',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
}

/** 16 字节 → 22 个字符的 base64url（不带填充） */
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * 待发键：{前缀}p/{user_id}/{128bit 随机}/{文件名}。上传者 ID 在键里，发送与删除时据此校验归属；
 * 发送时复制到 m/ 下（shared/protocol 的 sentKey），没发出去的由桶的生命周期规则删除
 */
function newKey(prefix: string, userId: string, name: string) {
  return `${prefix}p/${userId}/${base64url(crypto.getRandomValues(new Uint8Array(16)))}/${name}`
}

/** 键里的文件名只保留 URL 安全的字符；下载时的文件名由 Content-Disposition 给出 */
export function safeName(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100)
  return /^[._]*$/.test(cleaned) ? 'file' : cleaned
}

/** 贴纸对象的文件名 → 格式：添加贴纸时据此得出 mime，不信客户端 */
export const STICKER_NAMES: Record<string, Sticker['mime']> = {
  'sticker.webp': 'image/webp',
  'sticker.png': 'image/png',
  'sticker.gif': 'image/gif',
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 键是否属于该用户：格式必须与 newKey 完全一致，user_id 之后必须紧跟 /。
 * dir 为 p（待发，自己上传的）、m（已发送，发送或转发时复制出来的）或 s（自己添加的贴纸）
 */
export function ownsKey(key: string, prefix: string, userId: string, dir: 'p' | 'm' | 's') {
  return new RegExp(`^${escapeRegExp(prefix)}${dir}/${escapeRegExp(userId)}/[A-Za-z0-9_-]{22}/(?![._]*$)[A-Za-z0-9._-]{1,100}$`).test(key)
}

/** R2 的 S3 接口：预签名 PUT 与 CopyObject 共用 */
function s3(env: Env) {
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
}

// 键只含 URL 安全的字符（见 newKey），不必再编码
const objectUrl = (env: Env, key: string) => `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`

/**
 * 服务端复制一个对象：S3 CopyObject，字节不经过 Worker，Content-Type 等元数据随之复制。
 * 源对象不存在时返回 false，其他失败抛出
 */
export async function copyObject(env: Env, src: string, dst: string): Promise<boolean> {
  const res = await s3(env).fetch(objectUrl(env, dst), { method: 'PUT', headers: { 'x-amz-copy-source': `/${env.R2_BUCKET}/${src}` } })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`copy failed: ${res.status}`)
  return true
}

/**
 * 对象是否存在：S3 HeadObject。走 S3 接口而不是 R2 绑定，本地开发时也查的是真实的桶（与预签名上传、复制一致）
 */
export async function objectExists(env: Env, key: string): Promise<boolean> {
  const res = await s3(env).fetch(objectUrl(env, key), { method: 'HEAD' })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`head failed: ${res.status}`)
  return true
}

/**
 * 转发时复制媒体，新键在转发者名下（格式与 newKey 相同）。目录由 random_id 与原键派生：
 * 重放同一个转发请求写到同样的键，不会多出孤儿对象；random_id 只有转发者自己知道，别人猜不出新键。
 * 贴纸不复制，照旧引用同一个对象（ADR-0012）
 */
export async function copyMedia(
  media: Media[],
  prefix: string,
  userId: string,
  randomId: number,
  copy: (src: string, dst: string) => Promise<void>,
): Promise<Media[]> {
  return allSettled(
    media.map(async (m) => {
      if (m.type === 'sticker') return m
      const base = await copyDir(randomId, m.key)
      const key = copyTarget(prefix, userId, m.key, base)
      if (m.type !== 'photo' && m.type !== 'video') {
        await copy(m.key, key)
        return { ...m, key }
      }
      const preview_key = copyTarget(prefix, userId, m.preview_key, base)
      await allSettled([copy(m.key, key), copy(m.preview_key, preview_key)])
      return { ...m, key, preview_key }
    }),
  )
}

/** 转发时复制链接预览卡片的图片，规则同 copyMedia */
export async function copyPreview(
  preview: LinkPreview,
  prefix: string,
  userId: string,
  randomId: number,
  copy: (src: string, dst: string) => Promise<void>,
): Promise<LinkPreview> {
  if (preview.type !== 'web' || !preview.photo) return preview
  const key = copyTarget(prefix, userId, preview.photo.key, await copyDir(randomId, preview.photo.key))
  await copy(preview.photo.key, key)
  return { ...preview, photo: { ...preview.photo, key } }
}

/** 像 Promise.all，但等所有复制都结束才报错：调用方据此删掉复制出来的对象，不会漏掉还在进行中的 */
async function allSettled<T>(tasks: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks)
  const failed = settled.find((s) => s.status === 'rejected')
  if (failed) throw failed.reason
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value)
}

async function copyDir(randomId: number, key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${randomId}:${key}`))
  return base64url(new Uint8Array(digest).slice(0, 16))
}

const copyTarget = (prefix: string, userId: string, key: string, base: string) =>
  `${prefix}m/${userId}/${base}/${key.slice(key.lastIndexOf('/') + 1)}`

/**
 * 一条媒体消息自己的对象键（撤回时删除）：图片与视频各有两个（大图或视频，与预览图或封面）。
 * 贴纸被所有发过它的消息共用，不算在内（ADR-0012）
 */
export function mediaKeys(media: Media[]): string[] {
  return media.flatMap((m) =>
    m.type === 'photo' || m.type === 'video' ? [m.key, m.preview_key] : m.type === 'sticker' ? [] : [m.key],
  )
}

/** 链接预览卡片的图片键；没有图为 [] */
export function previewKeys(preview: LinkPreview | null | undefined): string[] {
  return preview?.type === 'web' && preview.photo ? [preview.photo.key] : []
}

/** RFC 6266 / 5987：非 ASCII 文件名用 filename*，header 值本身保持 ASCII */
function attachment(name: string) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename*=UTF-8''${encoded}`
}

/**
 * 预签名一个 PUT：content-length、content-type 等都签进去，客户端改动任何一项（包括多传字节）都会被 R2 拒绝。
 * 返回给客户端的 headers 不含 content-length（浏览器自动设置）
 */
async function presign(aws: AwsClient, env: Env, key: string, headers: Record<string, string>): Promise<UploadTarget> {
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_TTL_S))
  const signed = await aws.sign(url, { method: 'PUT', headers, aws: { signQuery: true, allHeaders: true } })
  const { 'content-length': _, ...rest } = headers
  return { key, url: signed.url, headers: rest }
}

export const media = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

// CSRF：只接受本站发起的请求；身份沿用 /ws 的 cookie 缓存校验，不初始化 better-auth
media.use(async (c, next) => {
  if (c.req.header('Origin') !== new URL(c.env.BETTER_AUTH_URL).origin) return c.text('forbidden', 403)
  const identity = await requestIdentity(c.req.raw.headers)
  if (!identity) return c.text('unauthorized', 401)
  c.set('userId', identity.userId)
  await next()
})

media.post('/upload', async (c) => {
  const body = v.safeParse(UploadRequest, await c.req.json().catch(() => null))
  if (!body.success) return c.text('bad request', 400)
  const userId = c.get('userId')
  const prefix = c.env.MEDIA_KEY_PREFIX
  // 同一个客户端复用签名密钥的缓存，一次请求只派生一次
  const aws = s3(c.env)

  const result: UploadResponse = { media: [] }
  for (const m of body.output.media) {
    if (m.type === 'photo' || m.type === 'video') {
      // 视频不带 Content-Disposition，才能在页面里播放
      const mime = m.type === 'photo' ? m.mime : 'video/mp4'
      const main = newKey(prefix, userId, `${m.type}.${EXTENSIONS[mime]}`)
      const preview = main.replace(/[^/]+$/, `preview.${EXTENSIONS[m.preview_mime]}`)
      result.media.push({
        main: await presign(aws, c.env, main, {
          'content-type': mime,
          'content-length': String(m.size),
          'cache-control': CACHE_CONTROL,
        }),
        preview: await presign(aws, c.env, preview, {
          'content-type': m.preview_mime,
          'content-length': String(m.preview_size),
          'cache-control': CACHE_CONTROL,
        }),
      })
    } else if (m.type === 'sealed') {
      // 秘密聊天里加密过的对象：键名与类型都不透露内容，下载也只是密文。
      // 带上 .bin 才在 CDN 默认缓存的扩展名之列
      const main = newKey(prefix, userId, 'sealed.bin')
      const headers = (size: number) => ({
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'cache-control': CACHE_CONTROL,
      })
      result.media.push({
        main: await presign(aws, c.env, main, headers(m.size)),
        ...(m.preview_size !== undefined
          ? { preview: await presign(aws, c.env, main.replace(/[^/]+$/, 'preview.bin'), headers(m.preview_size)) }
          : {}),
      })
    } else if (m.type === 'link' || m.type === 'voice' || m.type === 'sticker') {
      const key = newKey(prefix, userId, `${m.type}.${EXTENSIONS[m.mime]}`)
      result.media.push({
        main: await presign(aws, c.env, key, {
          'content-type': m.mime,
          'content-length': String(m.size),
          'cache-control': CACHE_CONTROL,
        }),
      })
    } else {
      // 文件一律作为附件下载：媒体域名与应用隔离，但仍不让 HTML / SVG 在浏览器里直接打开
      const key = newKey(prefix, userId, safeName(m.name))
      result.media.push({
        main: await presign(aws, c.env, key, {
          'content-type': m.mime,
          'content-length': String(m.size),
          'content-disposition': attachment(m.name),
          'cache-control': CACHE_CONTROL,
        }),
      })
    }
  }
  return c.json(result)
})

/**
 * 删除自己上传、没有发送出去的对象（放弃发送失败的消息、退出登录前清理发件箱）；删除不存在的键不报错。
 * 只接受待发键：已发送的媒体只能撤回，不能借此绕过撤回时限
 */
media.delete('/', async (c) => {
  const body = v.safeParse(DeleteMediaRequest, await c.req.json().catch(() => null))
  if (!body.success) return c.text('bad request', 400)
  const userId = c.get('userId')
  if (!body.output.keys.every((key) => ownsKey(key, c.env.MEDIA_KEY_PREFIX, userId, 'p'))) return c.text('forbidden', 403)
  await c.env.MEDIA.delete(body.output.keys)
  return c.body(null, 204)
})
