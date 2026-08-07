import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

beforeAll(async () => {
  const testEnv = env as Cloudflare.Env & {
    TEST_MIGRATIONS: D1Migration[];
  };
  await applyD1Migrations(testEnv.web_chat, testEnv.TEST_MIGRATIONS);
});
