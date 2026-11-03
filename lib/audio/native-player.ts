// Sample-accurate browser-native PCM playback, matching Deepgram AgentPlayer's
// documented strategy. AudioBufferSourceNode lets the browser perform hardware
// sample-rate conversion; there is no custom render-thread queue to rebuffer.
export interface PlaybackDiagnostics {
  outputSampleRate: number;
  queuedMs: number;
  packetGaps: number;
  outputLatencyMs: number | null;
}

export interface PlaybackCallbacks {
  onState?: (state: "playing" | "idle" | "drained") => void;
  onSpeaking?: (active: boolean) => void;
  onDrained?: () => void;
  onLevel?: (level: number) => void;
  onDiagnostics?: (diagnostics: PlaybackDiagnostics) => void;
}

const INPUT_SAMPLE_RATE = 24000;
const START_AHEAD_SECONDS = 0.025;
const NOTABLE_GAP_SECONDS = 0.035;

export class NativePcmPlayer {
  private gain: GainNode;
  private nodes = new Set<AudioBufferSourceNode>();
  private cursor = 0;
  private generation = 0;
  private serverDone = false;
  private speaking = false;
  private packetGaps = 0;
  private lastDiagnosticAt = -Infinity;

  private context: AudioContext;
  private cb: PlaybackCallbacks;

  constructor(context: AudioContext, cb: PlaybackCallbacks = {}) {
    this.context = context;
    this.cb = cb;
    this.gain = context.createGain();
    this.gain.gain.value = 0.96;
    this.gain.connect(context.destination);
  }

  getDiagnostics(): PlaybackDiagnostics {
    const latency = (this.context as AudioContext & { outputLatency?: number }).outputLatency;
    return {
      outputSampleRate: this.context.sampleRate,
      queuedMs: Math.max(0, Math.round((this.cursor - this.context.currentTime) * 1000)),
      packetGaps: this.packetGaps,
      outputLatencyMs: typeof latency === "number" && Number.isFinite(latency)
        ? Math.round(latency * 1000) : null
    };
  }

  queue(rawPcm: ArrayBuffer) {
    const samples = Math.floor(rawPcm.byteLength / 2);
    if (!samples) return;

    // Deepgram Voice Agent output is little-endian signed PCM16 at 24 kHz.
    // Decode exactly once and pass source data to Web Audio for resampling.
    const pcm = new DataView(rawPcm);
    const audioBuffer = this.context.createBuffer(1, samples, INPUT_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples; i++) {
      const sample = pcm.getInt16(i * 2, true) / 32768;
      channel[i] = sample;
      if (Math.abs(sample) > peak) peak = Math.abs(sample);
    }

    const node = this.context.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(this.gain);

    const now = this.context.currentTime;
    // Give the very first packet a tiny device startup cushion. During an
    // active response, schedule as close to the clock as possible so late
    // packets do not acquire a fresh 25 ms gap at every chunk boundary.
    const earliest = now + (this.nodes.size === 0 ? START_AHEAD_SECONDS : 0.005);
    const scheduledStart = Math.max(earliest, this.cursor);
    const gap = this.speaking && this.cursor > 0
      ? scheduledStart - this.cursor : 0;

    const generation = this.generation;
    node.onended = () => {
      this.nodes.delete(node);
      try { node.disconnect(); } catch {}
      if (generation !== this.generation) return;
      if (this.serverDone && this.nodes.size === 0) this.markDrained();
    };
    node.start(scheduledStart);
    this.nodes.add(node);
    this.cursor = scheduledStart + audioBuffer.duration;
    this.serverDone = false;

    if (gap > NOTABLE_GAP_SECONDS) this.packetGaps++;
    if (!this.speaking) {
      this.speaking = true;
      this.cb.onState?.("playing");
      this.cb.onSpeaking?.(true);
    }
    this.cb.onLevel?.(Math.min(1, peak));
    if (gap > NOTABLE_GAP_SECONDS || now - this.lastDiagnosticAt >= 1) {
      this.lastDiagnosticAt = now;
      this.cb.onDiagnostics?.(this.getDiagnostics());
    }
  }

  serverAudioDone() {
    this.serverDone = true;
    if (this.nodes.size === 0) this.markDrained();
  }

  private markDrained() {
    if (!this.speaking) return;
    this.speaking = false;
    this.cursor = 0;
    this.cb.onLevel?.(0);
    this.cb.onState?.("drained");
    this.cb.onSpeaking?.(false);
    this.cb.onDiagnostics?.(this.getDiagnostics());
    this.cb.onDrained?.();
  }

  interrupt() {
    this.generation++;
    this.serverDone = false;
    this.cursor = 0;
    for (const node of this.nodes) {
      node.onended = null;
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    this.nodes.clear();
    this.cb.onLevel?.(0);
    if (this.speaking) {
      this.speaking = false;
      this.cb.onSpeaking?.(false);
    }
    this.cb.onState?.("idle");
    this.cb.onDiagnostics?.(this.getDiagnostics());
  }

  dispose() {
    this.interrupt();
    try { this.gain.disconnect(); } catch {}
  }
}
