import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  closeTracksSchema,
  renegotiateSchema,
  sessionIdSchema,
  tracksSchema,
} from "web-chat-share";
import { HONOInstance } from "./lib/types";

const baseUrl = "https://rtc.live.cloudflare.com/v1";
const headers = {
  Authorization: `Bearer ${process.env.CLOUDFLARE_SFU_SECRET}`,
};

const realtime = new Hono<HONOInstance>();

realtime.post("/sessions/new", async (c) => {
  return fetch(
    `${baseUrl}/apps/${process.env.CLOUDFLARE_SFU_ID}/sessions/new`,
    {
      method: "POST",
      headers,
    },
  );
});

realtime.post(
  "/sessions/:sessionId/tracks/new",
  zValidator("param", sessionIdSchema),
  zValidator("json", tracksSchema),
  async (c) => {
    const { sessionId } = c.req.valid("param");
    const body = c.req.valid("json");

    return fetch(
      `${baseUrl}/apps/${process.env.CLOUDFLARE_SFU_ID}/${sessionId}/tracks/new`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );
  },
);

realtime.put(
  "/sessions/:sessionId/renegotiate",
  zValidator("param", sessionIdSchema),
  zValidator("json", renegotiateSchema),
  async (c) => {
    const { sessionId } = c.req.valid("param");
    const body = c.req.valid("json");

    return fetch(
      `${baseUrl}/apps/${process.env.CLOUDFLARE_SFU_ID}/sessions/${sessionId}/renegotiate`,
      {
        method: "put",
        headers,
        body: JSON.stringify(body),
      },
    );
  },
);

realtime.put(
  "/sessions/:sessionId/tracks/close",
  zValidator("param", sessionIdSchema),
  zValidator("json", closeTracksSchema),
  async (c) => {
    const { sessionId } = c.req.valid("param");
    const body = c.req.valid("json");

    return fetch(
      `${baseUrl}/apps/${process.env.CLOUDFLARE_SFU_ID}/${sessionId}/tracks/close`,
      {
        method: "put",
        headers,
        body: JSON.stringify(body),
      },
    );
  },
);

realtime.get(
  "/sessions/:sessionId",
  zValidator("param", sessionIdSchema),
  async (c) => {
    const { sessionId } = c.req.valid("param");

    return fetch(
      `${baseUrl}/apps/${process.env.CLOUDFLARE_SFU_ID}/sessions/${sessionId}`,
      {
        headers,
      },
    );
  },
);

export default realtime;
