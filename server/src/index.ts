import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cache } from "hono/cache";
import { cors } from "hono/cors";
import { showRoutes } from "hono/dev";
import { HTTPException } from "hono/http-exception";
import {
  basePaginationSchema,
  createRoomSchema,
  getImageSchema,
  getPresignedUrlSchema,
  getRoomInfoSchema,
  getUserInfoSchema,
  linkPreviewQuerySchema,
  roomIdSchema,
} from "web-chat-share";
import realtime from "./api/realtime";
import { getAuth } from "./lib/auth";
import { fetchLinkPreview } from "./lib/preview";
import { createS3 } from "./lib/s3";
import * as authSchema from "./lib/schema/auth";
import { user } from "./lib/schema/auth";
import * as d1Schema from "./lib/schema/d1";
import { favoriteRoomTable, roomTable } from "./lib/schema/d1";
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

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const a = getAuth(c.env.web_chat);
  return a.handler(c.req.raw);
});

app.post("/room", zValidator("json", createRoomSchema), async (c) => {
  const { name, type } = c.req.valid("json");
  const user = c.get("user");
  const db = getDb(c.env.web_chat);
  const roomCount = await db.$count(roomTable, eq(roomTable.userId, user.id));
  if (roomCount >= 10) {
    throw new HTTPException(400, { message: "Room limit reached" });
  }
  const id = c.env.ROOM.newUniqueId().toString();
  await db.insert(roomTable).values({
    id,
    name,
    type,
    userId: user.id,
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
  return c.json({ ...info.room, isFavorite: !!info.favorite });
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

app.route("/room", realtime);

showRoutes(app);

export default app;
