import { useRealtimeContext } from "@/lib/context.ts";
import { createAudioSink } from "partytracks/client";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { of } from "rxjs";

interface TrackObject {
  sessionId: string;
  trackName: string;
}

interface AudioStreamProps {
  tracksToPull: TrackObject[];
}

export const AudioStream: FC<AudioStreamProps> = ({ tracksToPull }) => {
  const ref = useRef<HTMLAudioElement>(null);
  const [audioSink, setAudioSink] = useState<ReturnType<
    typeof createAudioSink
  > | null>(null);

  useEffect(() => {
    if (ref.current && !audioSink) {
      setAudioSink(createAudioSink({ audioElement: ref.current }));
    }
  }, [audioSink]);

  return (
    <>
      <audio ref={ref} autoPlay />

      {audioSink &&
        tracksToPull.map(({ sessionId, trackName }) => (
          <AudioTrack
            key={trackName}
            sessionId={sessionId}
            trackName={trackName}
            audioSink={audioSink}
          />
        ))}
    </>
  );
};

function AudioTrack({
  trackName,
  sessionId,
  audioSink,
}: {
  trackName: string;
  sessionId: string;
  audioSink: ReturnType<typeof createAudioSink>;
}) {
  const { partyTracks } = useRealtimeContext();

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

  useEffect(() => {
    const subscription = audioSink.attach(pulledTrack$);
    return () => subscription.unsubscribe();
  }, [audioSink, pulledTrack$]);

  return null;
}
