import { DurableObject } from "cloudflare:workers";
import Env = Cloudflare.Env;

export class Room extends DurableObject {
  sessions: Map<WebSocket, { [key: string]: string }>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();

    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, { ...attachment });
      }
    });

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID();
    server.serializeAttachment({ id });
    this.sessions.set(server, { id });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const session = this.sessions.get(ws)!;

    this.sessions.forEach((attachment, connectedWs) => {
      if (connectedWs !== ws) {
        connectedWs.send(
          `[Durable Object] message: ${message}, from: ${session.id}, to: all clients except the initiating client. Total connections: ${this.sessions.size}`,
        );
      }
    });
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    this.sessions.delete(ws);
    ws.close(code, "Durable Object is closing WebSocket");
  }
}
