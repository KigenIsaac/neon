"use client";
import type { PlaybackDiagnostics } from "@/lib/audio/sdk-profile";

export function AudioHealthPanel({
  diagnostics, microphoneDevice, speechInterruptions, onClose
}: {
  diagnostics: PlaybackDiagnostics | null;
  microphoneDevice: string | null;
  speechInterruptions: number;
  onClose: () => void;
}) {
  return (
    <section className="audio-health-panel" aria-label="Local audio health diagnostics">
      <div className="audio-health-heading">
        <h2>Sound diagnostics</h2>
        <button type="button" onClick={onClose} aria-label="Close audio diagnostics">Close</button>
      </div>
      <dl>
        <div><dt>Deepgram voice stream</dt><dd>{diagnostics ? diagnostics.outputSampleRate.toLocaleString() + " Hz" : "Awaiting audio"}</dd></div>
        <div><dt>Recent audio queued</dt><dd>{diagnostics ? diagnostics.queuedMs + " ms" : "—"}</dd></div>
        <div><dt>Estimated packet gaps</dt><dd>{diagnostics?.packetGaps ?? 0}</dd></div>
        <div><dt>Speech interruptions</dt><dd>{speechInterruptions}</dd></div>
        <div><dt>Output latency</dt><dd>{diagnostics?.outputLatencyMs !== null && diagnostics?.outputLatencyMs !== undefined ? diagnostics.outputLatencyMs + " ms" : "Not reported"}</dd></div>
        <div><dt>Microphone input</dt><dd>{microphoneDevice || "Muted or browser-managed microphone"}</dd></div>
      </dl>
      <p className="audio-health-advice">
          If you use Bluetooth headphones on Windows, opening their
          headset microphone can switch its speakers into low-quality hands-free mode.
          Choose your laptop&apos;s built-in microphone in Windows Settings → System → Sound → Input,
          and keep the Bluetooth headphones as the output device.
      </p>
      <p className="audio-health-advice">
        Estimated packet gaps suggest irregular audio delivery. Rising speech interruptions
        while NEON is speaking can indicate real interruptions or speaker echo. If both stay
        near zero but the sound is distorted, check the Windows output device, enhancements
        and Bluetooth hands-free profile.
      </p>
      <p className="audio-health-privacy">These diagnostics are generated on your device, not transmitted as a separate report.</p>
    </section>
  );
}
