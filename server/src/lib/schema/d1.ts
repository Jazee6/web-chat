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
    deletionRequestedAt: integer({ mode: "timestamp" }),
    deletionReason: text({ enum: ["owner", "expiration"] }),
  },
  (table) => [
    index("room_public_activity_idx").on(
      table.type,
      table.lastActiveAt,
      table.id,
    ),
    index("room_expiration_idx").on(
      table.deletionRequestedAt,
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

export const imageAssetTable = sqliteTable(
  "image_asset",
  {
    key: text().primaryKey(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    unreferencedAt: integer({ mode: "timestamp" }),
    reclaimingAt: integer({ mode: "timestamp" }),
  },
  (table) => [index("image_asset_reclamation_idx").on(table.unreferencedAt)],
);

// A row starts as an Image Reservation and becomes an Image Reference when
// messageId is filled. Its deterministic id makes every transition retry-safe.
export const imageRetentionTable = sqliteTable(
  "image_retention",
  {
    id: text().primaryKey(),
    key: text()
      .notNull()
      .references(() => imageAssetTable.key, { onDelete: "cascade" }),
    roomId: text()
      .notNull()
      .references(() => roomTable.id, { onDelete: "cascade" }),
    userId: text().notNull(),
    submissionId: text(),
    messageId: text(),
    position: integer().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("image_retention_key_idx").on(table.key),
    index("image_retention_room_idx").on(table.roomId),
  ],
);

export const maintenanceStateTable = sqliteTable("maintenance_state", {
  id: integer().primaryKey(),
  imageBackfillRoomCursor: text(),
  imageBackfillR2Cursor: text(),
  imageBackfillRoomsComplete: integer({ mode: "boolean" })
    .notNull()
    .default(false),
  imageBackfillR2Complete: integer({ mode: "boolean" })
    .notNull()
    .default(false),
  imageBackfillCompletedAt: integer({ mode: "timestamp" }),
  imageReclamationReadyAt: integer({ mode: "timestamp" }),
});
