import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export const roomTable = sqliteTable(
  "room",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => v7()),
    name: text().notNull(),
    type: text({ enum: ["public", "unlisted"] }).notNull(),
    userId: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastActiveAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("room_public_activity_idx").on(
      table.type,
      table.lastActiveAt,
      table.id,
    ),
  ],
);

export const favoriteRoomTable = sqliteTable("favorite_room", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  userId: text().notNull(),
  roomId: text()
    .notNull()
    .references(() => roomTable.id, { onDelete: "cascade" }),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const roomRelations = relations(roomTable, ({ many }) => ({
  favoriteRooms: many(favoriteRoomTable),
}));

// A user's personal Sticker Library — images favorited from chat for quick
// reuse, referenced by their storage key (sha256). Per-user, cross-room. The
// unique (userId, key) makes favoriting idempotent: favoriting the same image
// twice is a no-op, not an error. See CONTEXT.md "Stickers".
export const stickerTable = sqliteTable(
  "sticker",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => v7()),
    userId: text().notNull(),
    key: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("sticker_userId_key_unique").on(table.userId, table.key),
  ],
);
