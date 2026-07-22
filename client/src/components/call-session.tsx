import { AudioStream } from "@/components/audio-stream.tsx";
import RealtimeProvider from "@/components/context/realtime-context.tsx";
import RealtimeWindow from "@/components/realtime-window.tsx";
import { useKickedTabWatcher } from "@/hooks/use-kicked-tab-watcher.ts";

const CallWatcher = () => {
  useKickedTabWatcher();
  return null;
};

const CallSession = ({
  realtimeKey,
  tracksToPull,
  onOpenChange,
  onTrackAdded,
  onTrackRemoved,
}: {
  realtimeKey: number;
  tracksToPull: Array<{
    uid: string;
    sessionId: string;
    trackName: string;
  }>;
  onOpenChange: (open: boolean) => void;
  onTrackAdded: (uid: string, track: MediaStreamTrack) => void;
  onTrackRemoved: (uid: string) => void;
}) => (
  <RealtimeProvider key={realtimeKey}>
    <CallWatcher />
    <RealtimeWindow open onOpenChange={onOpenChange} />
    <AudioStream
      tracksToPull={tracksToPull}
      onTrackAdded={onTrackAdded}
      onTrackRemoved={onTrackRemoved}
    />
  </RealtimeProvider>
);

export default CallSession;
