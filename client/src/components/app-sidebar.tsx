import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useSession } from "@/lib/auth-client.ts";
import { api } from "@/lib/utils.ts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { type ComponentProps } from "react";
import { Link } from "react-router";

interface Room {
  id: string;
  name: string;
  createdAt: string;
}

interface FavoriteRoom {
  id: string;
  name: string;
  roomId: string;
  createdAt: string;
}

function useRoomPages<T>(queryKey: string, url: string, enabled: boolean) {
  const { data, isFetching } = useInfiniteQuery({
    queryKey: [queryKey],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      return await api
        .get<T[]>(url, {
          searchParams: { limit: 20, offset: pageParam },
        })
        .json();
    },
    initialPageParam: 0,
    getNextPageParam: (_, __, lastPageParam: number) => lastPageParam + 20,
    enabled,
  });
  return { data: data?.pages.flat() ?? [], isFetching };
}

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const { data, isPending } = useSession();

  const { data: roomsData, isFetching } = useRoomPages<Room>(
    "room",
    "room",
    !!data,
  );

  const { data: favoriteRoomsData, isFetching: isFavoriteRoomsFetching } =
    useRoomPages<FavoriteRoom>("favoriteRoom", "room/favorite", !!data);

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={
                <Link to="/">
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <MessageCircle className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Web Chat</span>
                  </div>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {isFavoriteRoomsFetching ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          favoriteRoomsData.length > 0 && (
            <NavMain
              label="Favorite Rooms"
              items={favoriteRoomsData.map((i) => ({
                title: i.name,
                url: `/room/${i.roomId}`,
              }))}
              type="favorite"
            />
          )
        )}

        {isFetching ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          roomsData.length > 0 && (
            <NavMain
              label="Your Rooms"
              items={roomsData.map((i) => ({
                title: i.name,
                url: `/room/${i.id}`,
              }))}
            />
          )
        )}
      </SidebarContent>
      <SidebarFooter>
        {isPending ? (
          <Skeleton className="h-12 p-2" />
        ) : (
          <NavUser
            user={{
              name: data?.user.name ?? "",
              email: data?.user.email ?? "",
              avatar: data?.user.image ?? "",
            }}
          />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
