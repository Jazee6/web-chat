import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const roomTable = sqliteTable("room", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text().notNull(),
  userId: text().notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull().default(new Date()),
});
