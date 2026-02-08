import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export const messageTable = sqliteTable("message", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  content: text().notNull(),
  userId: text().notNull(),
  type: text({ enum: ["text"] })
    .notNull()
    .default("text"),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
