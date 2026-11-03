"use client";
import type { PlaybackDiagnostics } from "@/lib/audio/native-player";

export function AudioHealthPanel({
  diagnostics, microphoneDevice, speechInterruptions, onClose
}: {
  diagnostics: PlaybackDiagnostics | null;
  microphoneDevice: string | null;
  speechInterruptions: number;
  onClose: () => void;
}) {
  const bluetoothMic = microphoneDevice !== null &&
    /bluetooth|hands.?free|airpods|buds|wireless|headset/i.test(microphoneDevice);

  return (
    <section className="audio-health-panel" aria-label="Local audio health diagnostics">
      <div className="audio-health-heading">
        <h2>Sound diagnostics</h2>
        <button type="button" onClick={onClose} aria-label="Close audio diagnostics">Close</button>
      </div>
      <dl>
        <div><dt>Playback hardware</dt><dd>{diagnostics ? diagnostics.outputSampleRate.toLocaleString() + " Hz" : "Awaiting audio"}</dd></div>
        <div><dt>Recent audio queued</dt><dd>{diagnostics ? diagnostics.queuedMs + " ms" : "—"}</dd></div>
        <div><dt>Detected packet gaps</dt><dd>{diagnostics?.packetGaps ?? 0}</dd></div>
        <div><dt>Speech interruptions</dt><dd>{speechInterruptions}</dd></div>
        <div><dt>Output latency</dt><dd>{diagnostics?.outputLatencyMs !== null && diagnostics?.outputLatencyMs !== undefined ? diagnostics.outputLatencyMs + " ms" : "Not reported"}</dd></div>
        <div><dt>Active microphone</dt><dd>{microphoneDevice || "Muted or no microphone"}</dd></div>
      </dl>
      {bluetoothMic && (
        <p className="audio-health-advice">
          Your microphone looks like a headset device. On Windows, opening a Bluetooth
          headset microphone can switch its speakers into low-quality hands-free mode.
          Try the laptop&apos;s built-in mic with the Bluetooth headset used only for output.
        </p>
      )}
      <p className="audio-health-advice">
        Rising packet gaps suggest irregular audio delivery. Rising speech interruptions
        while NEON is speaking can indicate real interruptions or speaker echo. If both stay
        near zero but the sound is distorted, check the Windows output device, enhancements
        and Bluetooth hands-free profile.
      </p>
      <p className="audio-health-privacy">These diagnostics are generated on your device, not transmitted as a separate report.</p>
    </section>
  );
}
