import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cache } from "hono/cache";
import { cors } from "hono/cors";
import { showRoutes } from "hono/dev";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import {
  basePaginationSchema,
  createRoomRequestSchema,
  favoriteStickerSchema,
  getImageSchema,
  getPresignedUrlSchema,
  getRoomInfoSchema,
  getUserInfoSchema,
  linkPreviewQuerySchema,
  publicRoomPaginationSchema,
  roomIdSchema,
  stickerIdSchema,
  updateRoomAiSchema,
  updateRoomVisibilitySchema,
} from "web-chat-share";
import realtime from "./api/realtime";
import { getAuth } from "./lib/auth";
import { fetchLinkPreview } from "./lib/preview";
import { createS3 } from "./lib/s3";
import * as authSchema from "./lib/schema/auth";
import { user } from "./lib/schema/auth";
import * as d1Schema from "./lib/schema/d1";
import { favoriteRoomTable, roomTable, stickerTable } from "./lib/schema/d1";
import { HONOInstance } from "./lib/types";
export { Room } from "./do/room";

const dbCache = new WeakMap<D1Database, ReturnType<typeof drizzle>>();
const getDb = (db: D1Database) => {
  let cached = dbCache.get(db);
  if (!cached) {
    cached = drizzle(db);
    dbCache.set(db, cached);
  }
  return cached;
};

const d1DbCache = new WeakMap<
  D1Database,
  ReturnType<typeof drizzle<typeof d1Schema>>
>();
const getD1Db = (db: D1Database) => {
  let cached = d1DbCache.get(db);
  if (!cached) {
    cached = drizzle(db, { schema: d1Schema });
    d1DbCache.set(db, cached);
  }
  return cached;
};

const authDbCache = new WeakMap<
  D1Database,
  ReturnType<typeof drizzle<typeof authSchema>>
>();
const getAuthDb = (db: D1Database) => {
  let cached = authDbCache.get(db);
  if (!cached) {
    cached = drizzle(db, { schema: authSchema });
    authDbCache.set(db, cached);
  }
  return cached;
};

const app = new Hono<HONOInstance>();
const PUBLIC_ROOM_PAGE_SIZE = 20;

const encodePublicRoomCursor = (lastActiveAt: Date, id: string) =>
  btoa(JSON.stringify([lastActiveAt.getTime(), id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const decodePublicRoomCursor = (cursor: string) => {
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const [timestamp, id] = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    ) as unknown[];
    if (
      typeof timestamp !== "number" ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      typeof id !== "string" ||
      !id
    ) {
      throw new Error("Invalid cursor payload");
    }
    return { lastActiveAt: new Date(timestamp), id };
  } catch {
    throw new HTTPException(400, { message: "Invalid cursor" });
  }
};

app.onError((err) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  console.error(err);
  return new Response("Internal Server Error", { status: 500 });
});

