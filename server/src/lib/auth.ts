import { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "./schema/auth";

export const authConfig: BetterAuthOptions = {
  database: drizzleAdapter(env.web_chat, {
    provider: "sqlite",
  }),
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "easy-auth",
          discoveryUrl: `${process.env.EASY_AUTH_URL}/api/auth/.well-known/openid-configuration`,
          clientId: process.env.EASY_AUTH_CLIENT_ID,
          clientSecret: process.env.EASY_AUTH_CLIENT_SECRET,
          pkce: true,
          scopes: ["openid", "profile", "email"],
          overrideUserInfo: true,
        },
      ],
    }),
  ],
  trustedOrigins: [process.env.SITE_URL],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  advanced: {
    cookiePrefix: "wc",
  },
};

let cachedAuth: typeof auth | null = null;

export const getAuth = (db: D1Database): typeof auth => {
  if (!cachedAuth) {
    cachedAuth = betterAuth({
      ...authConfig,
      database: drizzleAdapter(drizzle(db), {
        provider: "sqlite",
        schema: authSchema,
      }),
    }) as typeof auth;
  }
  return cachedAuth;
};

export const auth = betterAuth(authConfig);

export type User = typeof auth.$Infer.Session.user;
export type Session = typeof auth.$Infer.Session.session;
