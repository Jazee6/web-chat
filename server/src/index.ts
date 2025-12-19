import {Hono} from "hono";
import {cors} from "hono/cors";
import {HTTPException} from "hono/http-exception";
import {auth} from "../lib/auth";

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            SITE_URL: string;
            BETTER_AUTH_URL: string;
            EASY_AUTH_CLIENT_ID: string;
            EASY_AUTH_CLIENT_SECRET: string;
        }
    }
}

const app = new Hono<{
    Variables: {
        user: typeof auth.$Infer.Session.user;
        session: typeof auth.$Infer.Session.session;
    };
}>();

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

// app.use("/room/*", async (c, next) => {
//     const session = await auth.api.getSession({headers: c.req.raw.headers});
//     if (!session) {
//         throw new HTTPException(401, {message: 'Unauthorized'});
//     }
//     c.set("user", session.user);
//     c.set("session", session.session);
//     await next();
// });

app.onError((err) => {
    if (err instanceof HTTPException) {
        return err.getResponse();
    }

    return new Response("Internal Server Error", {status: 500});
});

app.on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
});

export default app;
