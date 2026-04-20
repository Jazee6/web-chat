import { AppSidebar } from "@/components/app-sidebar";
import RealtimeSidebar from "@/components/realtime-sidebar.tsx";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserInfoProvider } from "@/components/user-info.tsx";
import { useSession } from "@/lib/auth-client.ts";
import { RealtimeSidebarContext } from "@/lib/context.ts";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import type { RoomRealtime, ServerRealtimeStatus } from "web-chat-share";

const Layout = () => {
  const { data, isPending } = useSession();
  const nav = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [roomRealtime, setRoomRealtime] = useState<RoomRealtime>();
  const [realtimeStatus, setRealtimeStatus] =
    useState<ServerRealtimeStatus[]>();

  useEffect(() => {
    if (isPending) return;

    if (!data?.user) {
      nav("/login?redirect=" + encodeURIComponent(location.href));
    }
  }, [data?.user, isPending, nav]);

  return (
    <RealtimeSidebarContext
      value={{
        isOpen,
        setIsOpen,
        roomRealtime,
        setRoomRealtime,
        realtimeStatus,
        setRealtimeStatus,
      }}
    >
      <UserInfoProvider>
        <SidebarProvider>
          <AppSidebar />

          <SidebarInset>
            <div className="h-16 flex items-center px-4 absolute">
              <SidebarTrigger className="-ml-1 z-20" />
            </div>

            <div className="h-full">
              <Outlet />
            </div>
          </SidebarInset>

          {roomRealtime && roomRealtime.total > 0 && (
            <SidebarProvider
              open={isOpen}
              onOpenChange={setIsOpen}
              className="w-auto"
            >
              <RealtimeSidebar uid={data?.user.id} />
            </SidebarProvider>
          )}
        </SidebarProvider>
      </UserInfoProvider>
    </RealtimeSidebarContext>
  );
};

export default Layout;
