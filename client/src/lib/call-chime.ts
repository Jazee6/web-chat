// Synthesizes a short two-tone "ring" chime via the Web Audio API — no asset
// file needed. Browsers may block autoplay until there's been a user gesture
// (e.g. the mic permission grant a Call requires); if blocked, the AudioContext
// stays suspended and this is a no-op. The toast itself still fires, so the
// user is notified either way.
//
// Throttled to one chime per 3s so several people joining in quick succession
// don't stack into a jarring chord. The per-participant toasts are NOT
// throttled — only the sound is.
const CHIME_THROTTLE_MS = 3_000;
let lastChime = 0;

export const playCallChime = () => {
  if (Date.now() - lastChime < CHIME_THROTTLE_MS) return;
  lastChime = Date.now();
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    // Two quick sine tones a minor third apart — a gentle "ba-ding".
    const tones = [
      { freq: 880, start: 0, dur: 0.18 },
      { freq: 1175, start: 0.16, dur: 0.32 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      // Envelope: quick attack, exponential decay to avoid a click.
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.02);
    }
    // Close the context once the last tone finishes so it can be GC'd.
    setTimeout(() => void ctx.close(), 700);
  } catch {
    // AudioContext unavailable or blocked — chime is best-effort.
  }
};
