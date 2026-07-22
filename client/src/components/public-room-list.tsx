import { Button } from "@/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { api } from "@/lib/utils.ts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { Globe2, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

interface PublicRoom {
  id: string;
  name: string;
  lastActiveAt: string;
}

interface PublicRoomPage {
  rooms: PublicRoom[];
  nextCursor: string | null;
}

class RegionRestrictedError extends Error {}

export function PublicRoomListSkeleton() {
  return (
    <ItemGroup>
      {Array.from({ length: 5 }, (_, index) => (
        <Item variant="outline" key={index}>
          <ItemMedia variant="icon">
            <Skeleton className="size-8 rounded-full" />
          </ItemMedia>
          <ItemContent>
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

const relativeTime = (value: string, now: number) => {
  const seconds = (new Date(value).getTime() - now) / 1000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let duration = seconds;
  for (const [range, unit] of ranges) {
    if (Math.abs(duration) < range) {
      return formatter.format(Math.round(duration), unit);
    }
    duration /= range;
  }
  return formatter.format(0, "second");
};

export function PublicRoomList({
  onCreateRoom,
  onCreatePublicRoom,
  enabled = true,
}: {
  onCreateRoom: () => void;
  onCreatePublicRoom: () => void;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState<number>();
  const query = useInfiniteQuery({
    queryKey: ["publicRooms"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      try {
        return await api
          .get<PublicRoomPage>("room/public", {
            searchParams: pageParam ? { cursor: pageParam } : undefined,
          })
          .json();
      } catch (error) {
        if (error instanceof HTTPError && error.response.status === 403) {
          const body = (await error.response
            .clone()
            .json()
            .catch(() => null)) as { code?: string } | null;
          if (body?.code === "PUBLIC_ROOM_DISCOVERY_REGION_RESTRICTED") {
            throw new RegionRestrictedError();
          }
        }
        throw error;
      }
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: (failureCount, error) =>
      !(error instanceof RegionRestrictedError) && failureCount < 2,
    enabled,
  });

  useEffect(() => {
    const timeout = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  if (query.error instanceof RegionRestrictedError) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Button onClick={onCreateRoom}>
          <Plus data-icon="inline-start" />
          Create room
        </Button>
      </div>
    );
  }

  const rooms = query.data?.pages.flatMap((page) => page.rooms) ?? [];
  const refresh = () =>
    queryClient.resetQueries({ queryKey: ["publicRooms"], exact: true });

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 md:px-8 md:py-16">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">Public rooms</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Find a conversation
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh public rooms"
            disabled={query.isFetching}
            onClick={() => void refresh()}
          >
            <RefreshCw />
          </Button>
          <Button onClick={onCreateRoom}>
            <Plus data-icon="inline-start" />
            Create room
          </Button>
        </div>
      </header>

      {query.isPending ? (
        <PublicRoomListSkeleton />
      ) : query.isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCw />
            </EmptyMedia>
            <EmptyTitle>Could not load public rooms</EmptyTitle>
            <EmptyDescription>
              Check your connection and try again.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void refresh()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : rooms.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe2 />
            </EmptyMedia>
            <EmptyTitle>No public rooms yet</EmptyTitle>
            <EmptyDescription>
              Start the first conversation that anyone signed in can discover.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={onCreatePublicRoom}>
              <Plus data-icon="inline-start" />
              Create a public room
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ItemGroup>
            {rooms.map((room) => {
              const activeAt = new Date(room.lastActiveAt);
              return (
                <Item
                  key={room.id}
                  variant="outline"
                  render={<Link to={`/room/${room.id}`} />}
                >
                  <ItemMedia variant="icon">
                    <MessageCircle />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{room.name}</ItemTitle>
                    <ItemDescription>
                      Active{" "}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <time dateTime={room.lastActiveAt} tabIndex={0}>
                                {relativeTime(
                                  room.lastActiveAt,
                                  now ?? activeAt.getTime(),
                                )}
                              </time>
                            }
                          />
                          <TooltipContent>
                            {activeAt.toLocaleString()}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>

          {query.hasNextPage && (
            <Button
              className="self-center"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage && <Spinner data-icon="inline-start" />}
              Load more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
