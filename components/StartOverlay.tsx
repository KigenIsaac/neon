"use client";

export function StartOverlay({ visible, onStart }: { visible: boolean; onStart: () => void }) {
  return (
    <div
      id="start-overlay"
      className={visible ? "" : "hidden"}
      role="button"
      tabIndex={0}
      aria-label="Start voice assistant"
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStart(); }
      }}
    >
      <h1>NEON ORB</h1>
      <p>Tap anywhere to begin</p>
    </div>
  );
}