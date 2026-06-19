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
  const { ws, wsReadyState: readyState } = useRoomContext();

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
      // Only signal an explicit leave when the socket is still open. If the
      // socket dropped (the user is hanging up at the same moment as a
      // network blip, or the tab is closing), the server's grace window
      // handles eviction — sending on a closed socket would throw.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          gm({
            type: "realtimeLeave",
          }),
        );
      }
    };
  }, [ws, readyState]);

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
  }, [audio.id, sessionId, userMedia.audioEnabled, ws, readyState]);
};

export default useRealtimeStatus;
