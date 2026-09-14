"use client";

export function StartOverlay({
  visible,
  disabled,
  onStart
}: {
  visible: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  const handleStart = () => {
    if (!visible || disabled) return;
    onStart();
  };

  return (
    <div
      id="start-overlay"
      className={visible ? "" : "hidden"}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={disabled ? "Voice assistant is loading" : "Wake the orb and start voice assistant"}
      onClick={handleStart}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          onStart();
        }
      }}
    >
      <h1>NEON</h1>
      <p>{disabled ? "Preparing your voice interface..." : "Wake the orb and begin"}</p>
    </div>
  );
}