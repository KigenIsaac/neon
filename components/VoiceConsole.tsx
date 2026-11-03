"use client";
import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { NeonOrb } from "./NeonOrb";
import { StartOverlay } from "./StartOverlay";
import { StatusBar } from "./StatusBar";
import { TranscriptPanel } from "./TranscriptPanel";
import { SceneStage } from "./SceneStage";

export function VoiceConsole() {
  const { session, loading } = useSession();
  const {
    started, status, transcript, greeting, scene, level, muted,
    start, shutdown, retry, toggleMute, sendText
  } = useVoiceAssistant(session);
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState("");
  const ready = !loading && !!session;

  return (
    <>
      <NeonOrb
        voiceType={status.mode === "listening" ? "user" : status.mode === "speaking" ? "assistant" : "idle"}
        level={level}
      />
      <StartOverlay visible={!started && ready} disabled={!ready} onStart={start} />
      <SceneStage scene={scene} />
      <main className="ui-overlay">
        <div id="greeting" className={greeting ? "show" : ""}>{greeting}</div>
        <div className="status-container">
          <StatusBar mode={status.mode} text={status.text} />
          <TranscriptPanel text={transcript} />
          {started && (
            <>
              <form className="text-entry" onSubmit={(event) => {
                event.preventDefault();
                if (sendText(message)) {
                  setMessage("");
                  setSendError("");
                } else {
                  setSendError("Not connected. Use Retry and send again.");
                }
              }}>
                <label className="sr-only" htmlFor="neon-message">Type to NEON</label>
                <input
                  id="neon-message" value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Or type a message..."
                  maxLength={2000}
                  autoComplete="off"
                />
                <button type="submit" disabled={!message.trim()} aria-label="Send message">Send</button>
              </form>
              {sendError && <p className="input-error" role="alert">{sendError}</p>}
              <div className="voice-actions" role="group" aria-label="Voice session controls">
                <button type="button" onClick={() => { void toggleMute(); }}
                  aria-pressed={muted}>
                  {muted ? "Unmute mic" : "Mute mic"}
                </button>
                {status.mode === "error" && (
                  <button type="button" onClick={() => { void retry(); }}>Retry connection</button>
                )}
                <button type="button" onClick={shutdown}>End session</button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
