import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export const messageTable = sqliteTable("message", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  content: text().notNull(),
  userId: text().notNull(),
  type: text({ enum: ["text", "image"] })
    .notNull()
    .default("text"),
  createdAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
