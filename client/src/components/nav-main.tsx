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
import { api, showAlertDialog } from "@/lib/utils.ts";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

export function NavMain({
  label,
  items,
}: {
  label?: string;
  items: {
    title: string;
    url: string;
  }[];
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const nav = useNavigate();

  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.url}>
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
                        onConfirmAction: async () => {
                          await api.delete("room/" + item.url.split("/").pop());
                          toast.success("Room deleted successfully");
                          queryClient.refetchQueries({ queryKey: ["room"] });
                          nav("/");
                        },
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
