import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // vitest-pool-workers 自带的 workerd 最高只支持到这个日期
        compatibilityDate: '2026-08-22',
        bindings: {
          // 测试里的 Origin 固定为本地开发地址，不随 wrangler.jsonc 的部署配置变化
          BETTER_AUTH_URL: 'http://localhost:5173',
          // 测试不连真实的 IdP
          OAUTH_DISCOVERY_URL: 'https://idp.invalid/.well-known/openid-configuration',
          OAUTH_CLIENT_ID: 'web-chat',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
          OAUTH_CLIENT_SECRET: 'test',
          // 测试不连真实的 R2：只校验签发的地址，删除作用于本地模拟的桶
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
