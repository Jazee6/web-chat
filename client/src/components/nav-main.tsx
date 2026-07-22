import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  const queryClient = useQueryClient();
  const nav = useNavigate();

  const updateVisibility = async (
    item: { id?: string; title: string },
    visibility: "public" | "unlisted",
  ) => {
    if (!item.id) return;
    await api.patch(`room/${item.id}/visibility`, {
      json: { type: visibility },
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room"] }),
      queryClient.invalidateQueries({ queryKey: ["publicRooms"] }),
      queryClient.invalidateQueries({ queryKey: ["roomInfo", item.id] }),
    ]);
    toast.success(
      visibility === "public" ? "Room is now public" : "Room is now unlisted",
    );
  };

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
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuGroup>
                    {item.visibility === "public" ? (
                      <DropdownMenuItem
                        onClick={() => {
                          void updateVisibility(item, "unlisted").catch(
                            () => undefined,
                          );
                        }}
                      >
                        Make unlisted
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => {
                          showAlertDialog({
                            title: "Make this room public?",
                            description:
                              "Anyone signed in will be able to find this room, enter it, and read its existing message history.",
                            confirmText: "Make public",
                            onConfirmAction: () =>
                              updateVisibility(item, "public"),
                          });
                        }}
                      >
                        Make public
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        showAlertDialog({
                          title: "Delete Room",
                          description:
                            "Are you sure you want to delete this room? This action cannot be undone.",
                          confirmText: "Delete",
                          onConfirmAction: async () => {
                            await api.delete(
                              "room/" + item.url.split("/").pop(),
                            );
                            toast.success("Room deleted successfully");
                            queryClient.refetchQueries({ queryKey: ["room"] });
                            queryClient.invalidateQueries({
                              queryKey: ["publicRooms"],
                            });
                            nav("/");
                          },
                        });
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
