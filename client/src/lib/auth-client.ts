import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "sonner";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  fetchOptions: {
    onError: (ctx) => {
      toast.error(ctx.error.message);
    },
  },
  plugins: [genericOAuthClient()],
});

export type User = typeof authClient.$Infer.Session.user;

export const { useSession } = authClient;
