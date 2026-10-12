import { Hono } from 'hono'
import { CLOSE_OUTDATED, PROTOCOL_PARAM, PROTOCOL_VERSION } from 'shared/protocol'
import { getAuth, requestIdentity } from './auth'
import { linkPreview } from './link-preview'
import { media } from './media'
import { DEVICE_HEADER, LOCATION_HEADER, USER_HEADER, type DeviceLocation } from './user-do'

export { ChatDO } from './chat-do'
export { UserDO } from './user-do'

const app = new Hono<{ Bindings: Env }>()

/** 必填的 vars 与机密（README § 环境变量）；VAPID、TURN、SFU 可选 */
const REQUIRED = [
  'BETTER_AUTH_URL',
  'OAUTH_DISCOVERY_URL',
  'OAUTH_CLIENT_ID',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'MEDIA_ORIGIN',
  'BETTER_AUTH_SECRET',
  'OAUTH_CLIENT_SECRET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

// 按钮部署之后、补完配置之前：直接说明缺了哪些，而不是在用到它们的地方各自出错
app.use(async (c, next) => {
  const missing = REQUIRED.filter((name) => !c.env[name])
  if (missing.length > 0) return c.text(`Missing configuration: ${missing.join(', ')}`, 500)
  await next()
})

app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth().handler(c.req.raw))

app.route('/api/media', media)
app.route('/api/link-preview', linkPreview)

app.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426)
  // CSWSH 防护：Origin 必须与本站一致
  if (c.req.header('Origin') !== new URL(c.env.BETTER_AUTH_URL).origin) return c.text('forbidden', 403)
  // 旧版本的客户端：浏览器看不到升级失败的 HTTP 状态，只能先接受再以专门的关闭码关闭。在鉴权之前判断，不花 CPU 校验会话
  if (c.req.query(PROTOCOL_PARAM) !== String(PROTOCOL_VERSION)) {
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    server.close(CLOSE_OUTDATED, 'outdated')
    return new Response(null, { status: 101, webSocket: client })
  }

  const identity = await requestIdentity(c.req.raw.headers)
  if (!identity) return c.text('unauthorized', 401)

  // 身份与位置 header 总是由 Worker 覆盖，客户端无法伪造。城市名可能不是 ASCII，整体编码
  const cf = c.req.raw.cf
  const location: DeviceLocation = {
    ip: c.req.header('CF-Connecting-IP') || null,
    country: typeof cf?.country === 'string' ? cf.country : null,
    city: typeof cf?.city === 'string' ? cf.city : null,
  }
  const headers = new Headers(c.req.raw.headers)
  headers.set(USER_HEADER, identity.userId)
  headers.set(DEVICE_HEADER, identity.deviceId)
  headers.set(LOCATION_HEADER, encodeURIComponent(JSON.stringify(location)))
  return c.env.USER.getByName(identity.userId).fetch(new Request(c.req.raw, { headers }))
})

export default app
