import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import { useRealtimeSidebar } from "@/lib/context.ts";
import { AudioLines, Mic, MicOff, Plus } from "lucide-react";
import { useEffect, useMemo } from "react";

const RealtimeSidebar = ({
  className,
  uid,
}: {
  className?: string;
  uid?: string;
}) => {
  const { roomRealtime, realtimeStatus } = useRealtimeSidebar();

  const { users, fetchMissingUsers } = useUserInfo();
  const userIds = useMemo(
    () => roomRealtime?.userIds ?? [],
    [roomRealtime?.userIds],
  );

  useEffect(() => {
    if (userIds.length === 0) return;

    fetchMissingUsers(userIds);
  }, [userIds, fetchMissingUsers]);

  const joined = roomRealtime?.userIds.includes(uid ?? "") ?? false;

  return (
    <Sidebar side="right" collapsible="icon" className={className}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton>
              <AudioLines />
              <div className="font-mono">Call</div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {joined
              ? realtimeStatus?.map(({ userId: i, audio }) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuButton
                      tooltip={users[i]?.name ? users[i].name : undefined}
                      size="lg"
                    >
                      <Avatar>
                        <AvatarImage src={users[i]?.image ?? undefined} />
                        <AvatarFallback>
                          {users[i]?.name.slice(0, 2).toUpperCase() ??
                            i.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <span className="overflow-hidden">
                        {users[i]?.name ?? <Skeleton className="w-full h-4" />}
                      </span>

                      <div className="ml-auto">
                        {audio?.enabled ? <Mic /> : <MicOff />}
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              : roomRealtime?.userIds.map((i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuButton
                      tooltip={users[i]?.name ? users[i].name : undefined}
                      size="lg"
                    >
                      <Avatar>
                        <AvatarImage src={users[i]?.image ?? undefined} />
                        <AvatarFallback>
                          {users[i]?.name.slice(0, 2).toUpperCase() ??
                            i.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <span className="overflow-hidden">
                        {users[i]?.name ?? <Skeleton className="w-full h-4" />}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {!joined && (
        <SidebarFooter>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="group-data-[collapsible=icon]:hidden"
                  disabled
                >
                  <Plus />
                  Join
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  );
};

export default RealtimeSidebar;
