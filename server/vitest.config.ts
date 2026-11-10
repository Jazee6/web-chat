import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const IDP = 'https://idp.invalid'

/**
 * 测试不连真实的 IdP：better-auth 冷启动时会取 discovery 文档，地址解析不了就跳过这个登录方式，
 * workerd 还会报一条 internal error。出站请求先经过这里，IdP 的地址返回假的文档，其他照常发出
 */
async function outbound(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.origin !== IDP) return fetch(request)
  if (url.pathname === '/.well-known/openid-configuration') {
    return Response.json({
      issuer: IDP,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      userinfo_endpoint: `${IDP}/userinfo`,
      end_session_endpoint: `${IDP}/logout`,
      jwks_uri: `${IDP}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
    })
  }
  if (url.pathname === '/jwks') return Response.json({ keys: [] })
  return new Response('not found', { status: 404 })
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: '../wrangler.jsonc' },
      miniflare: {
        // vitest-pool-workers 自带的 workerd 最高只支持到这个日期
        compatibilityDate: '2026-08-22',
        outboundService: outbound,
        bindings: {
          // 测试里的 Origin 固定为本地开发地址，不随 wrangler.jsonc 的部署配置变化
          BETTER_AUTH_URL: 'http://localhost:5173',
          // 测试不连真实的 IdP
          OAUTH_DISCOVERY_URL: `${IDP}/.well-known/openid-configuration`,
          OAUTH_CLIENT_ID: 'web-chat',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
          OAUTH_CLIENT_SECRET: 'test',
          // 测试不连真实的 R2：只校验签发的地址，删除作用于本地模拟的桶
          R2_ACCOUNT_ID: 'test-account',
          MEDIA_ORIGIN: 'https://media.invalid',
          R2_ACCESS_KEY_ID: 'test-access-key',
          R2_SECRET_ACCESS_KEY: 'test-secret-key',
          MEDIA_KEY_PREFIX: 'test/',
          // 测试不连真实的 TURN：只给 STUN
          TURN_KEY_ID: '',
          TURN_KEY_API_TOKEN: '',
          SFU_KEY_ID: '',
          SFU_KEY_API_TOKEN: '',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
})
