import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { getCookieCache } from 'better-auth/cookies'
import { authOptions } from './options'

function createAuth() {
  return betterAuth({
    ...authOptions(env, env.DIRECTORY),
    databaseHooks: {
      session: {
        delete: {
          // 退出登录：UserDO 不经手 session 的删除，要告诉它设备少了一台，秘密聊天才会把这台设备移出组
          after: async (session) => {
            try {
              await env.USER.getByName(session.userId).onDevicesChanged(session.userId)
            } catch (e) {
              console.error('devices changed failed', { user_id: session.userId, error: String(e) })
            }
          },
        },
      },
    },
  })
}

let instance: ReturnType<typeof createAuth> | undefined

/**
 * 惰性创建：DO 与 Worker 同一个模块，顶层初始化会让每次 DO 冷启动都去抓 IdP 发现文档。
 */
export function getAuth() {
  return (instance ??= createAuth())
}

export type Identity = { userId: string; deviceId: string }

/**
 * /ws 升级与 /api/media/* 的身份校验。实测经由 better-auth 的 getSession 每次 30–50ms CPU，超出 Free 套餐的 10ms
 * （见 06 § Worker CPU 风险），所以先直接校验 compact 策略的 cookie 缓存：只有一次 HMAC，不初始化
 * better-auth、不查 D1。语义与 getSession 命中缓存时相同（吊销最多延迟 cookieCache.maxAge 生效）；
 * 缓存缺失或过期时再走完整的 getSession。
 */
export async function requestIdentity(headers: Headers): Promise<Identity | null> {
  const cached = await getCookieCache(headers, {
    secret: env.BETTER_AUTH_SECRET,
    // 与 better-auth 默认一致：baseURL 为 https 时 cookie 名带 __Secure- 前缀
    isSecure: new URL(env.BETTER_AUTH_URL).protocol === 'https:',
  })
  if (cached) return { userId: cached.user.id, deviceId: cached.session.id }

  const session = await getAuth().api.getSession({ headers })
  return session ? { userId: session.user.id, deviceId: session.session.id } : null
}
