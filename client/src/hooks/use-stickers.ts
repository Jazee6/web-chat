import { api } from "@/lib/utils.ts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Sticker } from "web-chat-share";

const STICKER_LIMIT = 25;

export const stickerListQueryKey = ["sticker"] as const;

export const stickerImageUrl = (key: string) =>
  `${import.meta.env.VITE_API_URL}/room/images/${key}`;

// The Sticker Library: a user's favorited images, paginated newest-first.
// Favoriting is idempotent (server no-ops on duplicate key), so mutations
// always invalidate the list. See CONTEXT.md "Stickers".
export function useStickers() {
  const queryClient = useQueryClient();

  const listQuery = useInfiniteQuery({
    queryKey: stickerListQueryKey,
    queryFn: ({ pageParam = 0 }) =>
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
  });

  const favoriteMutation = useMutation({
    mutationFn: (key: string) => api.post("sticker", { json: { key } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: stickerListQueryKey }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`sticker/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: stickerListQueryKey }),
  });

  return {
    listQuery,
    favoriteSticker: (key: string) => favoriteMutation.mutate(key),
    removeSticker: (id: string) => removeMutation.mutate(id),
  };
}

// Favorite-sticker mutation only, for sites (e.g. ChatList) that need to add a
// sticker without subscribing to the list query. Idempotent on the server.
export function useFavoriteSticker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.post("sticker", { json: { key } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: stickerListQueryKey }),
  });
}
