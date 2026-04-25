import { useRealtimeContext } from "@/lib/context.ts";
import { createAudioSink } from "partytracks/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { of } from "rxjs";

interface TrackObject {
  uid: string;
  sessionId: string;
  trackName: string;
}

export const AudioStream = ({
  tracksToPull,
  onTrackAdded,
  onTrackRemoved,
}: {
  tracksToPull: TrackObject[];
  onTrackAdded: (uid: string, track: MediaStreamTrack) => void;
  onTrackRemoved: (uid: string, track: MediaStreamTrack) => void;
}) => {
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
        tracksToPull.map((trackToPull) => (
          <AudioTrack
            key={`${trackToPull.sessionId}/${trackToPull.trackName}`}
            trackToPull={trackToPull}
            audioSink={audioSink}
            onTrackAdded={onTrackAdded}
            onTrackRemoved={onTrackRemoved}
          />
        ))}
    </>
  );
};

const AudioTrack = ({
  trackToPull,
  audioSink,
  onTrackAdded,
  onTrackRemoved,
}: {
  trackToPull: TrackObject;
  audioSink: ReturnType<typeof createAudioSink>;
  onTrackAdded: (uid: string, track: MediaStreamTrack) => void;
  onTrackRemoved: (uid: string, track: MediaStreamTrack) => void;
}) => {
  const { partyTracks } = useRealtimeContext();

  const { uid, sessionId, trackName } = trackToPull;

  const pulledTrack$ = useMemo(() => {
    return partyTracks.pull(
      of({ uid, sessionId, trackName, location: "remote" as const }),
    );
  }, [partyTracks, uid, sessionId, trackName]);

  useEffect(() => {
    const subscription = audioSink.attach(pulledTrack$);

    let currentTrack: MediaStreamTrack | null = null;

    const trackSub = pulledTrack$.subscribe((track) => {
      if (currentTrack) {
        onTrackRemoved(trackToPull.uid, currentTrack);
      }
      currentTrack = track;
      onTrackAdded(trackToPull.uid, track);
    });

    return () => {
      subscription.unsubscribe();
      trackSub.unsubscribe();
      if (currentTrack) {
        onTrackRemoved(trackToPull.uid, currentTrack);
      }
    };
  }, [audioSink, onTrackAdded, onTrackRemoved, pulledTrack$, trackToPull.uid]);

  return null;
};
