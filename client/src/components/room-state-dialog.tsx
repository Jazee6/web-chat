import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import { Button } from "@/components/ui/button.tsx";
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
import type { User } from "@/lib/auth-client.ts";
import { api, cn } from "@/lib/utils.ts";
import { PhoneCall } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
  const [users, setUsers] = useState<{
    [userId: string]: User;
  }>({});

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
    if (!open) {
      return;
    }

    const ids = userIds.filter((id) => !users[id]);
    if (ids.length === 0) {
      return;
    }

    api
      .get<User[]>("room/user", {
        searchParams: new URLSearchParams({
          ids: ids.join(","),
        }),
      })
      .json()
      .then((i) => {
        const newUsers: { [userId: string]: User } = {};
        i.forEach((u) => {
          newUsers[u.id] = u;
        });
        setUsers((prev) => ({ ...prev, ...newUsers }));
      });
  }, [open, userIds, users]);

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
                    <Avatar className="relative">
                      <AvatarImage src={users[id]?.image ?? ""} />
                      <AvatarFallback>
                        {users[id]?.name?.slice(0, 2)}
                      </AvatarFallback>

                      <div
                        className={cn(
                          "bg-green-500 absolute bottom-0 right-0 size-2 rounded-full",
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
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      disabled
                    >
                      <PhoneCall />
                    </Button>
                  </ItemActions>
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
