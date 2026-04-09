import { Hono } from "hono";
import { routePartyTracksRequest } from "partytracks/server";
import { HONOInstance } from "../lib/types";

const realtime = new Hono<HONOInstance>();

realtime.all("/partytracks/*", (c) =>
  routePartyTracksRequest({
    appId: process.env.CLOUDFLARE_SFU_ID,
    token: process.env.CLOUDFLARE_SFU_SECRET,
    turnServerAppId: process.env.CLOUDFLARE_TURN_ID,
    turnServerAppToken: process.env.CLOUDFLARE_TURN_SECRET,
    request: c.req.raw,
    prefix: "/room/partytracks",
  }),
);

export default realtime;
