import { DurableObject } from "cloudflare:workers";
import { desc, lt } from "drizzle-orm";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import {
  ClientMessage,
  gm,
  RoomUser,
  ServerMessage,
  type ServerRealtimeStatus,
} from "web-chat-share";
// @ts-ignore
import migrations from "../../drizzle/room/migrations.js";
import { messageTable } from "../lib/schema/room";
import Env = Cloudflare.Env;

type WsSession = RoomUser;

interface WsAttachment {
  session: WsSession;
  realtime: ServerRealtimeStatus;
}

export class Room extends DurableObject {
  sessions: Map<WebSocket, WsSession>;
  realtime: Map<WebSocket, ServerRealtimeStatus>;
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.realtime = new Map();
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment() as WsAttachment;
      if (attachment) {
        this.sessions.set(ws, attachment.session);
        if (attachment.realtime) {
          this.realtime.set(ws, attachment.realtime);
        }
      }
    });

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );

    ctx
      .blockConcurrencyWhile(async () => {
        await this._migrate();
      })
      .then();
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
    server.serializeAttachment({
      session: { id: userId },
    });
    this.sessions.set(server, { id: userId });

    // await this.storage.setAlarm(Date.now() + 1000 * 60 * 60 * 24 * 30);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  broadcast(message: ServerMessage, excludeWs?: WebSocket[]) {
    this.sessions.forEach((_, ws) => {
      if (!excludeWs?.includes(ws)) {
        ws.send(gm(message));
      }
    });
  }

  broadcastRoomStats(excludeWs?: WebSocket[]) {
    this.broadcast(
      {
        type: "roomStats",
        data: {
          users: Array.from(this.sessions.values()),
        },
      },
      excludeWs,
    );
  }

  broadcastRealtime(message: ServerMessage, excludeWs?: WebSocket[]) {
    this.realtime.forEach((_, ws) => {
      if (!excludeWs?.includes(ws)) {
        ws.send(gm(message));
      }
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
        ws.send(
          gm({
            type: "roomRealtime",
            data: {
              total: this.realtime.size,
            },
          }),
        );
        const history = await this.db
          .select()
          .from(messageTable)
          .orderBy(desc(messageTable.createdAt), desc(messageTable.id))
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
          [ws],
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
          .orderBy(desc(messageTable.createdAt), desc(messageTable.id))
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
        ws.serializeAttachment({
          ...ws.deserializeAttachment(),
          session: s,
        });
        this.sessions.set(ws, s);

        this.broadcastRoomStats();
        break;
      case "realtimeJoin": {
        const attachment = ws.deserializeAttachment() as WsAttachment;
        const realtime = {
          userId: attachment.session.id,
        };
        this.realtime.set(ws, realtime);
        ws.serializeAttachment({
          ...attachment,
          realtime,
        });
        ws.send(
          gm({
            type: "realtimeStatus",
            data: Array.from(this.realtime.values()),
          }),
        );
        this.broadcastRealtime(
          {
            type: "realtimeJoin",
            data: realtime,
          },
          [ws],
        );
        this.broadcast({
          type: "roomRealtime",
          data: {
            total: this.realtime.size,
          },
        });

        break;
      }
      case "realtimeUpdate": {
        const r = clientMessage.data;
        const attachment = ws.deserializeAttachment() as WsAttachment;
        const userId = attachment.session.id;
        const realtime = {
          userId,
          ...r,
        };
        ws.serializeAttachment({
          ...attachment,
          realtime,
        });
        this.realtime.set(ws, realtime);

        this.broadcastRealtime(
          {
            type: "realtimeUpdate",
            data: realtime,
          },
          [ws],
        );

        break;
      }
      case "realtimeLeave": {
        const attachment = ws.deserializeAttachment() as WsAttachment;
        ws.serializeAttachment({
          ...attachment,
          realtime: undefined,
        });
        this.realtime.delete(ws);

        this.broadcastRealtime(
          {
            type: "realtimeLeave",
            data: {
              userId: attachment.session.id,
            },
          },
          [ws],
        );
        this.broadcast({
          type: "roomRealtime",
          data: {
            total: this.realtime.size,
          },
        });
        break;
      }
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
    this.realtime.delete(ws);
    this.broadcastRoomStats();
  }

  async clearStorage() {
    await this.ctx.storage.deleteAll();
  }

  alarm() {
    console.log("Alarm triggered, clearing storage");
  }
}
