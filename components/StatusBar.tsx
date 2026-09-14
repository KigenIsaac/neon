"use client";
import type { StatusMode } from "@/types";

export function StatusBar({ mode, text }: { mode: StatusMode; text: string }) {
  return (
    <div id="status" aria-live="polite">
      <span className={`dot ${mode === "idle" ? "" : mode}`} />
      <span>{text}</span>
    </div>
  );
}