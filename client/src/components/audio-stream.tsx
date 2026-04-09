import { useRealtime } from "@/lib/context.ts";
import { useObservableAsValue } from "partytracks/react";
import {
  type FC,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { of } from "rxjs";

interface TrackObject {
  sessionId: string;
  trackName: string;
}

interface AudioStreamProps {
  tracksToPull: TrackObject[];
}

export const AudioStream: FC<AudioStreamProps> = ({ tracksToPull }) => {
  const [mediaStream] = useState(() => new MediaStream());
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = mediaStream;
  }, [mediaStream]);

  const resetSrcObject = () => {
    const audio = ref.current;
    if (!audio || !mediaStream) return;
    audio.addEventListener("canplay", () => audio.play(), { once: true });
    audio.srcObject = mediaStream;
  };

  return (
    <>
      <audio ref={ref} autoPlay />

      {tracksToPull.map(({ sessionId, trackName }) => (
        <AudioTrack
          key={trackName}
          sessionId={sessionId}
          trackName={trackName}
          mediaStream={mediaStream}
          onTrackAdded={() => {
            resetSrcObject();
          }}
          onTrackRemoved={() => {
            resetSrcObject();
          }}
        />
      ))}
    </>
  );
};

function AudioTrack({
  mediaStream,
  trackName,
  sessionId,
  onTrackAdded,
  onTrackRemoved,
}: {
  mediaStream: MediaStream;
  trackName: string;
  sessionId: string;
  onTrackAdded: (trackObject: TrackObject, track: MediaStreamTrack) => void;
  onTrackRemoved: (trackObject: TrackObject, track: MediaStreamTrack) => void;
}) {
  const onTrackAddedEvent = useEffectEvent(onTrackAdded);
  const onTrackRemovedEvent = useEffectEvent(onTrackRemoved);

  const { partyTracks } = useRealtime();
  const trackObject = useMemo(() => {
    return {
      sessionId,
      trackName,
      location: "remote",
    } as const;
  }, [sessionId, trackName]);

  const pulledTrack$ = useMemo(() => {
    return partyTracks.pull(of(trackObject));
  }, [partyTracks, trackObject]);

  const audioTrack = useObservableAsValue(pulledTrack$);

  useEffect(() => {
    if (!audioTrack) return;
    mediaStream.addTrack(audioTrack);
    onTrackAddedEvent(trackObject, audioTrack);
    return () => {
      mediaStream.removeTrack(audioTrack);
      onTrackRemovedEvent(trackObject, audioTrack);
    };
  }, [audioTrack, mediaStream, trackObject]);

  return null;
}
