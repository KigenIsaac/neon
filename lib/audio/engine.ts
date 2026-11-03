import { AUDIO_WORKLET_CODE } from "./worklet-code";
import { NativePcmPlayer, type PlaybackDiagnostics } from "./native-player";

export interface AudioEngineCallbacks {
  onMicChunk?: (buffer: ArrayBuffer) => void;
  onPlaybackState?: (state: string) => void;
  onDrained?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onInputLevel?: (level: number, source?: string) => void;
  onPlaybackDiagnostics?: (diagnostics: PlaybackDiagnostics) => void;
  onMicrophoneDevice?: (label: string | null) => void;
}

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private workletUrl: string | null = null;
  private player: NativePcmPlayer | null = null;
  private micWorklet: AudioWorkletNode | null = null;
  private micOutputSink: GainNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  private micRequest: Promise<void> | null = null;
  private microphoneEpoch = 0;


  constructor(private cb: AudioEngineCallbacks = {}) {}

  async initialize({ microphone = true }: { microphone?: boolean } = {}) {
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      this.audioCtx = new AudioContext({ latencyHint: "balanced" });
    }
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    if (this.audioCtx.state !== "running") throw new Error("AudioContext not running");

    if (!this.workletUrl) {
      const blob = new Blob([AUDIO_WORKLET_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await this.audioCtx.audioWorklet.addModule(url);
        this.workletUrl = url;
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    }

    if (!this.player) {
      this.player = new NativePcmPlayer(this.audioCtx, {
        onState: (state) => this.cb.onPlaybackState?.(state),
        onSpeaking: (speaking) => this.cb.onSpeakingChange?.(speaking),
        onLevel: (level) => this.cb.onInputLevel?.(level, "playback"),
        onDrained: () => this.cb.onDrained?.(),
        onDiagnostics: (data) => this.cb.onPlaybackDiagnostics?.(data)
      });
    }

    if (microphone) await this.enableMicrophone();
  }

  async enableMicrophone() {
    if (this.mediaStream) return;
    if (this.micRequest) return this.micRequest;
    const epoch = this.microphoneEpoch;
    const promise = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    }).then((stream) => {
      // A late permission response must not resurrect a released microphone.
      if (this.microphoneEpoch !== epoch ||
          !this.audioCtx || this.audioCtx.state === "closed") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mediaStream = stream;
      this.cb.onMicrophoneDevice?.(stream.getAudioTracks()[0]?.label || null);
    }).finally(() => {
      if (this.micRequest === promise) this.micRequest = null;
    });
    this.micRequest = promise;
    return promise;
  }

  async startMicrophone() {
    if (!this.audioCtx || this.micWorklet) return;
    if (!this.mediaStream) await this.enableMicrophone();
    if (!this.audioCtx || !this.mediaStream || this.micWorklet) return;
    this.micSource = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.micWorklet = new AudioWorkletNode(this.audioCtx, "microphone-processor", {
      numberOfInputs: 1,
      // A connected silent output guarantees the microphone worklet stays
      // on the active audio graph on browsers that cull unconnected nodes.
      numberOfOutputs: 1,
      outputChannelCount: [1],
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
    this.micOutputSink = this.audioCtx.createGain();
    this.micOutputSink.gain.value = 0;
    this.micSource.connect(this.micWorklet);
    this.micWorklet.connect(this.micOutputSink);
    this.micOutputSink.connect(this.audioCtx.destination);
  }

  stopMicrophone() {
    this.microphoneEpoch++;
    this.cb.onMicrophoneDevice?.(null);
    this.micRequest = null;
    if (this.micWorklet) {
      this.micWorklet.port.onmessage = null;
      try { this.micWorklet.disconnect(); } catch {}
      this.micWorklet = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch {}
      this.micSource = null;
    }
    if (this.micOutputSink) {
      try { this.micOutputSink.disconnect(); } catch {}
      this.micOutputSink = null;
    }
    // Disconnecting an AudioWorklet alone does not turn off the user's
    // hardware microphone. Stop media tracks as well, including on mute.
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try { track.stop(); } catch {}
      }
      this.mediaStream = null;
    }
  }

  playPCM(ab: ArrayBuffer) {
    if (!this.player || ab.byteLength < 2) return;
    try {
      this.player.queue(ab);
    } catch (error) {
      // Fail visibly instead of silently waiting forever in buffering state.
      console.error("PCM playback failed", error);
      this.cb.onPlaybackState?.("idle");
    }
  }

  signalServerDone() {
    this.player?.serverAudioDone();
  }

  stopPlayback() {
    this.player?.interrupt();
  }

  async shutdown() {
    this.stopMicrophone();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      this.mediaStream = null;
    }
    this.player?.dispose();
    this.player = null;
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