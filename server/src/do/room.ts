import { DurableObject } from "cloudflare:workers";
import { desc, lt } from "drizzle-orm";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import {
  clientMessageSchema,
  gm,
  RoomUser,
  ServerMessage,
  type ChatMessage,
  type ClientMessage,
  type ServerRealtimeStatus,
} from "web-chat-share";
// @ts-ignore
import migrations from "../../drizzle/room/migrations.js";
import { messageTable } from "../lib/schema/room";
import Env = Cloudflare.Env;

type WsSession = RoomUser;

type MessageRow = typeof messageTable.$inferSelect;

// Maps a message row to the wire ChatMessage shape. The replyTo column is
// JSON-mode, so drizzle already parsed it into a ReplyRef (or null) — coerce
// null→undefined for the wire shape. See ADR 0003.
const toClientMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
  replyTo: row.replyTo ?? undefined,
});

interface WsAttachment {
  session: WsSession;
  realtime?: ServerRealtimeStatus;
  tabId?: string;
  // Set on a reconnecting socket whose Call entry was stolen by a later tab.
  // realtimeJoin must then silently fail instead of evicting the active tab.
  // See ADR 0001.
  callStolen?: boolean;
}

// See docs/adr/0001-call-disconnect-grace.md.
const DISCONNECT_GRACE_MS = 10_000;

interface Tombstone {
  tabId: string;
  userId: string;
  ws: WebSocket;
  timeoutId: ReturnType<typeof setTimeout>;
  // True when a later tab has taken over this entry via the "later tab kicks
  // earlier" rule. The tombstone is kept (not deleted) so the original tab's
  // reconnect can detect the takeover and silently fail its join instead of
  // stealing the Call back from the active tab. See ADR 0001.
  stolen?: boolean;
}

export class Room extends DurableObject {
  sessions = new Map<WebSocket, WsSession>();
  realtime = new Map<WebSocket, ServerRealtimeStatus>();
  // Call entries whose WebSocket has dropped but are within the grace window.
  // Keyed by tabId so a reconnecting tab can rebind transparently.
  // Not persisted: a DO restart inside the grace window evicts these (peers
  // will see Left on the next broadcast). Per the ADR this is accepted.
  tombstones = new Map<string, Tombstone>();
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

