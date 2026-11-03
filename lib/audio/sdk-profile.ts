/** The one canonical PCM contract for Deepgram's maintained browser SDK. */
export const DEEPGRAM_INPUT_RATE = 16_000;
export const DEEPGRAM_OUTPUT_RATE = 24_000;

export const DEEPGRAM_MICROPHONE_OPTIONS = {
  sampleRate: DEEPGRAM_INPUT_RATE,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
} as const;

export const DEEPGRAM_RECONNECT_OPTIONS = {
  enabled: true,
  maxAttempts: 5,
  baseDelay: 800,
  maxDelay: 15_000,
  jitter: true
} as const;

export interface PlaybackDiagnostics {
  /** Deepgram stream rate; output hardware rate is managed by the browser. */
  outputSampleRate: number;
  /** Seconds scheduled by AgentPlayer, converted to milliseconds. */
  queuedMs: number;
  /** Estimated late audio arrivals while a reply is ongoing. */
  packetGaps: number;
  /** SDK does not expose the platform output-latency value. */
  outputLatencyMs: number | null;
}

/** A conservative signal to help diagnose network jitter, not a QoS guarantee. */
export function appearsToBeLatePacket(
  elapsedSincePreviousPacketMs: number,
  queuedAudioBeforeArrivalMs: number,
  alreadySpeaking: boolean
): boolean {
  return alreadySpeaking &&
    elapsedSincePreviousPacketMs > 120 &&
    queuedAudioBeforeArrivalMs < 15;
}