app.use(
  cors({
    origin: process.env.SITE_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS", "DELETE", "PUT", "PATCH"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

app.use("/room/*", async (c, next) => {
  const a = getAuth(c.env.web_chat);
  const session = await a.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

// The Sticker Library is user-scoped, not room-scoped, but shares the same
// auth gate. See CONTEXT.md "Stickers".
app.use("/sticker/*", async (c, next) => {
  const a = getAuth(c.env.web_chat);
  const session = await a.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const a = getAuth(c.env.web_chat);
  return a.handler(c.req.raw);
});

app.post("/room", zValidator("json", createRoomRequestSchema), async (c) => {
  const { name, type } = c.req.valid("json");
  const user = c.get("user");
  const db = getDb(c.env.web_chat);
  const roomCount = await db.$count(roomTable, eq(roomTable.userId, user.id));
  if (roomCount >= 10) {
    throw new HTTPException(400, { message: "Room limit reached" });
  }
  const id = c.env.ROOM.newUniqueId().toString();
  const now = new Date();
  await db.insert(roomTable).values({
    id,
    name,
    type,
    userId: user.id,
    createdAt: now,
    lastActiveAt: now,
  });
  return c.json(
    {
      id,
    },
    201,
  );
});

app.get("/room", zValidator("query", basePaginationSchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const user = c.get("user");
  const db = getD1Db(c.env.web_chat);
  const rooms = await db.query.roomTable.findMany({
    columns: {
      userId: false,
    },
    where: eq(roomTable.userId, user.id),
    orderBy: [desc(roomTable.createdAt)],
    limit,
    offset,
  });
  return c.json(rooms);
});

app.get(
  "/room/public",
  zValidator("query", publicRoomPaginationSchema),
  async (c) => {
    const country = c.req.raw.cf?.country;
    if (!country) {
      console.warn("Public Room Discovery request has no country metadata");
    }
    if (country === "CN") {
      return c.json(
        {
          code: "PUBLIC_ROOM_DISCOVERY_REGION_RESTRICTED",
          message: "Public Room Discovery is unavailable in this region",
        },
        403,
      );
    }

    const { cursor: rawCursor } = c.req.valid("query");
    const cursor = rawCursor ? decodePublicRoomCursor(rawCursor) : undefined;
    const db = getDb(c.env.web_chat);
    const rooms = await db
      .select({
        id: roomTable.id,
        name: roomTable.name,
        lastActiveAt: roomTable.lastActiveAt,
      })
      .from(roomTable)
      .where(
        and(
          eq(roomTable.type, "public"),
          cursor
            ? or(
                lt(roomTable.lastActiveAt, cursor.lastActiveAt),
                and(
                  eq(roomTable.lastActiveAt, cursor.lastActiveAt),
                  lt(roomTable.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(roomTable.lastActiveAt), desc(roomTable.id))
      .limit(PUBLIC_ROOM_PAGE_SIZE + 1);

    const page = rooms.slice(0, PUBLIC_ROOM_PAGE_SIZE);
    const last = page.at(-1);
    return c.json({
      rooms: page,
      nextCursor:
        rooms.length > PUBLIC_ROOM_PAGE_SIZE && last
          ? encodePublicRoomCursor(last.lastActiveAt, last.id)
          : null,
    });
  },
);

app.get(
  "/room/favorite",
  zValidator("query", basePaginationSchema),
  async (c) => {
    const { limit, offset } = c.req.valid("query");
    const user = c.get("user");
    const db = getD1Db(c.env.web_chat);
    const rooms = await db
      .select({
        favorite_room: {
          id: favoriteRoomTable.id,
          createdAt: favoriteRoomTable.createdAt,
        },
        room: {
          roomId: roomTable.id,
          name: roomTable.name,
        },
      })
      .from(favoriteRoomTable)
      .where(eq(favoriteRoomTable.userId, user.id))
      .leftJoin(roomTable, eq(favoriteRoomTable.roomId, roomTable.id))
      .orderBy(desc(roomTable.createdAt))
      .limit(limit)
      .offset(offset);
    return c.json(
      rooms.map((i) => ({
        ...i.room,
        ...i.favorite_room,
      })),
    );
  },
);

app.get(
  "/room/preview",
  zValidator("query", linkPreviewQuerySchema),
  cache({
    cacheName: "link-preview",
    cacheControl: "max-age=86400",
  }),
  async (c) => {
    const { url } = c.req.valid("query");
    const preview = await fetchLinkPreview(url);
    return c.json(preview);
  },
);

app.get("/room/:id/ws", zValidator("param", roomIdSchema), async (c) => {
  const { id } = c.req.valid("param");
  const db = getDb(c.env.web_chat);
  const room = await db
    .select({
      id: roomTable.id,
    })
    .from(roomTable)
    .where(eq(roomTable.id, id))
    .limit(1)
    .then((r) => r[0]);
  if (!room) {
    throw new HTTPException(404, { message: "Room not found" });
  }

  const room_id = c.env.ROOM.idFromString(room.id);
  const stub = c.env.ROOM.get(room_id);
  const url = new URL(c.req.url);
  url.searchParams.set("user_id", c.get("user").id);
  return stub.fetch(url, c.req.raw);
});

app.delete("/room/:id", zValidator("param", roomIdSchema), async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  const db = getDb(c.env.web_chat);
  const room_id = c.env.ROOM.idFromString(id);
  const stub = c.env.ROOM.get(room_id);
  const deletedRoom = await db
    .delete(roomTable)
    .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)))
    .returning({ id: roomTable.id });

  if (deletedRoom.length > 0) {
    await stub.clearStorage();
    await db.delete(favoriteRoomTable).where(eq(favoriteRoomTable.roomId, id));
  }

  return c.body(null, 204);
});

app.patch(
  "/room/:id/visibility",
  zValidator("param", roomIdSchema),
  zValidator("json", updateRoomVisibilitySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { type } = c.req.valid("json");
    const user = c.get("user");
    const db = getDb(c.env.web_chat);
    const room = await db
      .select({
        id: roomTable.id,
        type: roomTable.type,
        createdAt: roomTable.createdAt,
      })
      .from(roomTable)
      .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!room) {
      throw new HTTPException(404, { message: "Room not found" });
    }
    if (room.type === type) {
      return c.body(null, 204);
    }

    if (type === "public") {
      const stub = c.env.ROOM.get(c.env.ROOM.idFromString(id));
      const latestMessageAt = await stub.getLatestActivity();
      await db
        .update(roomTable)
        .set({ type, lastActiveAt: latestMessageAt ?? room.createdAt })
        .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)));

      // Close the gap between the first history read and publication. Messages
      // after publication project themselves with MAX(), so this second read
      // only has to capture messages accepted while the room was unlisted.
      try {
        const latestAfterPublish = await stub.getLatestActivity();
        if (latestAfterPublish) {
          await db
            .update(roomTable)
            .set({ lastActiveAt: latestAfterPublish })
            .where(
              and(
                eq(roomTable.id, id),
                eq(roomTable.userId, user.id),
                eq(roomTable.type, "public"),
                lt(roomTable.lastActiveAt, latestAfterPublish),
              ),
            );
        }
      } catch (error) {
        console.error("Failed to reconcile Room Activity after publish", error);
      }
    } else {
      await db
        .update(roomTable)
        .set({ type })
        .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)));
    }

    return c.body(null, 204);
  },
);

