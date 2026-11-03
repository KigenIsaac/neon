export const AUDIO_WORKLET_CODE = `
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

    // Phase-accurate streaming linear resampling; no growing/copying
    // Float32Array on the audio render thread.
    while (this.nextOutput < end - 1) {
      const position = this.nextOutput - start;
      const index = Math.floor(position);
      const fraction = position - index;
      const a = index < 0 ? this.previousSample : input[index];
      const b = input[index + 1];
      const value = a * (1 - fraction) + b * fraction;
      const clipped = Math.max(-1, Math.min(1, value));
      this.frame[this.frameCount++] = clipped < 0 ? clipped * 32768 : clipped * 32767;
      this.nextOutput += this.step;

      // Emit 20 ms chunks, reducing port events without adding
      // excessive microphone latency.
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
    this.lastLevel = 0;
    this.ratio = this.inputRate / sampleRate;
    this.prebufferSamples = 1440;
    this.buffer = new Float32Array(0);
    this.position = 0;
    this.state = "idle";
    this.serverDone = false;
    this.generation = 0;
    this.totalPlayedSamples = 0;
    this.lastTelemetryFrame = 0;
    this.lastUnderrunFrame = -Infinity;
    this.underrunCooldownFrames = Math.round(sampleRate * 0.25);
    this.port.onmessage = (e) => {
      const d = e.data; if (!d || typeof d.type !== "string") return;
      if (d.type === "audio") {
        if (!Number.isFinite(d.generation) || d.generation === this.generation) this.appendPCM(d.buffer);
      }
      else if (d.type === "server-done") {
        if (Number.isFinite(d.generation) && d.generation !== this.generation) return;
        this.serverDone = true; this.maybeNotifyDrain();
      } else if (d.type === "flush" || d.type === "reset") this.flush(d.generation);
    };
  }
  availableSamples() { return Math.max(0, this.buffer.length - this.position); }
  appendPCM(ab) {
    if (!ab || ab.byteLength < 2) return;
    const usable = ab.byteLength - (ab.byteLength % 2);
    if (usable <= 0) return;
    const pcm = new Int16Array(ab, 0, usable / 2);
    const incoming = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]; incoming[i] = v < 0 ? v / 32768 : v / 32767;
    }
    const start = Math.floor(this.position);
    const frac = this.position - start;
    const remLen = Math.max(0, this.buffer.length - start);
    const combined = new Float32Array(remLen + incoming.length);
    if (remLen > 0) combined.set(this.buffer.subarray(start), 0);
    combined.set(incoming, remLen);
    this.buffer = combined; this.position = frac; this.serverDone = false;
    if (this.state === "idle" || this.state === "drained") {
      this.state = "buffering"; this.notifyState("buffering");
    }
    if (this.state === "buffering" && this.availableSamples() >= this.prebufferSamples) {
      this.state = "playing"; this.notifyState("playing");
    }
  }
  flush(gen) {
    this.buffer = new Float32Array(0); this.position = 0;
    this.serverDone = false; this.state = "idle"; this.totalPlayedSamples = 0;
    if (Number.isFinite(gen)) this.generation = gen; else this.generation++;
    this.port.postMessage({ type: "flushed", generation: this.generation });
  }
  notifyState(s) { this.port.postMessage({ type: "state", state: s, generation: this.generation }); }
  notifyTelemetry(force = false) {
    const iv = Math.round(sampleRate * 0.10);
    if (!force && (currentFrame - this.lastTelemetryFrame) < iv) return;
    this.lastTelemetryFrame = currentFrame;
    this.port.postMessage({
      type: "telemetry", state: this.state,
      samples: Math.max(0, Math.floor(this.availableSamples())),
      level: Math.max(0, Math.min(1, this.lastLevel || 0)),
      generation: this.generation
    });
  }
  notifyUnderrun() {
    if ((currentFrame - this.lastUnderrunFrame) < this.underrunCooldownFrames) return;
    this.lastUnderrunFrame = currentFrame;
    this.port.postMessage({ type: "underrun", generation: this.generation });
  }
  maybeNotifyDrain() {
    if (!this.serverDone) return;
    if (this.availableSamples() > 0.5) return;
    if (this.state === "drained") return;
    this.state = "drained";
    this.port.postMessage({ type: "state", state: "drained", generation: this.generation });
    this.port.postMessage({ type: "drained", generation: this.generation });
  }
  process(_inputs, outputs) {
    const out = outputs[0]; if (!out || !out[0]) return true;
    const ch = out[0]; ch.fill(0);
    if (this.state === "idle") { this.notifyTelemetry(); return true; }
    if (this.state === "buffering") {
      if (this.availableSamples() >= this.prebufferSamples) {
        this.state = "playing"; this.notifyState("playing");
      } else if (this.serverDone && this.availableSamples() > 1) {
        this.state = "playing"; this.notifyState("playing");
      } else { this.notifyTelemetry(); this.maybeNotifyDrain(); return true; }
    }
    if (this.state !== "playing") { this.maybeNotifyDrain(); this.notifyTelemetry(); return true; }
    let position = this.position; let produced = 0;
    let maxAbs = 0;
    for (let i = 0; i < ch.length; i++) {
      const i0 = Math.floor(position), i1 = i0 + 1;
      if (i1 >= this.buffer.length) break;
      const f = position - i0;
      ch[i] = this.buffer[i0] * (1 - f) + this.buffer[i1] * f;
      const abs = Math.abs(ch[i]); if (abs > maxAbs) maxAbs = abs;
      position += this.ratio; produced++;
    }
    const consumed = Math.floor(position);
    // Compact only occasionally: slicing on every 128-sample quantum
    // previously generated avoidable garbage-collector pressure.
    if (consumed >= 2048 || consumed > this.buffer.length / 2) {
      this.buffer = this.buffer.slice(consumed);
      position -= consumed;
    }
    this.position = position; this.totalPlayedSamples += produced;
    const remaining = this.availableSamples();
    if (produced < ch.length && !this.serverDone && remaining < 1) {
      this.state = "buffering"; this.notifyState("buffering"); this.notifyUnderrun();
    }
    if (this.serverDone && remaining <= 1) {
      this.buffer = new Float32Array(0); this.position = 0;
      this.state = "drained"; this.notifyState("drained");
      this.port.postMessage({ type: "drained", generation: this.generation });
    }
    this.notifyTelemetry();
    // stronger smoothing: keep peaks but decay slowly for smoother visuals
    this.lastLevel = Math.max(maxAbs, (this.lastLevel || 0) * 0.96);
    return true;
  }
}
registerProcessor("microphone-processor", MicrophoneProcessor);
registerProcessor("agent-playback-processor", AgentPlaybackProcessor);
`;