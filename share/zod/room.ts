import { z } from "zod";

export const basePaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100),
  offset: z.coerce.number().min(0),
});

export const createRoomSchema = z.object({
  name: z.string().min(1),
});

export const roomIdSchema = z.object({
  id: z.string().min(1),
});
