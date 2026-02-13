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

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const { data, isPending } = useSession();

  const { data: rooms, isFetching } = useInfiniteQuery({
    queryKey: ["room"],
    queryFn: async ({ pageParam }) => {
      return await api
        .get<Room[]>("room", {
          searchParams: {
            limit: 20,
            offset: pageParam,
          },
        })
        .json();
    },
    initialPageParam: 0,
    getNextPageParam: (_, __, lastPageParam) => lastPageParam + 20,
    enabled: !!data,
  });

  const { data: favoriteRooms, isFetching: isFavoriteRoomsFetching } =
    useInfiniteQuery({
      queryKey: ["favoriteRoom"],
      queryFn: async ({ pageParam }) => {
        return await api
          .get<FavoriteRoom[]>("room/favorite", {
            searchParams: {
              limit: 20,
              offset: pageParam,
            },
          })
          .json();
      },
      initialPageParam: 0,
      getNextPageParam: (_, __, lastPageParam) => lastPageParam + 20,
      enabled: !!data,
    });

  const roomsData = rooms?.pages.flat() ?? [];
  const favoriteRoomsData = favoriteRooms?.pages.flat() ?? [];

  return (
    <Sidebar variant="inset" {...props}>
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
          <>
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
          </>
        ) : (
          favoriteRoomsData.length > 0 && (
            <NavMain
              label="Favorite Rooms"
              items={favoriteRoomsData.map((i) => ({
                title: i.name,
                url: `/room/${i.roomId}`,
              }))}
            />
          )
        )}

        {isFetching ? (
          <>
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
          </>
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
