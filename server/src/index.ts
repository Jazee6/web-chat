import { zValidator } from "@hono/zod-validator";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  basePaginationSchema,
  createRoomSchema,
  getUserInfoSchema,
  roomIdSchema,
} from "web-chat-share";
import { auth, authConfig, Session, User } from "./lib/auth";
import * as schema from "./lib/schema/auth";
import { user } from "./lib/schema/auth";
import { roomTable } from "./lib/schema/d1";
import { Room } from "./room";
export { Room } from "./room";

const app = new Hono<{
  Variables: {
    user: User;
    session: Session;
  };
  Bindings: {
    web_chat: D1Database;
    ROOM: DurableObjectNamespace<Room>;
  };
}>();

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
    allowMethods: ["POST", "GET", "OPTIONS", "DELETE"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

app.use("/room/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const a = betterAuth({
    ...authConfig,
    database: drizzleAdapter(drizzle(c.env.web_chat), {
      provider: "sqlite",
      schema,
    }),
  });
  return a.handler(c.req.raw);
});

app.post("/room", zValidator("json", createRoomSchema), async (c) => {
  const { name } = c.req.valid("json");
  const user = c.get("user");
  const db = drizzle(c.env.web_chat);
  const id = c.env.ROOM.newUniqueId().toString();
  await db.insert(roomTable).values({
    id,
    name,
    type: "private",
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
  const db = drizzle(c.env.web_chat);
  const rooms = await db
    .select()
    .from(roomTable)
    .where(eq(roomTable.userId, user.id))
    .orderBy(desc(roomTable.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rooms);
});

app.get("/room/:id/ws", zValidator("param", roomIdSchema), async (c) => {
  const { id } = c.req.valid("param");
  const db = drizzle(c.env.web_chat);
  const room = await db
    .select()
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
  const db = drizzle(c.env.web_chat);
  const room_id = c.env.ROOM.idFromString(id);
  const stub = c.env.ROOM.get(room_id);
  await stub.clearStorage();
  await db
    .delete(roomTable)
    .where(and(eq(roomTable.id, id), eq(roomTable.userId, user.id)));
  return c.body(null, 204);
});

app.post("/room/user", zValidator("json", getUserInfoSchema), async (c) => {
  const { ids } = c.req.valid("json");
  const db = drizzle(c.env.web_chat);
  const users = await db.select().from(user).where(inArray(user.id, ids));
  return c.json(users);
});

export default app;
