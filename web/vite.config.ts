import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { cloudflare } from '@cloudflare/vite-plugin'
import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const SW_ENTRY = 'src/sw/index.ts'

/**
 * Service Worker 固定发布为 /sw.js（地址不能带哈希），构建时在开头定义 __SW_BUILD__：外壳文件清单与版本号。
 * 开发时把 /sw.js 映射到源文件，由 Vite 按模块转译
 */
function swBuild(): Plugin {
  return {
    name: 'sw-build',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/sw.js') req.url = `/${SW_ENTRY}`
        next()
      })
    },
    generateBundle(_options, bundle) {
      const sw = Object.values(bundle).find((f) => f.type === 'chunk' && f.fileName === 'sw.js')
      if (!sw || sw.type !== 'chunk') return
      // AAC 编码器（约 1MB）只有没有原生 AAC 编码的浏览器转码视频时才用到；AI 降噪的 wasm 有两份（SIMD 与否）只用其一，
      // 且只在通话、录音时用到。都不预缓存，用到时再取
      const files = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/') && !name.endsWith('.map') && !name.includes('aac-encoder') && !name.includes('rnnoise'))
        .sort()
        .map((name) => `/${name}`)
      // 资源名带哈希，index.html 的变化也要换版本
      const index = bundle['index.html']
      const hash = createHash('sha256').update(files.join('\n'))
      if (index?.type === 'asset') hash.update(index.source)
      const version = hash.digest('hex').slice(0, 12)
      if (!sw.code.includes('__SW_BUILD__')) this.error('sw.js 没有引用 __SW_BUILD__')
      sw.code = `const __SW_BUILD__ = ${JSON.stringify({ version, files })};\n${sw.code}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    swBuild(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // 在 workerd 中运行 server，前后端同源
    cloudflare({ configPath: '../server/wrangler.jsonc' }),
  ],
  resolve: { tsconfigPaths: true },
  // 构建版本（src/lib/build.ts）：开发时每次启动开发服务器都算一次新的构建
  define: { __BUILD__: JSON.stringify(Date.now()) },
  // BETTER_AUTH_URL、/ws 的 Origin 校验与 IdP 回调地址都依赖这个固定来源
  server: { port: 5173, strictPort: true },
  // SQLite WASM 自带 wasm 与 worker 资源，不能被预打包
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          input: { index: 'index.html', sw: SW_ENTRY },
          output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
        },
      },
    },
  },
})
