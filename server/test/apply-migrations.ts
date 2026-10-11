import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'

const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] }
await applyD1Migrations(env.DIRECTORY, TEST_MIGRATIONS)
