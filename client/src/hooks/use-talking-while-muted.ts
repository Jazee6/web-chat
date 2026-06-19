import useAudioLevel from "@/hooks/use-audio-level.ts";
import { useEffect, useRef, useState } from "react";

// Detects "talking while muted": the mic is still capturing (partytracks'
// localMonitorTrack keeps emitting real levels even when shouldBroadcast is
// false — see use-user-media), so we can tell the user they're speaking but
// no one can hear them. Surfaces the hint only after the speaking persists
// for `holdMs`, so a brief cough doesn't nag.
export const useTalkingWhileMuted = (
  monitorTrack?: MediaStreamTrack,
  isMuted?: boolean,
  holdMs = 1000,
) => {
  const { isSpeaking } = useAudioLevel(monitorTrack);
  const [talkingWhileMuted, setTalkingWhileMuted] = useState(false);
  // Timestamp when the current "muted & speaking" streak began, so the hold
  // timer only counts once per streak rather than restarting on every tick.
  const streakStartRef = useRef<number | null>(null);

  useEffect(() => {
    const active = !!isMuted && isSpeaking;

    if (!active) {
      streakStartRef.current = null;
      // Defer the clear to a timer so the effect body never calls setState
      // synchronously (react-hooks/set-state-in-effect).
      const clear = setTimeout(() => setTalkingWhileMuted(false), 0);
      return () => clearTimeout(clear);
    }

    if (streakStartRef.current === null) {
      streakStartRef.current = performance.now();
    }
    const remaining = Math.max(
      0,
      holdMs - (performance.now() - streakStartRef.current),
    );
    const show = setTimeout(() => setTalkingWhileMuted(true), remaining);
    return () => clearTimeout(show);
  }, [isMuted, isSpeaking, holdMs]);

  return talkingWhileMuted;
};
