import { Hono } from "hono";
import { routePartyTracksRequest } from "partytracks/server";
import { HONOInstance } from "../lib/types";

const realtime = new Hono<HONOInstance>();

realtime.all("/partytracks/*", (c) =>
  routePartyTracksRequest({
    appId: c.env.CLOUDFLARE_SFU_ID,
    token: c.env.CLOUDFLARE_SFU_SECRET,
    turnServerAppId: c.env.CLOUDFLARE_TURN_ID,
    turnServerAppToken: c.env.CLOUDFLARE_TURN_SECRET,
    request: c.req.raw,
    prefix: "/room/partytracks",
  }),
);

export default realtime;
