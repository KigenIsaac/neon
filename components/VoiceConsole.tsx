"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { NeonOrb } from "./NeonOrb";
import { StartOverlay, type RecentConversation } from "./StartOverlay";
import { StatusBar } from "./StatusBar";
import { TranscriptPanel } from "./TranscriptPanel";
import { SceneStage } from "./SceneStage";
import { NotesPanel } from "./NotesPanel";
import { SaveNoteDialog } from "./SaveNoteDialog";
import { TranscriptDrawer } from "./TranscriptDrawer";
import { AudioHealthPanel } from "./AudioHealthPanel";

export function VoiceConsole() {
  const { session, loading, error: authError, retry: retryAuth } = useSession();
  const {
    started, status, transcript, messages, lastLatencyMs, audioDiagnostics, microphoneDevice, speechInterruptions, storageWarning, greeting, scene, level, muted,
    pendingSaveNote, resolveSaveNote,
    start, shutdown, retry, toggleMute, sendText
  } = useVoiceAssistant(session);
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState("");
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudioHealth, setShowAudioHealth] = useState(false);
  const ready = !loading && !!session;

  useEffect(() => {
    if (!ready || started) return;
    const controller = new AbortController();
    void fetch("/api/conversations", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("History unavailable");
        return res.json() as Promise<{conversations?: RecentConversation[]}>;
      })
      .then((data) => { if (!controller.signal.aborted) setRecent(data.conversations ?? []); })
      .catch((error) => { if (!controller.signal.aborted) console.warn("history unavailable", error); });
    return () => controller.abort();
  }, [ready, started]);

  const deleteConversation = async (id: string) => {
    if (!window.confirm("Permanently delete this conversation and its scenes?")) return;
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Unable to delete conversation");
      setRecent((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      console.error("delete failed", error);
      window.alert("Could not delete this conversation. Please try again.");
    }
  };

  return (
    <>
      <NeonOrb
        voiceType={status.mode === "listening" ? "user" : status.mode === "speaking" ? "assistant" : "idle"}
        level={level}
      />
      <StartOverlay
        visible={!started} disabled={!ready}
        onStart={() => { void start(); }}
        onStartText={() => { void start(undefined, "text"); }}
        conversations={recent}
        onResume={(id) => { void start(id); }}
        onDelete={(id) => { void deleteConversation(id); }}
        error={authError}
        onRetryAuth={authError ? retryAuth : undefined}
      />
      <SceneStage scene={scene} />
      {started && showNotes && <NotesPanel onClose={() => setShowNotes(false)} />}
      {started && showTranscript && <TranscriptDrawer messages={messages} onClose={() => setShowTranscript(false)} />}
      {pendingSaveNote !== null && <SaveNoteDialog note={pendingSaveNote} onDecision={resolveSaveNote} />}
      <main className="ui-overlay">
        <div id="greeting" className={greeting ? "show" : ""}>{greeting}</div>
        <div className="status-container">
          <StatusBar mode={status.mode} text={status.text} />
          {lastLatencyMs !== null && <span className="latency-chip" aria-label="Latest voice provider latency">
            Provider latency: {lastLatencyMs.toLocaleString()} ms
          </span>}
          <TranscriptPanel text={transcript} />
          {storageWarning && (
            <p className="storage-warning" role="status">
              Some conversation history could not be saved. You can continue speaking,
              but recent messages may not appear after this session.
            </p>
          )}
          {started && showAudioHealth && (
            <AudioHealthPanel
              diagnostics={audioDiagnostics} microphoneDevice={microphoneDevice}
              speechInterruptions={speechInterruptions}
              onClose={() => setShowAudioHealth(false)}
            />
          )}
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
                <button type="button" onClick={() => setShowNotes(true)}>Saved notes</button>
                <button type="button" onClick={() => setShowTranscript(true)}>Transcript</button>
                <button type="button" onClick={() => setShowAudioHealth((v) => !v)} aria-expanded={showAudioHealth}>Sound diagnostics</button>
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
