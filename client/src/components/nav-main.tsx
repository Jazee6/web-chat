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
import { showAlertDialog } from "@/lib/utils.ts";
import { MoreHorizontal } from "lucide-react";
import { NavLink, useLocation } from "react-router";

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    isActive?: boolean;
  }[];
}) {
  const location = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        {items.length === 0 ? "No Rooms" : "Your Rooms"}
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              asChild
              tooltip={item.title}
              isActive={location.pathname === item.url}
            >
              <NavLink to={item.url}>
                <span>{item.title}</span>
              </NavLink>
            </SidebarMenuButton>

            {location.pathname === item.url && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction>
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      showAlertDialog({
                        title: "Delete Room",
                        description:
                          "Are you sure you want to delete this room? This action cannot be undone.",
                        confirmText: "Delete",
                      });
                    }}
                  >
                    <span className="text-destructive">Delete</span>
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
