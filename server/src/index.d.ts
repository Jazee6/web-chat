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
