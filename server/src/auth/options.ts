// better-auth 配置。与运行时解耦，scripts/gen-auth-schema.ts 也用它生成 D1 迁移。
// 见 docs/architecture/06-auth-and-security.md
import type { BetterAuthOptions } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'

export type AuthEnv = {
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  OAUTH_DISCOVERY_URL: string
  OAUTH_CLIENT_ID: string
  OAUTH_CLIENT_SECRET: string
}

const PROVIDER_ID = 'idp'
/** cookie 缓存有效期（秒）：被移除的设备最多还能凭缓存通过 Worker 校验这么久，UserDO 据此保留移除记录 */
export const COOKIE_CACHE_MAX_AGE = 5 * 60

export function authOptions(env: AuthEnv, database: BetterAuthOptions['database']) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database,
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 天
      updateAge: 60 * 60 * 24, // 每天最多续期一次，控制 D1 写入
      cookieCache: { enabled: true, maxAge: COOKIE_CACHE_MAX_AGE, strategy: 'compact' },
    },
    rateLimit: { enabled: false }, // 内置限流在 Workers 上无法跨实例共享
    telemetry: { enabled: false },
    advanced: {
      // 表结构由 wrangler d1 migrations 管理；关闭运行时校验，省掉每次冷启动的 D1 自省查询
      database: { validateSchema: false },
      // 只把会话 cookie 设为 Strict；OAuth state cookie 保持默认 Lax，否则 IdP 回调带不上
      cookies: {
        session_token: { attributes: { sameSite: 'strict' } },
        session_data: { attributes: { sameSite: 'strict' } },
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: PROVIDER_ID,
            clientId: env.OAUTH_CLIENT_ID,
            clientSecret: env.OAUTH_CLIENT_SECRET,
            // IdP 登记的客户端认证方式是 client_secret_basic，better-auth 默认用 client_secret_post
            authentication: 'basic',
            discoveryUrl: env.OAUTH_DISCOVERY_URL,
            scopes: ['openid', 'profile', 'email'],
            pkce: true,
            requireIdTokenVerification: true,
            postLogoutRedirectURI: `${env.BETTER_AUTH_URL}/`,
            overrideUserInfo: true,
          },
        ],
      }),
    ],
  } satisfies BetterAuthOptions
}
