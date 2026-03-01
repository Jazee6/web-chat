import { DurableObject } from "cloudflare:workers";
import { desc, lt } from "drizzle-orm";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { ClientMessage, gm, Message, RoomUser } from "web-chat-share";
// @ts-ignore
import migrations from "../drizzle/room/migrations.js";
import { messageTable } from "./lib/schema/room";
import Env = Cloudflare.Env;

type WsSession = RoomUser;

export class Room extends DurableObject {
  sessions: Map<WebSocket, WsSession>;
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment() as WsSession;
      if (attachment) {
        this.sessions.set(ws, attachment);
      }
    });

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );

    ctx.blockConcurrencyWhile(async () => {
      await this._migrate();
    });
  }

  async _migrate() {
    await migrate(this.db, migrations);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(null, { status: 400 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: userId });
    this.sessions.set(server, { id: userId });

    // await this.storage.setAlarm(Date.now() + 1000 * 60 * 60 * 24 * 30);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  broadcast(message: Message, excludeWs?: WebSocket) {
    this.sessions.forEach((_, ws) => {
      if (ws !== excludeWs) {
        ws.send(gm(message));
      }
    });
  }

  broadcastRoomStats() {
    this.broadcast({
      type: "roomStats",
      data: {
        users: Array.from(this.sessions.values()),
      },
    });
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    let clientMessage: ClientMessage;
    try {
      clientMessage = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    switch (clientMessage.type) {
      case "join":
        this.broadcastRoomStats();
        const history = await this.db
          .select()
          .from(messageTable)
          .orderBy(desc(messageTable.createdAt))
          .limit(25);
        ws.send(
          gm({
            type: "initHistory",
            data: history
              .reverse()
              .map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
          }),
        );
        break;
      case "send":
        const meta = this.sessions.get(ws);
        if (!meta) {
          ws.close();
          return;
        }
        const { type, content } = clientMessage.data;
        const data = await this.db
          .insert(messageTable)
          .values({
            type,
            content,
            userId: meta.id,
          })
          .returning()
          .then((i) => i[0]);
        this.broadcast(
          {
            type: "message",
            data: {
              ...data,
              createdAt: data.createdAt.toISOString(),
            },
          },
          ws,
        );
        break;
      case "loadHistory":
        const before = clientMessage.data.before;
        const beforeDate = new Date(before);
        if (isNaN(beforeDate.getTime())) {
          return;
        }
        const moreHistory = await this.db
          .select()
          .from(messageTable)
          .where(lt(messageTable.createdAt, beforeDate))
          .orderBy(desc(messageTable.createdAt))
          .limit(25);
        ws.send(
          gm({
            type: "history",
            data: moreHistory
              .reverse()
              .map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
          }),
        );
        break;
      case "userStatus":
        const currentSession = this.sessions.get(ws);
        if (!currentSession) {
          ws.close();
          return;
        }
        const s = {
          ...currentSession,
          status: clientMessage.data,
        };
        ws.serializeAttachment(s);
        this.sessions.set(ws, s);

        this.broadcastRoomStats();
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.handleDisconnect(ws);
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket) {
    this.handleDisconnect(ws);
    ws.close();
  }

  handleDisconnect(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcastRoomStats();
  }

  async clearStorage() {
    await this.ctx.storage.deleteAll();
  }

  alarm() {
    console.log("Alarm triggered, clearing storage");
  }
}
