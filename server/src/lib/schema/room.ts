import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";
import type { ReplyRef } from "web-chat-share";

export const messageTable = sqliteTable("message", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  content: text().notNull(),
  authorType: text({ enum: ["user", "ai", "system"] })
    .notNull()
    .default("user"),
  userId: text(),
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

export const roomSettingTable = sqliteTable("room_setting", {
  id: integer().primaryKey(),
  aiEnabled: integer({ mode: "boolean" }).notNull().default(false),
});

export const roomAiCooldownTable = sqliteTable("room_ai_cooldown", {
  userId: text().primaryKey(),
  acceptedAt: integer().notNull(),
});
