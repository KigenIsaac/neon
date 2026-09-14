"use client";

export function TranscriptPanel({ text }: { text: string }) {
  return (
    <div id="transcript" aria-live="polite">
      {text}
    </div>
  );
}