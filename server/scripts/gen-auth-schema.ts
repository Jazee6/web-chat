// 由 better-auth 配置生成 D1 迁移 SQL：先在内存 SQLite 上执行已有的迁移，只输出还缺的部分。
// 用法：bun scripts/gen-auth-schema.ts > migrations/000N_<名字>.sql（没有差异时输出为空，不要提交空文件）
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../src/auth/options'

const env = {
  BETTER_AUTH_URL: 'http://localhost',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  OAUTH_DISCOVERY_URL: 'http://localhost/.well-known/openid-configuration',
  OAUTH_CLIENT_ID: 'x',
  OAUTH_CLIENT_SECRET: 'x',
}

const db = new Database(':memory:')
const dir = new URL('../migrations/', import.meta.url)
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  db.run(readFileSync(new URL(file, dir), 'utf8'))
}
const { compileMigrations } = await getMigrations(authOptions(env, db))
console.log(await compileMigrations())
