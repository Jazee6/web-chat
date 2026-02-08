import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/room",
  schema: "./src/lib/schema/room.ts",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
