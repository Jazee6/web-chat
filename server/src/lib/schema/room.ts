import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messageTable = sqliteTable("message", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text().notNull(),
  userId: text().notNull(),
  type: text({ enum: ["text"] })
    .notNull()
    .default("text"),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
