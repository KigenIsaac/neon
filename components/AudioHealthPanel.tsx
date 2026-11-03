"use client";
import type { PlaybackDiagnostics } from "@/lib/audio/native-player";

export function AudioHealthPanel({
  diagnostics, microphoneDevice, audioInputDevices, selectedMicId, onSelectMic, speechInterruptions, onClose
}: {
  diagnostics: PlaybackDiagnostics | null;
  microphoneDevice: string | null;
  audioInputDevices: Array<{ deviceId: string; label: string }>;
  selectedMicId: string;
  onSelectMic: (id: string) => void;
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
      {audioInputDevices.length > 0 && (
        <label className="audio-mic-select">
          Use microphone
          <select value={selectedMicId} onChange={(event) => onSelectMic(event.target.value)}>
            <option value="">System default</option>
            {audioInputDevices.map((device) => (
              <option value={device.deviceId} key={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {bluetoothMic && (
        <p className="audio-health-advice">
          Your microphone looks like a headset device. On Windows, opening a Bluetooth
          headset microphone can switch its speakers into low-quality hands-free mode.
          Select the laptop&apos;s built-in microphone above and keep the Bluetooth
          headphones as the Windows output device.
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
