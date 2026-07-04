import { z } from "zod";

export const basePaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100),
  offset: z.coerce.number().min(0),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(16),
  type: z.enum(["private", "public"]),
});

export const roomIdSchema = z.object({
  id: z.string().min(1),
});

export const getUserInfoSchema = z.object({
  ids: z.preprocess(
    (v: string) => v.split(","),
    z.array(z.string().min(1)).min(1).max(25),
  ),
});

export const sendMessageSchema = z.object({
  message: z.string().trim().max(2048),
});

// Mirrors ReplyRef in share/lib/index.ts. Stored as an opaque JSON blob on the
// message row; the server never reads into it. See ADR 0003.
export const replyRefSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(["text", "image"]),
  snippet: z.string().max(100),
});

export const getRoomInfoSchema = z.object({
  id: z.string().min(1),
});

export const getPresignedUrlSchema = z.object({
  sha256List: z
    .array(z.hash("sha256", { enc: "base64url" }))
    .min(1)
    .max(5),
});

export const getImageSchema = z.object({
  key: z.hash("sha256", { enc: "base64url" }),
});

// A sticker references an image already in storage by its sha256 key. See
// CONTEXT.md "Stickers" and ADR 0004.
export const favoriteStickerSchema = z.object({
  key: z.hash("sha256", { enc: "base64url" }),
});

export const stickerIdSchema = z.object({
  id: z.string().min(1),
});

export const linkPreviewQuerySchema = z.object({
  url: z
    .url()
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "Only http/https URLs are allowed",
    }),
});

export const userStatusSchema = z.object({
  user: z.enum(["active", "idle"]).optional(),
  screen: z.enum(["locked", "unlocked"]).optional(),
  typing: z.boolean().optional(),
});

export const realtimeStatusSchema = z.object({
  sessionId: z.string().optional(),
  audio: z
    .object({
      id: z.string(),
      enabled: z.boolean().optional(),
    })
    .optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("join") }),
  z.object({
    type: z.literal("send"),
    data: z.object({
      type: z.enum(["text", "image"]),
      content: z.string(),
      replyTo: replyRefSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("loadHistory"),
    data: z.object({
      before: z.string(),
    }),
  }),
  z.object({
    type: z.literal("userStatus"),
    data: userStatusSchema,
  }),
  z.object({ type: z.literal("realtimeJoin") }),
  z.object({
    type: z.literal("realtimeUpdate"),
    data: realtimeStatusSchema,
  }),
  z.object({ type: z.literal("realtimeLeave") }),
]);
