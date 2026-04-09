import { Button } from "@/components/ui/button.tsx";
import { AudioLines } from "lucide-react";
import type { RoomRealtime } from "web-chat-share";

const RealtimeLand = ({
  data,
  onClick,
}: {
  data?: RoomRealtime;
  onClick: () => void;
}) => {
  if (data?.total) {
    return (
      <Button variant="ghost" onClick={onClick}>
        <AudioLines />
        {data.total}
      </Button>
    );
  }
};

export default RealtimeLand;
