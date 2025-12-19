import {betterAuth} from "better-auth/minimal";
import {genericOAuth} from "better-auth/plugins";

export const auth = betterAuth({
    plugins: [
        genericOAuth({
            config: [
                {
                    providerId: "easy-auth",
                    clientId: process.env.EASY_AUTH_CLIENT_ID,
                    clientSecret: process.env.EASY_AUTH_CLIENT_SECRET,
                    discoveryUrl:
                        "http://localhost:3000/api/auth/.well-known/openid-configuration",
                },
            ],
        }),
    ],
    trustedOrigins: [process.env.SITE_URL],
});
