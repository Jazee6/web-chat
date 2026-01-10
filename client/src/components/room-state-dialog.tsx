import { Badge } from "@/components/ui/badge.tsx";
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
import { PhoneCall } from "lucide-react";
import { Fragment } from "react";
import type { RoomStats } from "web-chat-share";

const RoomStateDialog = ({ roomStats }: { roomStats: RoomStats }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Badge className="ml-auto">{roomStats?.users.length}</Badge>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Users in Room</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>

        <ItemGroup>
          {roomStats.users.map((u, index) => (
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
              {index !== roomStats.users.length - 1 && <ItemSeparator />}
            </Fragment>
          ))}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  );
};

export default RoomStateDialog;
