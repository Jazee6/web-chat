import type { UserMedia } from "@/hooks/use-user-media.ts";
import { useRoomContext } from "@/lib/context.ts";
import { useEffect } from "react";
import { gm } from "web-chat-share";

const useRealtimeStatus = ({
  sessionId,
  userMedia,
  audio,
}: {
  sessionId?: string;
  userMedia: UserMedia;
  audio: {
    id?: string;
  };
}) => {
  const { ws } = useRoomContext();

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      gm({
        type: "realtimeJoin",
      }),
    );

    return () => {
      ws.send(
        gm({
          type: "realtimeLeave",
        }),
      );
    };
  }, [ws]);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId || !audio.id) {
      return;
    }

    ws.send(
      gm({
        type: "realtimeUpdate",
        data: {
          sessionId,
          audio: {
            id: audio.id,
            enabled: userMedia.audioEnabled,
          },
        },
      }),
    );
  }, [audio.id, sessionId, userMedia.audioEnabled, ws]);
};

export default useRealtimeStatus;
