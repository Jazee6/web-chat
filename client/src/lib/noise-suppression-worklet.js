class NoiseSuppressionWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 480;
    this.inputBuffer = new Float32Array(this.frameSize * 4);
    this.inputBufferLength = 0;

    this.outputQueue = new Float32Array(this.frameSize * 10);
    this.outputQueueLength = 0;
    this.outputQueueReadIndex = 0;

    this.port.onmessage = (event) => {
      // Received processed frame from main thread
      const processedFrame = event.data;
      if (
        this.outputQueueLength + processedFrame.length <=
        this.outputQueue.length
      ) {
        // We can just use a simple ring buffer or shift array
        // For simplicity, shift array if we are close to end
        if (
          this.outputQueueReadIndex +
            this.outputQueueLength +
            processedFrame.length >
          this.outputQueue.length
        ) {
          this.outputQueue.copyWithin(
            0,
            this.outputQueueReadIndex,
            this.outputQueueReadIndex + this.outputQueueLength,
          );
          this.outputQueueReadIndex = 0;
        }

        // If queue is too long, drop oldest frames to prevent latency buildup
        if (this.outputQueueLength > this.frameSize * 4) {
          const dropCount = this.outputQueueLength - this.frameSize * 2;
          this.outputQueueReadIndex += dropCount;
          this.outputQueueLength -= dropCount;
        }

        this.outputQueue.set(
          processedFrame,
          this.outputQueueReadIndex + this.outputQueueLength,
        );
        this.outputQueueLength += processedFrame.length;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    // 1. Add new input to buffer
    this.inputBuffer.set(inputChannel, this.inputBufferLength);
    this.inputBufferLength += inputChannel.length;

    // 2. Send frames to main thread when we have enough
    while (this.inputBufferLength >= this.frameSize) {
      const frame = new Float32Array(this.frameSize);
      frame.set(this.inputBuffer.subarray(0, this.frameSize));

      this.port.postMessage(frame, [frame.buffer]);

      this.inputBuffer.copyWithin(0, this.frameSize, this.inputBufferLength);
      this.inputBufferLength -= this.frameSize;
    }

    // 3. Output processed data if we have enough
    if (this.outputQueueLength >= outputChannel.length) {
      const chunk = this.outputQueue.subarray(
        this.outputQueueReadIndex,
        this.outputQueueReadIndex + outputChannel.length,
      );
      outputChannel.set(chunk);
      this.outputQueueReadIndex += outputChannel.length;
      this.outputQueueLength -= outputChannel.length;

      if (this.outputQueueLength === 0) {
        this.outputQueueReadIndex = 0;
      }
    } else {
      // Not enough processed data yet (waiting for main thread), output silence
      outputChannel.fill(0);
    }

    return true;
  }
}

registerProcessor("noise-suppression-worklet", NoiseSuppressionWorklet);