app.patch(
  "/room/:id/ai",
  zValidator("param", roomIdSchema),
  zValidator("json", updateRoomAiSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { enabled } = c.req.valid("json");
    const user = c.get("user");
    const db = getDb(c.env.web_chat);
    const room = await db
      .select({ id: roomTable.id })
      .from(roomTable)
      .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!room) {
      throw new HTTPException(404, { message: "Room not found" });
    }

    const stub = c.env.ROOM.get(c.env.ROOM.idFromString(id));
    await stub.setAiEnabled(enabled);
    return c.body(null, 204);
  },
);

app.get(
  "/room/user",
  zValidator("query", getUserInfoSchema),
  cache({
    cacheName: "user-info",
    cacheControl: "max-age=3600",
  }),
  async (c) => {
    const { ids } = c.req.valid("query");
    const db = getAuthDb(c.env.web_chat);
    const users = await db.query.user.findMany({
      columns: {
        id: true,
        name: true,
        image: true,
      },
      where: inArray(user.id, ids),
    });
    return c.json(users);
  },
);

app.get("/room/:id/info", zValidator("param", getRoomInfoSchema), async (c) => {
  const { id } = c.req.valid("param");
  const db = getD1Db(c.env.web_chat);
  const info = await db
    .select({
      room: {
        id: roomTable.id,
        name: roomTable.name,
        type: roomTable.type,
        userId: roomTable.userId,
        createdAt: roomTable.createdAt,
      },
      favorite: favoriteRoomTable.id,
    })
    .from(roomTable)
    .where(eq(roomTable.id, id))
    .leftJoin(
      favoriteRoomTable,
      and(
        eq(favoriteRoomTable.roomId, roomTable.id),
        eq(favoriteRoomTable.userId, c.get("user").id),
      ),
    )
    .limit(1)
    .then((r) => r[0]);
  if (!info) {
    throw new HTTPException(404, { message: "Room not found" });
  }
  const stub = c.env.ROOM.get(c.env.ROOM.idFromString(id));
  const aiEnabled = await stub.getAiEnabled();
  return c.json({
    ...info.room,
    isFavorite: !!info.favorite,
    aiEnabled,
  });
});

