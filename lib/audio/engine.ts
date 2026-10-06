import { AUDIO_WORKLET_CODE } from "./worklet-code";

export interface AudioEngineCallbacks {
  onMicChunk?: (buffer: ArrayBuffer) => void;
  onPlaybackState?: (state: string) => void;
  onDrained?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onInputLevel?: (level: number, source?: string) => void;
}

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private workletUrl: string | null = null;
  private playbackWorklet: AudioWorkletNode | null = null;
  private micWorklet: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;

  private playbackGeneration = 0;
  private playbackState: "idle" | "buffering" | "playing" | "drained" = "idle";

  constructor(private cb: AudioEngineCallbacks = {}) {}

  async initialize() {
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      this.audioCtx = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    if (this.audioCtx.state !== "running") throw new Error("AudioContext not running");

    if (!this.workletUrl) {
      const blob = new Blob([AUDIO_WORKLET_CODE], { type: "application/javascript" });
      this.workletUrl = URL.createObjectURL(blob);
      await this.audioCtx.audioWorklet.addModule(this.workletUrl);
    }

    if (!this.playbackWorklet) {
      this.playbackWorklet = new AudioWorkletNode(
        this.audioCtx, "agent-playback-processor",
        { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] }
      );
      this.playbackWorklet.port.onmessage = (e) => this.onPlaybackMessage(e.data);
      this.playbackWorklet.connect(this.audioCtx.destination);
    }

    if (!this.mediaStream) {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    }
  }

  async startMicrophone() {
    if (!this.audioCtx || !this.mediaStream || this.micWorklet) return;
    this.micSource = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.micWorklet = new AudioWorkletNode(this.audioCtx, "microphone-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers"
    });
    this.micWorklet.port.onmessage = (e) => {
      const d = e.data;
      if (!d || d.type !== "mic-pcm") return;
      try {
        const ab = d.buffer as ArrayBuffer;
        // compute simple peak level from Int16 PCM
        const pcm = new Int16Array(ab);
        let max = 0;
        for (let i = 0; i < pcm.length; i++) {
          const v = pcm[i];
          const abs = v < 0 ? Math.abs(v) / 32768 : v / 32767;
          if (abs > max) max = abs;
        }
        this.cb.onInputLevel?.(Math.max(0, Math.min(1, max)), "mic");
      } catch {
        // Ignore malformed telemetry from the worklet.
      }
      this.cb.onMicChunk?.(d.buffer as ArrayBuffer);
    };
    this.micSource.connect(this.micWorklet);
  }

  stopMicrophone() {
    if (this.micWorklet) {
      this.micWorklet.port.onmessage = null;
      try { this.micWorklet.disconnect(); } catch {}
      this.micWorklet = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch {}
      this.micSource = null;
    }
  }

  playPCM(ab: ArrayBuffer) {
    if (!this.playbackWorklet || ab.byteLength < 2) return;
    const usable = ab.byteLength - (ab.byteLength % 2);
    if (usable <= 0) return;
    const buf = ab.slice(0, usable);
    try {
      this.playbackWorklet.port.postMessage(
        { type: "audio", generation: this.playbackGeneration, buffer: buf },
        [buf]
      );
      this.playbackState = "buffering";
      this.cb.onSpeakingChange?.(true);
    } catch (err) {
      console.error("playPCM post error", err);
    }
  }

  signalServerDone() {
    this.playbackWorklet?.port.postMessage({
      type: "server-done",
      generation: this.playbackGeneration
    });
  }

  stopPlayback() {
    this.playbackGeneration++;
    this.playbackState = "idle";
    this.playbackWorklet?.port.postMessage({
      type: "flush",
      generation: this.playbackGeneration
    });
    this.cb.onSpeakingChange?.(false);
  }

  private onPlaybackMessage(d: unknown) {
    if (!d || typeof d !== "object") return;

    const message = d as {
      type?: "telemetry" | "state" | "drained";
      level?: unknown;
      generation?: number;
      state?: "idle" | "buffering" | "playing" | "drained";
    };

    switch (message.type) {
      case "telemetry":
        if (message.level !== undefined) this.cb.onInputLevel?.(Math.max(0, Math.min(1, Number(message.level) || 0)), "playback");
        break;
      case "state":
        if (message.generation !== this.playbackGeneration || !message.state) return;
        this.playbackState = message.state;
        this.cb.onPlaybackState?.(message.state);
        if (message.state === "playing") this.cb.onSpeakingChange?.(true);
        break;
      case "drained":
        if (message.generation !== this.playbackGeneration) return;
        this.cb.onSpeakingChange?.(false);
        this.cb.onDrained?.();
        break;
    }
  }

  async shutdown() {
    this.stopMicrophone();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      this.mediaStream = null;
    }
    if (this.playbackWorklet) {
      try { this.playbackWorklet.port.onmessage = null; } catch {}
      try { this.playbackWorklet.disconnect(); } catch {}
      this.playbackWorklet = null;
    }
    if (this.workletUrl) {
      try { URL.revokeObjectURL(this.workletUrl); } catch {}
      this.workletUrl = null;
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      await this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }
}