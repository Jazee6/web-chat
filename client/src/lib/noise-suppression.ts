import { Observable } from "rxjs";
// Vite will treat this as a raw URL string pointing to the generated worker asset
import workletUrl from "./noise-suppression-worklet.js?url";

export const noiseSuppression = (
  originalAudioStreamTrack: MediaStreamTrack,
) => {
  return new Observable<MediaStreamTrack>((subscriber) => {
    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let destinationNode: MediaStreamAudioDestinationNode | null = null;

    const setup = async () => {
      try {
        audioContext = new AudioContext({
          // Removed hardcoded sampleRate: 48000
          // Let the browser choose its native sample rate to avoid distortion from resampling.
          latencyHint: "interactive",
        });

        // Load the AudioWorklet module
        await audioContext.audioWorklet.addModule(workletUrl);

        const stream = new MediaStream([originalAudioStreamTrack]);
        sourceNode = audioContext.createMediaStreamSource(stream);

        // Create the worklet node
        workletNode = new AudioWorkletNode(
          audioContext,
          "noise-suppression-worklet",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
          },
        );

        destinationNode = audioContext.createMediaStreamDestination();

        sourceNode.connect(workletNode);
        workletNode.connect(destinationNode);

        const processedTrack = destinationNode.stream.getAudioTracks()[0];
        if (processedTrack) {
          subscriber.next(processedTrack);
        } else {
          subscriber.error(new Error("Failed to get processed audio track"));
        }
      } catch (error) {
        subscriber.error(error);
      }
    };

    void setup();

    return () => {
      if (workletNode) {
        workletNode.disconnect();
      }
      if (sourceNode) {
        sourceNode.disconnect();
      }
      if (destinationNode) {
        destinationNode.disconnect();
      }
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close();
      }
    };
  });
};