app.post("/room/:id/favorite", zValidator("param", roomIdSchema), async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  const db = getD1Db(c.env.web_chat);
  const f = await db.query.favoriteRoomTable.findFirst({
    where: and(
      eq(d1Schema.favoriteRoomTable.roomId, id),
      eq(d1Schema.favoriteRoomTable.userId, user.id),
    ),
  });
  if (f) {
    throw new HTTPException(400, { message: "Already added to favorite list" });
  }
  await db.insert(favoriteRoomTable).values({
    userId: user.id,
    roomId: id,
  });
  return c.body(null, 201);
});

app.delete(
  "/room/:id/favorite",
  zValidator("param", roomIdSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const user = c.get("user");
    const db = getD1Db(c.env.web_chat);
    await db
      .delete(favoriteRoomTable)
      .where(
        and(
          eq(favoriteRoomTable.roomId, id),
          eq(favoriteRoomTable.userId, user.id),
        ),
      );
    return c.body(null, 204);
  },
);

app.post(
  "/room/upload/presigned",
  zValidator("json", getPresignedUrlSchema),
  async (c) => {
    const { sha256List } = c.req.valid("json");

    const res = await Promise.all(
      sha256List.map(async (hash) => {
        const key = `images/${hash}`;
        const object = await c.env.FILE.head(key);
        if (object) {
          return {
            url: null,
            key: hash,
          };
        }
        const s3_url = new URL(
          `https://${c.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/web-chat/${key}`,
        );
        s3_url.searchParams.set("X-Amz-Expires", "60");
        const s3 = createS3(c.env);
        const signed = await s3.sign(new Request(s3_url, { method: "PUT" }), {
          aws: { signQuery: true },
        });
        return {
          url: signed.url,
          key: hash,
        };
      }),
    );

    return c.json(res);
  },
);

app.get(
  "/room/images/:key",
  zValidator("param", getImageSchema),
  cache({
    cacheName: "image",
    cacheControl: "public, max-age=31536000, immutable",
  }),
  async (c) => {
    const { key } = c.req.valid("param");
    const object = await c.env.FILE.get(`images/${key}`);
    if (!object) {
      throw new HTTPException(404, { message: "Image not found" });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/webp",
      },
    });
  },
);

// A user's Sticker Library — images favorited from chat, referenced by their
// storage key. Cross-room, per-user. See CONTEXT.md "Stickers".
app.get(
  "/sticker",
  zValidator("query", basePaginationSchema),
  etag(),
  async (c) => {
    const { limit, offset } = c.req.valid("query");
    const user = c.get("user");
    const db = getD1Db(c.env.web_chat);
    const stickers = await db.query.stickerTable.findMany({
      columns: { id: true, key: true, createdAt: true },
      where: eq(stickerTable.userId, user.id),
      orderBy: [desc(stickerTable.createdAt), desc(stickerTable.id)],
      limit,
      offset,
    });
    return c.json(stickers);
  },
);

app.post("/sticker", zValidator("json", favoriteStickerSchema), async (c) => {
  const { key } = c.req.valid("json");
  const user = c.get("user");
  const db = getD1Db(c.env.web_chat);
  // Idempotent: favoriting the same image twice is a no-op, not an error. The
  // unique (userId, key) index enforces it; on conflict, return the existing
  // row as if the insert succeeded.
  await db
    .insert(stickerTable)
    .values({
      userId: user.id,
      key,
    })
    .onConflictDoNothing();
  return c.body(null, 201);
});

app.delete("/sticker/:id", zValidator("param", stickerIdSchema), async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  const db = getD1Db(c.env.web_chat);
  await db
    .delete(stickerTable)
    .where(and(eq(stickerTable.id, id), eq(stickerTable.userId, user.id)));
  return c.body(null, 204);
});

app.route("/room", realtime);

showRoutes(app);

export default app;
