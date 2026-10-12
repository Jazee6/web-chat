// 单测覆盖纯逻辑与本地库的 SQL（sqlite-wasm 内存库），运行在 Node 中；不加载 vite.config.ts（其中的 Cloudflare 插件会启动 workerd）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vite.config.ts 的 deployConfig 插件的替身：测试不依赖部署配置
  plugins: [
    {
      name: 'deploy-config',
      resolveId: (source) => (source === 'virtual:deploy' ? '\0virtual:deploy' : undefined),
      load: (id) => (id === '\0virtual:deploy' ? "export const MEDIA_ORIGIN = 'https://media.invalid'\nexport const VAPID_PUBLIC_KEY = ''" : undefined),
    },
  ],
  resolve: { tsconfigPaths: true },
  define: { __BUILD__: '0' },
  test: { include: ['src/**/*.test.ts'] },
})
