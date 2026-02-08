import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export const roomTable = sqliteTable("room", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  name: text().notNull(),
  type: text({ enum: ["public", "private"] }).notNull(),
  userId: text().notNull(),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const favoriteRoomTable = sqliteTable("favorite_room", {
  id: text()
    .primaryKey()
    .$defaultFn(() => v7()),
  userId: text().notNull(),
  roomId: text().notNull(),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const roomRelations = relations(roomTable, ({ many }) => ({
  favoriteRooms: many(favoriteRoomTable),
}));
