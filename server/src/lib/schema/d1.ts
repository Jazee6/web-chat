import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const roomTable = sqliteTable("room", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text().notNull(),
  type: text({ enum: ["public", "private"] }).notNull(),
  userId: text().notNull(),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
