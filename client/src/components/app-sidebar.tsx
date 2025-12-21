"use client";

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
import { type ComponentProps, Fragment } from "react";
import { Link } from "react-router";

interface Room {
  id: string;
  name: string;
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
  });

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <MessageCircle className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Web Chat</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {isFetching ? (
          <>
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
            <Skeleton className="h-8 px-2" />
          </>
        ) : (
          rooms?.pages.map((group, index) => (
            <Fragment key={index}>
              <NavMain
                items={group.map((i) => ({
                  title: i.name,
                  url: `/room/${i.id}`,
                }))}
              />
            </Fragment>
          ))
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
