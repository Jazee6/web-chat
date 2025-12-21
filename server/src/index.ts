import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  basePaginationSchema,
  createRoomSchema,
  roomIdSchema,
} from "web-chat-share";
import { auth } from "./lib/auth";
import { roomTable } from "./lib/schema";
import { Room } from "./room";
export { Room } from "./room";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
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

  return new Response("Internal Server Error", { status: 500 });
});

app.use(
  cors({
    origin: process.env.SITE_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
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
  return auth.handler(c.req.raw);
});

app.post("/room", zValidator("json", createRoomSchema), async (c) => {
  const { name } = c.req.valid("json");
  const user = c.get("user");
  const db = drizzle(c.env.web_chat);
  const { id } = await db
    .insert(roomTable)
    .values({
      name,
      userId: user.id,
    })
    .returning()
    .then((r) => r[0]);
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

app.get("/room/:id", zValidator("param", roomIdSchema), async (c) => {
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

  const room_id = c.env.ROOM.idFromName(room.id);
  const stub = c.env.ROOM.get(room_id);
  return stub.fetch(c.req.raw);
});

export default app;