    void ctx.blockConcurrencyWhile(async () => migrate(this.db, migrations));
  }

  async getLatestActivity(): Promise<Date | null> {
    const latest = await this.db
      .select({ createdAt: messageTable.createdAt })
      .from(messageTable)
      .orderBy(desc(messageTable.createdAt), desc(messageTable.id))
      .limit(1)
      .then((rows) => rows[0]);
    return latest?.createdAt ?? null;
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

  getTabId = (ws: WebSocket): string | undefined => {
    return (ws.deserializeAttachment() as WsAttachment | null)?.tabId;
  };

  // Drop any Call entries (live or tombstoned) belonging to this userId
  // except for `keepWs`. Used to enforce "later tab kicks earlier" when a
  // fresh realtimeJoin arrives for a userId that already has a Participant.
  evictOtherEntriesForUser = (userId: string, keepWs: WebSocket | null) => {
    for (const [tid, tomb] of this.tombstones) {
      if (tomb.userId === userId && tomb.ws !== keepWs) {
        clearTimeout(tomb.timeoutId);
        this.realtime.delete(tomb.ws);
        // Mark stolen rather than delete: if the original tab reconnects
        // within the grace window, it must learn its entry was taken over so
        // its join can silently fail (keeping the active tab's Call). Re-arm
        // the grace timeout so the stolen marker self-cleans — a reconnect
        // past the window is indistinguishable from a fresh tab anyway.
        tomb.stolen = true;
        tomb.timeoutId = setTimeout(() => {
          this.tombstones.delete(tid);
        }, DISCONNECT_GRACE_MS);
      }
    }
    for (const [otherWs, r] of this.realtime) {
      if (otherWs === keepWs) continue;
      if (r.userId !== userId) continue;
      this.realtime.delete(otherWs);
      const a = (otherWs.deserializeAttachment() ?? {}) as WsAttachment;
      otherWs.serializeAttachment({ ...a, realtime: undefined });
    }
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    const tabId = url.searchParams.get("tab_id");
    if (!userId || !tabId) return new Response(null, { status: 400 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const session = { id: userId };

    // If this tab had a Call entry that's currently in the grace window,
    // rebind it to the new socket without surfacing a Joined/Left blip.
    // A stolen tombstone means a later tab already took this entry over —
    // don't rebind; let this socket get a clean session and silently fail
    // its realtimeJoin (the active tab keeps the Call). See ADR 0001.
    const tomb = this.tombstones.get(tabId);
    if (tomb && tomb.userId === userId && !tomb.stolen) {
      clearTimeout(tomb.timeoutId);
      this.tombstones.delete(tabId);
      const carriedRealtime = this.realtime.get(tomb.ws);
      this.realtime.delete(tomb.ws);
      if (carriedRealtime) this.realtime.set(server, carriedRealtime);
      server.serializeAttachment({
        session,
        realtime: carriedRealtime,
        tabId,
      } satisfies WsAttachment);
    } else {
      // A stolen tombstone for this tab is now spent — clean it up so it
      // doesn't outlive the reconnect it was waiting for. Flag the socket so
      // its realtimeJoin can silently fail rather than steal the Call back.
      if (tomb?.stolen) {
        this.tombstones.delete(tabId);
        server.serializeAttachment({
          session,
          tabId,
          callStolen: true,
        } satisfies WsAttachment);
      } else {
        server.serializeAttachment({ session, tabId } satisfies WsAttachment);
      }
    }
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
      if (excludeWs?.includes(ws)) return;
      // A tombstoned WebSocket is intentionally still in this.realtime so
      // its entry stays visible to peers during the grace window — but it's
      // closed, so don't try to send to it.
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(msg);
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
    const parsed = clientMessageSchema.safeParse(
      (() => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })(),
    );
    if (!parsed.success) return;
    const clientMessage: ClientMessage = parsed.data;

    switch (clientMessage.type) {
      case "join": {
        this.broadcastRoomStats();
        this.broadcastRoomRealTime();

        // Catch this socket up to the current Call state. New visitors and
        // tabs that just rebound from a tombstone both come through here, so
        // they can render Participants without waiting for the next change.
        ws.send(
          gm({
            type: "realtimeStatus",
            data: Array.from(this.realtime.values()),
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
            data: history.reverse().map(toClientMessage),
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
        const { type, content, replyTo } = clientMessage.data;
        const data = await this.db
          .insert(messageTable)
          .values({
            type,
            content,
            userId: meta.id,
            replyTo,
          })
          .returning()
          .then((i) => i[0]);
        // Discovery ordering is a best-effort projection. A failed D1 update
        // must never turn an accepted Chat Message into a send failure.
        this.ctx.waitUntil(
          this.env.web_chat
            .prepare(
              "UPDATE room SET lastActiveAt = MAX(lastActiveAt, ?) WHERE id = ? AND type = 'public'",
            )
            .bind(
              Math.floor(data.createdAt.getTime() / 1000),
              this.ctx.id.toString(),
            )
            .run()
            .catch((error) => {
              console.error("Failed to project Room Activity", error);
            }),
        );
        this.broadcast(
          {
            type: "message",
            data: toClientMessage(data),
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
            data: moreHistory.reverse().map(toClientMessage),
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
        // Merge, not replace: typing is sent by an independent effect that
        // emits a partial {typing}, while presence emits a partial {user,
        // screen}. Replacing would let one clobber the other — e.g. a typing
        // update would blank the avatar's idle/locked badge. See ADR 0002.
        const s = {
          ...currentSession,
          status: { ...currentSession.status, ...clientMessage.data },
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
        // This socket's entry was stolen by a later tab — silently fail the
        // join so the active tab keeps the Call. The reconnecting tab learns
        // it's absent from realtimeStatus and exits via its kicked-tab
        // watcher. See ADR 0001.
        const attachment = (ws.deserializeAttachment() ?? {}) as WsAttachment;
        if (attachment.callStolen) {
          return;
        }
        // Later tab kicks earlier — drop any other entry for this user
        // before recording the new one.
        this.evictOtherEntriesForUser(session.id, ws);
        // If a tombstone-rebind in fetch() already carried over an entry for
        // this socket, preserve its audio.id rather than clobbering it.
        const existing = this.realtime.get(ws);
        const realtime: ServerRealtimeStatus = {
          ...existing,
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
    this.handleSocketDrop(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.handleSocketDrop(ws);
  }

  // The socket dropped — could be a tab close, a network blip, or anything
  // in between. If it held a Call entry, give the tab `DISCONNECT_GRACE_MS`
  // to come back before evicting and broadcasting Left. Otherwise this
  // collapses to the same cleanup the old handleDisconnect did.
  handleSocketDrop(ws: WebSocket) {
    const tabId = this.getTabId(ws);
    const realtime = this.realtime.get(ws);

    if (tabId && realtime) {
      const timeoutId = setTimeout(() => {
        const t = this.tombstones.get(tabId);
        if (!t) return; // already rebound or evicted by a kick
        this.tombstones.delete(tabId);
        this.realtime.delete(t.ws);
        this.broadcastRealtime();
        this.broadcastRoomRealTime();
      }, DISCONNECT_GRACE_MS);
      this.tombstones.set(tabId, {
        tabId,
        userId: realtime.userId,
        ws,
        timeoutId,
      });
      // Intentionally do NOT broadcast realtime/roomRealtime — peers should
      // not see a leave during the grace window.
      this.sessions.delete(ws);
      this.broadcastRoomStats();
      ws.close();
      return;
    }

    // No Call entry to preserve — proceed with the original cleanup.
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
