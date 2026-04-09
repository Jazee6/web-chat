import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useUserInfo } from "@/hooks/use-user-info.ts";
import { cn } from "@/lib/utils.ts";
import { Fragment, useEffect, useMemo } from "react";
import type { RoomStats } from "web-chat-share";

export interface RoomInfo {
  name: string;
  isFavorite: number;
  userId: string;
}

const RoomStateDialog = ({
  roomStats,
  roomInfo,
  open,
  onOpenChange,
}: {
  roomStats: RoomStats;
  roomInfo?: RoomInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { users, fetchMissingUsers } = useUserInfo();

  const uniqueUsers = useMemo(() => {
    const seen = new Set();
    return roomStats.users.filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
  }, [roomStats.users]);

  const userIds = useMemo(() => uniqueUsers.map((u) => u.id), [uniqueUsers]);

  useEffect(() => {
    if (!open) return;

    fetchMissingUsers(userIds);
  }, [open, userIds, fetchMissingUsers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room {roomInfo?.name}</DialogTitle>
          <DialogDescription className="hidden" />
        </DialogHeader>

        {uniqueUsers.length > 0 && Object.keys(users).length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <ItemGroup className="gap-0 -mt-2">
            {uniqueUsers.map(({ id, status }, index) => (
              <Fragment key={id}>
                <Item className="p-0">
                  <ItemMedia>
                    <Avatar>
                      <AvatarImage src={users[id]?.image ?? ""} />
                      <AvatarFallback>
                        {users[id]?.name?.slice(0, 2)}
                      </AvatarFallback>

                      <AvatarBadge
                        className={cn(
                          "size-1.5! bg-green-500",
                          status?.user === "idle" ? "bg-yellow-500" : "",
                          status?.screen === "locked" ? "bg-neutral-500" : "",
                        )}
                      />
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {users[id]?.name ?? <Skeleton className="h-4 w-24" />}
                    </ItemTitle>
                    {/*<ItemDescription></ItemDescription>*/}
                  </ItemContent>
                  <ItemActions></ItemActions>
                </Item>
                {index !== uniqueUsers.length - 1 && (
                  <ItemSeparator className="h-px" />
                )}
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RoomStateDialog;
