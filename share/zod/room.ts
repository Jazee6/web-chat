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
  message: z.string().trim().min(1).max(2048),
});

export const getRoomInfoSchema = z.object({
  id: z.string().min(1),
});
