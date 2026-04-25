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
import useAudioLevel from "@/hooks/use-audio-level.ts";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import { useRoomContext } from "@/lib/context.ts";
import { cn } from "@/lib/utils.ts";
import { AudioLines, Mic, MicOff, Plus } from "lucide-react";
import { useEffect, useMemo } from "react";

const RealtimeSidebar = () => {
  const { fetchMissingUsers } = useUserInfo();
  const { uid, roomRealtime, realtimeStatus, setRealtimeWindowOpen } =
    useRoomContext();

  const userIds = useMemo(
    () => roomRealtime?.userIds ?? [],
    [roomRealtime?.userIds],
  );

  useEffect(() => {
    fetchMissingUsers(userIds);
  }, [userIds, fetchMissingUsers]);

  const joined = roomRealtime?.userIds.includes(uid ?? "") ?? false;

  const sortedStatus = useMemo(() => {
    if (!realtimeStatus) return [];
    return [...realtimeStatus].sort((a, b) => {
      if (a.userId === uid) return -1;
      if (b.userId === uid) return 1;
      if (a.audio?.enabled && !b.audio?.enabled) return -1;
      if (!a.audio?.enabled && b.audio?.enabled) return 1;
      return 0;
    });
  }, [realtimeStatus, uid]);

  const displayUsers = joined
    ? sortedStatus.map((s) => ({ i: s.userId, audio: s.audio }))
    : (roomRealtime?.userIds ?? []).map((i) => ({ i, audio: undefined }));

  return (
    <>
      <Sidebar side="right" collapsible="icon">
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
              {displayUsers.map(({ i, audio }) => (
                <UserItem key={i} i={i} audio={audio} />
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
                    onClick={() => setRealtimeWindowOpen(true)}
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
    </>
  );
};

const UserItem = ({
  i,
  audio,
}: {
  i: string;
  audio?: { id?: string; enabled?: boolean };
}) => {
  const { users } = useUserInfo();
  const { uid, audioTrackMap, roomRealtime, realtimeSidebarOpen } =
    useRoomContext();
  const joined = roomRealtime?.userIds.includes(uid ?? "") ?? false;

  const track = audioTrackMap?.[i];
  const { isSpeaking } = useAudioLevel(track);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={users[i]?.name ? users[i].name : undefined}
        size="lg"
      >
        <div className="group-data-[collapsible=icon]:p-1">
          <Avatar
            size={realtimeSidebarOpen ? "default" : "sm"}
            className={cn(
              "ring-0 ring-green-500/80 transition-all",
              isSpeaking && "ring-2",
            )}
          >
            <AvatarImage src={users[i]?.image ?? undefined} />
            <AvatarFallback>
              {users[i]?.name.slice(0, 2).toUpperCase() ??
                i.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <span className="overflow-hidden">
          {users[i]?.name ?? <Skeleton className="w-full h-4" />}
        </span>

        {joined && (
          <div className="ml-auto">{audio?.enabled ? <Mic /> : <MicOff />}</div>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

export default RealtimeSidebar;
