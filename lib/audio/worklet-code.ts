export const AUDIO_WORKLET_CODE = `
// Audio rendering is real-time: never concatenate or slice a growing playback
// buffer here. Keep a preallocated bounded ring instead.
class MicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.step = sampleRate / this.targetRate;
    this.totalInput = 0;
    this.nextOutput = 0;
    this.previousSample = 0;
    this.frame = new Int16Array(480);
    this.frameCount = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;
    const start = this.totalInput;
    const end = start + input.length;

    // Continuous phase across arbitrary input block sizes and hardware rates
    // (44.1 kHz, 48 kHz, 96 kHz, etc). A previous boundary sample is retained.
    while (this.nextOutput < end - 1) {
      const position = this.nextOutput - start;
      const index = Math.floor(position);
      const fraction = position - index;
      const a = index < 0 ? this.previousSample : input[index];
      const b = input[index + 1];
      const value = a * (1 - fraction) + b * fraction;
      const clipped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
      this.frame[this.frameCount++] = clipped < 0 ? clipped * 32768 : clipped * 32767;
      this.nextOutput += this.step;
      if (this.frameCount === this.frame.length) {
        const output = this.frame;
        this.frame = new Int16Array(480);
        this.frameCount = 0;
        this.port.postMessage({ type: "mic-pcm", buffer: output.buffer }, [output.buffer]);
      }
    }
    this.previousSample = input[input.length - 1];
    this.totalInput = end;
    return true;
  }
}

class AgentPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputRate = 24000;
    this.ratio = this.inputRate / sampleRate;
    this.capacity = 1 << 18; // 10.9 s of PCM at 24 kHz, fixed-size allocation
    this.mask = this.capacity - 1;
    this.ring = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.phase = 0;

    // Start with 100 ms; increase after real underruns on jittery connections.
    this.minPrebuffer = Math.round(this.inputRate * 0.10);
    this.maxPrebuffer = Math.round(this.inputRate * 0.28);
    this.prebufferSamples = this.minPrebuffer;
    this.maxQueuedSamples = this.inputRate * 6;
    this.lastUnderrunSample = -Infinity;
    this.underrunCooldownSamples = Math.round(sampleRate * 0.25);
    this.stablePlaybackSamples = 0;
    this.outputGain = 0;
    this.fadeStep = 1 / Math.max(1, Math.round(sampleRate * 0.006));
    this.lastLevel = 0;
    this.processedFrames = 0;
    this.lastTelemetryFrame = 0;

    this.state = "idle";
    this.serverDone = false;
    this.generation = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "audio") {
        if (Number.isFinite(data.generation) && data.generation !== this.generation) return;
        this.appendPCM(data.buffer);
      } else if (data.type === "server-done") {
        if (Number.isFinite(data.generation) && data.generation !== this.generation) return;
        this.serverDone = true;
        this.maybeNotifyDrain();
      } else if (data.type === "flush" || data.type === "reset") {
        this.flush(data.generation);
      }
    };
  }

  availableSamples() {
    return Math.max(0, this.writeIndex - this.readIndex - this.phase);
  }

  notifyState(state) {
    if (this.state === state) return;
    this.state = state;
    this.port.postMessage({ type: "state", state, generation: this.generation });
  }

  appendPCM(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 2) return;
    const usable = buffer.byteLength - (buffer.byteLength % 2);
    if (!usable) return;
    const pcm = new Int16Array(buffer, 0, usable / 2);
    for (let i = 0; i < pcm.length; i++) {
      // Cap the oldest queued audio if the producer runs vastly ahead of
      // playback. Normal conversations never approach this six-second cap.
      if (this.writeIndex - this.readIndex >= this.maxQueuedSamples) {
        const skip = this.writeIndex - this.readIndex - this.inputRate * 3;
        this.readIndex += Math.max(1, skip);
        this.phase = 0;
        this.outputGain = 0;
        this.port.postMessage({ type: "overflow", generation: this.generation });
      }
      const value = pcm[i];
      this.ring[this.writeIndex & this.mask] = value < 0 ? value / 32768 : value / 32767;
      this.writeIndex++;
    }
    this.serverDone = false;
    if (this.state === "idle" || this.state === "drained") {
      this.outputGain = 0;
      this.notifyState("buffering");
    }
  }

  flush(generation) {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.phase = 0;
    this.serverDone = false;
    this.outputGain = 0;
    this.lastLevel = 0;
    this.stablePlaybackSamples = 0;
    this.prebufferSamples = this.minPrebuffer;
    if (Number.isFinite(generation)) this.generation = generation;
    else this.generation++;
    this.notifyState("idle");
    this.port.postMessage({ type: "flushed", generation: this.generation });
  }

  maybeNotifyDrain() {
    if (!this.serverDone || this.availableSamples() > 0 || this.state === "drained") return;
    this.notifyState("drained");
    this.port.postMessage({ type: "drained", generation: this.generation });
  }

  notifyTelemetry() {
    if (this.processedFrames - this.lastTelemetryFrame < sampleRate * 0.10) return;
    this.lastTelemetryFrame = this.processedFrames;
    this.port.postMessage({
      type: "telemetry",
      generation: this.generation,
      state: this.state,
      samples: Math.floor(this.availableSamples()),
      bufferedMs: Math.round(this.availableSamples() / this.inputRate * 1000),
      level: Math.max(0, Math.min(1, this.lastLevel))
    });
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels || !channels[0]) return true;
    const output = channels[0];
    // Output is mono by design; make any unexpected additional channels
    // silent rather than playing undefined data.
    for (const channel of channels) channel.fill(0);
    this.processedFrames += output.length;

    if (this.state === "buffering") {
      if (this.availableSamples() >= this.prebufferSamples ||
          (this.serverDone && this.availableSamples() > 0)) {
        this.notifyState("playing");
      } else {
        this.maybeNotifyDrain();
        this.notifyTelemetry();
        return true;
      }
    }
    if (this.state !== "playing") {
      this.maybeNotifyDrain();
      this.notifyTelemetry();
      return true;
    }

    let rendered = 0;
    let maxAbs = 0;
    for (let i = 0; i < output.length; i++) {
      const queued = this.writeIndex - this.readIndex;
      if (queued <= 0 || (queued === 1 && !this.serverDone)) break;
      const first = this.ring[this.readIndex & this.mask];
      const second = queued > 1 ? this.ring[(this.readIndex + 1) & this.mask] : first;
      let sample = first + (second - first) * this.phase;

      // De-click: fade in after starting/rebuffering and fade down if the
      // producer runs dry or after its final packet. Avoid hard transitions.
      this.outputGain = Math.min(1, this.outputGain + this.fadeStep);
      const remaining = queued - this.phase;
      const fadeOut = Math.min(1, remaining / (this.inputRate * 0.004));
      sample *= this.outputGain * fadeOut * 0.98;

      output[i] = sample;
      const magnitude = Math.abs(sample);
      if (magnitude > maxAbs) maxAbs = magnitude;
      this.phase += this.ratio;
      const whole = Math.floor(this.phase);
      if (whole) {
        this.readIndex += whole;
        this.phase -= whole;
      }
      rendered++;
    }

    if (rendered < output.length) {
      if (this.serverDone) {
        // A final mono sample may have been linearly interpolated twice on
        // 48 kHz devices. Now the queued audio really has finished.
        this.readIndex = this.writeIndex;
        this.phase = 0;
        this.maybeNotifyDrain();
      } else {
        if (this.processedFrames - this.lastUnderrunSample > this.underrunCooldownSamples) {
          this.lastUnderrunSample = this.processedFrames;
          this.prebufferSamples = Math.min(
            this.maxPrebuffer, this.prebufferSamples + Math.round(this.inputRate * 0.04)
          );
          this.port.postMessage({
            type: "underrun", generation: this.generation,
            targetBufferMs: Math.round(this.prebufferSamples / this.inputRate * 1000)
          });
        }
        this.stablePlaybackSamples = 0;
        this.outputGain = 0;
        this.notifyState("buffering");
      }
    } else {
      this.stablePlaybackSamples += rendered;
      // Gradually decrease latency again after ten seconds without glitches.
      if (this.stablePlaybackSamples >= sampleRate * 10) {
        this.stablePlaybackSamples = 0;
        this.prebufferSamples = Math.max(
          this.minPrebuffer, this.prebufferSamples - Math.round(this.inputRate * 0.02)
        );
      }
      if (this.serverDone) this.maybeNotifyDrain();
    }

    this.lastLevel = Math.max(maxAbs, this.lastLevel * 0.94);
    this.notifyTelemetry();
    return true;
  }
}

registerProcessor("microphone-processor", MicrophoneProcessor);
registerProcessor("agent-playback-processor", AgentPlaybackProcessor);
`;
