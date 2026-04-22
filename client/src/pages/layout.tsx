import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client.ts";
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";

const Layout = () => {
  const { data, isPending } = useSession();
  const nav = useNavigate();

  useEffect(() => {
    if (isPending) return;

    if (!data?.user) {
      nav("/login?redirect=" + encodeURIComponent(location.href));
    }
  }, [data?.user, isPending, nav]);

  return (
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
    </SidebarProvider>
  );
};

export default Layout;
