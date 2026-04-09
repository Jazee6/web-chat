import {
  PartyTracks,
  setLogLevel,
  type PartyTracksConfig,
} from "partytracks/client";
import { useObservableAsValue } from "partytracks/react";
import { useMemo } from "react";
import { useStablePojo } from "./use-stable-pojo.ts";

// TODO: env
setLogLevel("debug");

export const usePeerConnection = (config: PartyTracksConfig) => {
  const stableConfig = useStablePojo(config);
  const partyTracks = useMemo(
    () => new PartyTracks(stableConfig),
    [stableConfig],
  );
  const session = useObservableAsValue(partyTracks.session$);
  const iceConnectionState = useObservableAsValue(
    partyTracks.peerConnectionState$,
    "new",
  );

  return {
    partyTracks,
    session,
    iceConnectionState,
  };
};
