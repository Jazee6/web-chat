// 单测覆盖纯逻辑与本地库的 SQL（sqlite-wasm 内存库），运行在 Node 中；不加载 vite.config.ts（其中的 Cloudflare 插件会启动 workerd）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __BUILD__: '0' },
  test: { include: ['src/**/*.test.ts'] },
})
