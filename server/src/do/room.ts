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
  sessions = new Map<WebSocket, WsSession>();
  realtime = new Map<WebSocket, ServerRealtimeStatus>();
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment() as WsAttachment;
      if (attachment) {
        this.sessions.set(ws, attachment.session);
        if (attachment.realtime) this.realtime.set(ws, attachment.realtime);
      }
    });

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );

    ctx.blockConcurrencyWhile(async () => migrate(this.db, migrations)).then();
  }

  storeSession = (ws: WebSocket, session: WsSession) => {
    ws.serializeAttachment({
      ...ws.deserializeAttachment(),
      session,
    });
    this.sessions.set(ws, session);
  };

  storeRealtime = (ws: WebSocket, realtime?: ServerRealtimeStatus) => {
    ws.serializeAttachment({
      ...ws.deserializeAttachment(),
      realtime,
    });
    if (!realtime) {
      this.realtime.delete(ws);
      return;
    }
    this.realtime.set(ws, realtime);
  };

  async fetch(request: Request): Promise<Response> {
    const userId = new URL(request.url).searchParams.get("user_id");
    if (!userId) return new Response(null, { status: 400 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const session = { id: userId };
    server.serializeAttachment({ session });
    this.sessions.set(server, session);

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: ServerMessage, excludeWs?: WebSocket[]) {
    const msg = gm(message);
    this.sessions.forEach((_, ws) => {
      if (!excludeWs?.includes(ws)) ws.send(msg);
    });
  }

  broadcastRoomStats(excludeWs?: WebSocket[]) {
    this.broadcast(
      {
        type: "roomStats",
        data: { users: Array.from(this.sessions.values()) },
      },
      excludeWs,
    );
  }

  broadcastRealtime(excludeWs?: WebSocket[]) {
    const msg = gm({
      type: "realtimeStatus",
      data: Array.from(this.realtime.values()),
    });
    this.realtime.forEach((_, ws) => {
      if (!excludeWs?.includes(ws)) ws.send(msg);
    });
  }

  broadcastRoomRealTime() {
    this.broadcast({
      type: "roomRealtime",
      data: {
        userIds: Array.from(this.realtime.values()).map((r) => r.userId),
        total: this.realtime.size,
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
      case "join": {
        this.broadcastRoomStats();
        this.broadcastRoomRealTime();

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
      }
      case "send": {
        const meta = this.sessions.get(ws);
        if (!meta) {
          this.handleDisconnect(ws);
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
      }
      case "loadHistory": {
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
      }
      case "userStatus": {
        const currentSession = this.sessions.get(ws);
        if (!currentSession) {
          this.handleDisconnect(ws);
          return;
        }
        const s = {
          ...currentSession,
          status: clientMessage.data,
        };
        this.storeSession(ws, s);

        this.broadcastRoomStats();
        break;
      }
      case "realtimeJoin": {
        const session = this.sessions.get(ws);
        if (!session) {
          this.handleDisconnect(ws);
          return;
        }
        const realtime = {
          userId: session.id,
        };
        this.storeRealtime(ws, realtime);
        this.broadcastRealtime();
        this.broadcastRoomRealTime();
        break;
      }
      case "realtimeUpdate": {
        const r = clientMessage.data;
        const session = this.sessions.get(ws);
        if (!session) {
          this.handleDisconnect(ws);
          return;
        }
        const userId = session.id;
        const realtime = {
          userId,
          ...r,
        };
        this.storeRealtime(ws, realtime);
        this.broadcastRealtime();
        break;
      }
      case "realtimeLeave": {
        this.storeRealtime(ws);
        this.broadcastRealtime();
        this.broadcastRoomRealTime();
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.handleDisconnect(ws);
  }

  handleDisconnect(ws: WebSocket) {
    ws.serializeAttachment(null);
    this.realtime.delete(ws);
    this.sessions.delete(ws);
    this.broadcastRealtime();
    this.broadcastRoomRealTime();
    this.broadcastRoomStats();
    ws.close();
  }

  async clearStorage() {
    await this.ctx.storage.deleteAll();
  }

  alarm() {
    console.log("Alarm triggered, clearing storage");
  }
}
