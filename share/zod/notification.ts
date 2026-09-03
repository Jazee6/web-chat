import { z } from "zod";

const roomId = z.string().min(1).max(128);

export const unsubscribeRoomSchema = z.object({
  roomId,
});

const pushEndpoint = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Push endpoint must use HTTPS",
  });

export const registerPushDestinationSchema = z.object({
  endpoint: pushEndpoint,
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
});

export const unregisterPushDestinationSchema = z.object({
  endpoint: pushEndpoint,
});

export const currentPushDestinationSchema = unregisterPushDestinationSchema;

export const pushDestinationIdSchema = z.object({
  id: z.string().uuid(),
});
