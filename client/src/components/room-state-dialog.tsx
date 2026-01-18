import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item.tsx";
import { cn } from "@/lib/utils.ts";
import { PhoneCall } from "lucide-react";
import { Fragment } from "react";
import type { RoomStats } from "web-chat-share";

const RoomStateDialog = ({
  roomStats,
  className,
  disabled,
}: {
  roomStats: RoomStats;
  className?: string;
  disabled?: boolean;
}) => {
  const states = {
    ...roomStats,
    users: roomStats.users.filter(
      (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
    ),
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/*<Badge className={className}>{states?.users.length}</Badge>*/}
        <Button
          className={cn(className, "rounded-full size-6")}
          disabled={disabled}
        >
          {states.users.length}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Users in Room</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>

        <ItemGroup>
          {states.users.map((u, index) => (
            <Fragment key={u.id}>
              <Item className="p-0">
                {/*<ItemMedia>*/}
                {/*  <Avatar>*/}
                {/*    <AvatarImage*/}
                {/*      src={person.avatar}*/}
                {/*      className="grayscale"*/}
                {/*    />*/}
                {/*    <AvatarFallback>*/}
                {/*      {person.username.charAt(0)}*/}
                {/*    </AvatarFallback>*/}
                {/*  </Avatar>*/}
                {/*</ItemMedia>*/}
                <ItemContent className="gap-1">
                  <ItemTitle>{u.id}</ItemTitle>
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
      </DialogContent>
    </Dialog>
  );
};

export default RoomStateDialog;
