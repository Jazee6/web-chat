import { type DenoiseState, Rnnoise } from "@shiguredo/rnnoise-wasm";
import { Observable } from "rxjs";
// Vite will treat this as a raw URL string pointing to the generated worker asset
import workletUrl from "./noise-suppression-worklet.js?url";

const INT16_MAX_VALUE = 0x7fff;

export const noiseSuppression = (
  originalAudioStreamTrack: MediaStreamTrack,
) => {
  return new Observable<MediaStreamTrack>((subscriber) => {
    let audioContext: AudioContext | null = null;
    let rnnoise: Rnnoise | null = null;
    let denoiseState: DenoiseState | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let destinationNode: MediaStreamAudioDestinationNode | null = null;
    let isProcessing = true;

    const setup = async () => {
      try {
        rnnoise = await Rnnoise.load();
        denoiseState = rnnoise.createDenoiseState();
        const frameSize = rnnoise.frameSize;
        const tempProcessingFrame = new Float32Array(frameSize);

        audioContext = new AudioContext({
          sampleRate: 48000,
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

        // Handle messages from the worklet (frames to process)
        workletNode.port.onmessage = (event) => {
          if (!isProcessing || !denoiseState) return;

          const frame = event.data as Float32Array;
          if (frame.length !== frameSize) return;

          for (let i = 0; i < frameSize; i++) {
            tempProcessingFrame[i] = frame[i] * INT16_MAX_VALUE;
          }

          denoiseState.processFrame(tempProcessingFrame);

          const processedFrame = new Float32Array(frameSize);
          for (let i = 0; i < frameSize; i++) {
            processedFrame[i] = Math.max(
              -1.0,
              Math.min(1.0, tempProcessingFrame[i] / INT16_MAX_VALUE),
            );
          }

          // Send processed frame back to the worklet
          workletNode?.port.postMessage(processedFrame, [
            processedFrame.buffer,
          ]);
        };

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
      isProcessing = false;
      if (workletNode) {
        workletNode.port.onmessage = null;
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
      if (denoiseState) {
        denoiseState.destroy();
      }
    };
  });
};
