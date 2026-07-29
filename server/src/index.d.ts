declare global {
  namespace Cloudflare {
    interface Env {
      EXA_API_KEY?: string;
      AI_GATEWAY_ID?: string;
    }
  }

  namespace NodeJS {
    interface ProcessEnv {
      SITE_URL: string;
      BETTER_AUTH_URL: string;
      EASY_AUTH_CLIENT_ID: string;
      EASY_AUTH_CLIENT_SECRET: string;
      EXA_API_KEY?: string;
      AI_GATEWAY_ID?: string;
    }
  }
}
