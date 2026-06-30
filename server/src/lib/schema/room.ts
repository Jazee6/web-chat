import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";
import type { ReplyRef } from "web-chat-share";

export const messageTable = sqliteTable("message", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  content: text().notNull(),
  userId: text().notNull(),
  type: text({ enum: ["text", "image"] })
    .notNull()
    .default("text"),
  // Stored as a JSON blob — drizzle parses/stringifies it, and the server
  // never reads into it. It holds the denormalized reply snapshot. See ADR 0003.
  replyTo: text({ mode: "json" }).$type<ReplyRef>(),
  createdAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
