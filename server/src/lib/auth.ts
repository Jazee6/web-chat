import { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins";
import { env } from "cloudflare:workers";

export const authConfig: BetterAuthOptions = {
  database: drizzleAdapter(env.web_chat, {
    provider: "sqlite",
  }),
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "easy-auth",
          clientId: process.env.EASY_AUTH_CLIENT_ID,
          clientSecret: process.env.EASY_AUTH_CLIENT_SECRET,
          discoveryUrl:
            process.env.NODE_ENV === "production"
              ? "https://account.jaze.top/api/auth/.well-known/openid-configuration"
              : "http://localhost:3000/api/auth/.well-known/openid-configuration",
          pkce: true,
          scopes: ["openid", "profile", "email", "offline_access"],
          overrideUserInfo: true,
        },
      ],
    }),
  ],
  // databaseHooks: {
  //   user: {
  //     create: {
  //       // @ts-ignore
  //       before: (user) => {
  //         return {
  //           data: {
  //             ...user,
  //             id: user.sub,
  //           },
  //         };
  //       },
  //     },
  //   },
  // },
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

export const auth = betterAuth(authConfig);

export type User = typeof auth.$Infer.Session.user;
export type Session = typeof auth.$Infer.Session.session;
