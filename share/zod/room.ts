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

export const sessionIdSchema = z.object({
  sessionId: z.string().min(1),
});

export const tracksSchema = z.object({
  sessionDescription: z
    .object({
      sdp: z.string(),
      type: z.enum(["offer", "answer"]),
    })
    .optional(),
  tracks: z.array(
    z.object({
      location: z.enum(["local", "remote"]),
      mid: z.string(),
      trackName: z.string(),
    }),
  ),
});

export const renegotiateSchema = z.object({
  sessionDescription: z.object({
    sdp: z.string(),
  }),
});

export const closeTracksSchema = z.object({
  tracks: z.array(
    z.object({
      mid: z.string(),
    }),
  ),
  sessionDescription: z.object({
    sdp: z.string(),
  }),
  force: z.boolean(),
});
