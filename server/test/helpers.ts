import { env, runInDurableObject } from 'cloudflare:test'
import { makeSignature } from 'better-auth/crypto'
import type { ErrorCode, LinkPreview, Media, Method, MethodParams, MethodResults, ServerFrame, Transient, Update } from 'shared/protocol'
import { getAuth } from '../src/auth'
import type { ChatDO } from '../src/chat-do'
import { mediaKeys, previewKeys } from '../src/media'
import { DEVICE_HEADER, USER_HEADER, type UserDO } from '../src/user-do'

export const uid = () => crypto.randomUUID()

export async function createUser(email = `${uid()}@example.com`) {
  const id = uid()
  const now = new Date().toISOString()
  await env.DIRECTORY.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, ?, ?)',
  )
    .bind(id, `name-${id.slice(0, 8)}`, email.toLowerCase(), now, now)
    .run()
  return { id, email }
}

/** 与 better-auth test-utils 相同：直接建 session 并签名 session_token cookie */
export async function login(userId: string) {
  const ctx = await getAuth().$context
  const session = await ctx.internalAdapter.createSession(userId)
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`
  return { session, cookie: `${ctx.authCookies.sessionToken.name}=${signed}` }
}

export type Reply<M extends Method> = { ok: true; r: MethodResults[M] } | { ok: false; e: ErrorCode; user_ids?: string[] }

export type Client = Awaited<ReturnType<typeof connect>>

/** 在 D1 中为用户建一个 session（即一台设备），返回 device_id */
export async function createSession(
  userId: string,
  { expiresAt = Date.now() + 60_000, userAgent = null as string | null, ipAddress = '' } = {},
) {
  const id = uid()
  const now = new Date().toISOString()
  await env.DIRECTORY.prepare(
    'INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, new Date(expiresAt).toISOString(), uid(), now, now, ipAddress, userAgent, userId)
    .run()
  return id
}

/** 绕过 Worker 鉴权，直接连到 UserDO */
export async function connect(userId: string, deviceId = uid(), headers: Record<string, string> = {}) {
  const res = await env.USER.getByName(userId).fetch('http://do/ws', {
    headers: { ...headers, Upgrade: 'websocket', [USER_HEADER]: userId, [DEVICE_HEADER]: deviceId },
  })
  const ws = res.webSocket
  if (!ws) throw new Error(`upgrade failed: ${res.status}`)
  ws.accept()

  let nextId = 1
  const waiting = new Map<number, (frame: Extract<ServerFrame, { t: 'res' }>) => void>()
  const updates: Update[] = []
  const events: Transient[] = []
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener('close', resolve))

  ws.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data as string) as ServerFrame
    if (frame.t === 'res') waiting.get(frame.id)?.(frame)
    else if (frame.t === 'upd') updates.push(...frame.u)
    else events.push(...frame.e)
  })

  // 测试不连真实的 R2：发送与转发时的复制、查询作用于本地模拟的桶
  await inUser(userId, (o) => {
    o.copyObject = localCopy
    o.objectExists = async (key) => (await env.MEDIA.head(key)) !== null
  })

  return {
    ws,
    deviceId,
    updates,
    events,
    closed,
    call<M extends Method>(m: M, p: MethodParams<M>): Promise<Reply<M>> {
      return this.raw({ t: 'req', id: nextId++, m, p }) as Promise<Reply<M>>
    },
    raw(frame: { t: string; id: number; m: string; p: unknown }): Promise<Reply<Method>> {
      return new Promise((resolve) => {
        waiting.set(frame.id, (res) =>
          resolve(res.ok ? { ok: true, r: res.r as never } : res.user_ids ? { ok: false, e: res.e, user_ids: res.user_ids } : { ok: false, e: res.e }),
        )
        ws.send(JSON.stringify(frame))
      })
    },
    close: () => ws.close(),
  }
}

export async function eventually<T>(fn: () => T | Promise<T>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}

export const inChat = <R>(chatId: string, fn: (o: ChatDO, state: DurableObjectState) => R | Promise<R>) =>
  runInDurableObject<ChatDO, R>(env.CHAT.getByName(chatId), fn)
export const inUser = <R>(userId: string, fn: (o: UserDO, state: DurableObjectState) => R | Promise<R>) =>
  runInDurableObject<UserDO, R>(env.USER.getByName(userId), fn)

export const chatWrites = (chatId: string) => inChat(chatId, (o) => o.sql.rowsWritten)
export const userWrites = (userId: string) => inUser(userId, (o) => o.sql.rowsWritten)

/** 本地模拟的桶上的复制，与 S3 CopyObject 一样复制元数据；源对象不存在时返回 false */
export async function localCopy(src: string, dst: string): Promise<boolean> {
  const obj = await env.MEDIA.get(src)
  if (!obj) return false
  await env.MEDIA.put(dst, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata })
  return true
}

/** 模拟上传：把媒体消息里的待发对象写进本地模拟的桶，原样返回 */
export async function stored<T extends Media[]>(media: [...T]): Promise<[...T]> {
  for (const key of mediaKeys(media)) await env.MEDIA.put(key, 'x')
  return media
}

/** 模拟上传链接预览卡片的图片 */
export async function storedPreview<T extends LinkPreview>(preview: T): Promise<T> {
  for (const key of previewKeys(preview)) await env.MEDIA.put(key, 'x')
  return preview
}

export const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
