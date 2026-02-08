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
import { api } from "@/lib/utils.ts";
import { PhoneCall } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import type { RoomStats } from "web-chat-share";

export interface RoomInfo {
  name: string;
  isFavorite: number;
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

  const states = {
    ...roomStats,
    users: roomStats.users.filter(
      (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
    ),
  };
  const userIds = states.users.map((u) => u.id);

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
          <DialogDescription></DialogDescription>
        </DialogHeader>

        {Object.getOwnPropertyNames(users).length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <ItemGroup className="-mt-2">
            {states.users.map(({ id }, index) => (
              <Fragment key={id}>
                <Item className="px-0 py-2">
                  <ItemMedia>
                    <Avatar>
                      <AvatarImage src={users[id]?.image ?? ""} />
                      <AvatarFallback>
                        {users[id]?.name?.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{users[id]?.name}</ItemTitle>
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
                {index !== states.users.length - 1 && <ItemSeparator />}
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RoomStateDialog;
