import { usePeerConnection } from "@/hooks/use-peer-connection.ts";
import useRealtimeStatus from "@/hooks/use-realtime-status.ts";
import useUserMedia from "@/hooks/use-user-media.ts";
import { RealtimeContext, type RealtimeContextType } from "@/lib/context.ts";
import { useObservableAsValue } from "partytracks/react";
import { type ReactNode, useMemo } from "react";

const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const { partyTracks, session, iceConnectionState } = usePeerConnection({
    prefix: `${import.meta.env.VITE_API_URL}/room/partytracks`,
  });
  const userMedia = useUserMedia();

  const pushedAudioTrack$ = useMemo(
    () => partyTracks.push(userMedia.publicAudioTrack$),
    [partyTracks, userMedia.publicAudioTrack$],
  );
  const pushedAudioTrack = useObservableAsValue(pushedAudioTrack$);

  useRealtimeStatus({
    sessionId: session?.sessionId,
    userMedia,
    audio: {
      id: pushedAudioTrack?.trackName,
    },
  });

  const value: RealtimeContextType = {
    partyTracks,
    session,
    iceConnectionState,
    userMedia,
  };

  return <RealtimeContext value={value}>{children}</RealtimeContext>;
};

export default RealtimeProvider;
