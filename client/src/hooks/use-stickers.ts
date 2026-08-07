import { api } from "@/lib/utils.ts";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  usePrefetchInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Sticker } from "web-chat-share";

const STICKER_LIMIT = 25;
const STICKER_STALE_TIME = 1000 * 60 * 60 * 24;

export const stickerListQueryKey = (userId: string) =>
  ["sticker", userId] as const;

export const stickerImageUrl = (key: string) =>
  `${import.meta.env.VITE_API_URL}/room/images/${key}`;

const stickerListQueryOptions = (userId: string) =>
  infiniteQueryOptions({
    queryKey: stickerListQueryKey(userId),
    queryFn: ({ pageParam }) =>
      api
        .get<Sticker[]>("sticker", {
          searchParams: { limit: STICKER_LIMIT, offset: pageParam },
        })
        .json(),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length < STICKER_LIMIT
        ? undefined
        : lastPageParam + STICKER_LIMIT,
    staleTime: STICKER_STALE_TIME,
    gcTime: Infinity,
  });

export function usePrefetchStickers(userId: string) {
  usePrefetchInfiniteQuery(stickerListQueryOptions(userId));
}

// The Sticker Library: a user's favorited images, paginated newest-first.
// Favoriting is idempotent (server no-ops on duplicate key), so mutations
// always invalidate the user's list. See CONTEXT.md "Stickers".
export function useStickers(userId: string) {
  const queryClient = useQueryClient();
  const listQuery = useInfiniteQuery(stickerListQueryOptions(userId));

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`sticker/${id}`),
    onSuccess: () => {
      toast.success("Removed from stickers");
      return queryClient.invalidateQueries({
        queryKey: stickerListQueryKey(userId),
      });
    },
    onError: () => toast.error("Failed to remove sticker"),
  });

  return {
    listQuery,
    removeSticker: (id: string) => removeMutation.mutate(id),
  };
}

// Favorite-sticker mutation only, for sites (e.g. ChatList) that need to add a
// sticker without subscribing to the list query. Idempotent on the server.
export function useFavoriteSticker(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.post("sticker", { json: { key } }),
    onSuccess: () => {
      toast.success("Saved to stickers");
      return queryClient.invalidateQueries({
        queryKey: stickerListQueryKey(userId),
      });
    },
    onError: () => toast.error("Failed to save sticker"),
  });
}
