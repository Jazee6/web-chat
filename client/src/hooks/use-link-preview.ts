import { api } from "@/lib/utils.ts";
import { useQuery } from "@tanstack/react-query";
import type { LinkPreview } from "web-chat-share";

export function useLinkPreview(url: string | null) {
  return useQuery<LinkPreview>({
    queryKey: ["linkPreview", url],
    queryFn: () =>
      api
        .get("room/preview", { searchParams: { url: url! } })
        .json<LinkPreview>(),
    enabled: !!url,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 2,
  });
}
