import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { openRoomSettings } from "@/lib/room-settings.ts";
import { MoreHorizontal, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router";

export function NavMain({
  label,
  items,
  type,
}: {
  label?: string;
  items: {
    id?: string;
    title: string;
    url: string;
    visibility?: "public" | "unlisted";
  }[];
  type?: "favorite";
}) {
  const location = useLocation();

  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.url}>
            <NavLink to={item.url}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={location.pathname === item.url}
              >
                {item.title}
              </SidebarMenuButton>
            </NavLink>
            {location.pathname === item.url && type !== "favorite" && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuAction>
                      <MoreHorizontal />
                    </SidebarMenuAction>
                  }
                />
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="w-fit"
                >
                  <DropdownMenuItem
                    onClick={() => item.id && openRoomSettings(item.id)}
                  >
                    <Settings />
                    Room settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
