import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "easy-auth",
          clientId: process.env.EASY_AUTH_CLIENT_ID,
          clientSecret: process.env.EASY_AUTH_CLIENT_SECRET,
          discoveryUrl:
            process.env.NODE_ENV === "production"
              ? `${new URL(process.env.SITE_URL).origin}/api/auth/.well-known/openid-configuration`
              : "http://localhost:3000/api/auth/.well-known/openid-configuration",
        },
      ],
    }),
  ],
  trustedOrigins: [process.env.SITE_URL],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60,
      strategy: "jwt",
      refreshCache: true,
    },
  },
  advanced: {
    cookiePrefix: "wc",
  },
});

export type User = typeof auth.$Infer.Session.user;
export type Session = typeof auth.$Infer.Session.session;
