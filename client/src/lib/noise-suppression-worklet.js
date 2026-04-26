import { Rnnoise } from "@shiguredo/rnnoise-wasm";

const INT16_MAX_VALUE = 0x7fff;

class NoiseSuppressionWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rnnoise = null;
    this.denoiseState = null;
    this.frameSize = 480;

    // Buffer for collecting input frames
    this.inputBuffer = new Float32Array(this.frameSize * 4);
    this.inputBufferLength = 0;

    this.tempProcessingFrame = new Float32Array(this.frameSize);

    // Initialize RNNoise
    Rnnoise.load().then((rnnoise) => {
      this.rnnoise = rnnoise;
      this.denoiseState = rnnoise.createDenoiseState();
      this.frameSize = rnnoise.frameSize;

      // Re-initialize buffers based on actual frame size if it differs
      this.inputBuffer = new Float32Array(this.frameSize * 4);
      this.tempProcessingFrame = new Float32Array(this.frameSize);
      this.inputBufferLength = 0;

      this.port.postMessage({ type: "initialized" });
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // If no input/output or RNNoise is not loaded yet, bypass audio
    if (!input || !input[0] || !output || !output[0] || !this.denoiseState) {
      if (input && input[0] && output && output[0]) {
        output[0].set(input[0]);
      }
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];
    const processSize = inputChannel.length; // usually 128

    // 1. Add new input to buffer
    this.inputBuffer.set(inputChannel, this.inputBufferLength);
    this.inputBufferLength += processSize;

    // 2. We only process when we have at least one full RNNoise frame (usually 480 samples)
    if (this.inputBufferLength >= this.frameSize) {
      // Extract the frame to process
      const frameToProcess = this.inputBuffer.subarray(0, this.frameSize);

      // Convert Float32 [-1.0, 1.0] to Int16 range
      for (let i = 0; i < this.frameSize; i++) {
        // 使用 Math.tanh 进行软裁剪 (Soft Clipping)，防止声音过大时发生生硬的截断。
        // 同时确保传递给 WASM 的数值严格限制在 16-bit PCM 范围内，防止底层 C 代码发生整数溢出 (Wrap-around) 产生爆音
        let sample = Math.tanh(frameToProcess[i]);
        this.tempProcessingFrame[i] = sample * INT16_MAX_VALUE;
      }

      // In-place processing by RNNoise
      this.denoiseState.processFrame(this.tempProcessingFrame);

      // Convert back to Float32 [-1.0, 1.0]
      for (let i = 0; i < this.frameSize; i++) {
        frameToProcess[i] = this.tempProcessingFrame[i] / INT16_MAX_VALUE;
      }

      // Shift the buffer to the left
      this.inputBuffer.copyWithin(0, this.frameSize, this.inputBufferLength);
      this.inputBufferLength -= this.frameSize;
    }

    // 3. Output logic
    // Because the Worklet processes in chunks of 128, and RNNoise works in chunks of 480,
    // we have an inherent delay. In a perfect real-time scenario without a ring buffer delay,
    // we can output what's currently at the start of our input buffer, since it contains
    // a mix of already processed data and unprocessed new data.
    // For simplicity and lowest latency, we output the first `processSize` samples from the buffer.
    outputChannel.set(this.inputBuffer.subarray(0, processSize));

    return true;
  }
}

registerProcessor("noise-suppression-worklet", NoiseSuppressionWorklet);
