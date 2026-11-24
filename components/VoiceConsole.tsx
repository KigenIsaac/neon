"use client";
import { useState, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, LOCALE_PROFILES, LOCALE_STORAGE_KEY, parseVoiceLocale, type VoiceLocale } from "@/lib/agent/localisation";
import { useSession } from "@/hooks/useSession";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { NeonOrb } from "./NeonOrb";
import { StartOverlay } from "./StartOverlay";
import { StatusBar } from "./StatusBar";
import { TranscriptPanel } from "./TranscriptPanel";
import { SceneStage } from "./SceneStage";

const LOCALE_EVENT = "neon:locale-change";
function subscribeLocale(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(LOCALE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(LOCALE_EVENT, notify);
  };
}
function readLocale(): VoiceLocale {
  try { return parseVoiceLocale(localStorage.getItem(LOCALE_STORAGE_KEY)); }
  catch { return DEFAULT_LOCALE; }
}
function serverLocale(): VoiceLocale { return DEFAULT_LOCALE; }

export function VoiceConsole() {
  const { session, loading } = useSession();
  const { started, status, transcript, greeting, scene, level, start, shutdown } = useVoiceAssistant(session);
  const persistedLocale = useSyncExternalStore(subscribeLocale, readLocale, serverLocale);
  const [localOverride, setLocalOverride] = useState<VoiceLocale | null>(null);
  const locale = localOverride ?? persistedLocale;
  const [activeLocale, setActiveLocale] = useState<VoiceLocale>(DEFAULT_LOCALE);
  const [pending, setPending] = useState(false);
  const selectLocale = (next: VoiceLocale) => {
    setLocalOverride(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
      window.dispatchEvent(new Event(LOCALE_EVENT));
    } catch { /* optional storage */ }
  };
  const startVoice = async () => {
    if (pending) return;
    setPending(true);
    setActiveLocale(locale);
    try { await start(locale); } finally { setPending(false); }
  };
  const ready = !loading && !!session;

  return (
    <>
      <NeonOrb voiceType={status.mode === "listening" ? "user" : status.mode === "speaking" ? "assistant" : "idle"} level={level} />
      <StartOverlay visible={!started} disabled={!ready || pending} locale={locale} onLocaleChange={selectLocale} onStart={startVoice} error={status.mode === "error" ? status.text : undefined} />
      {started && <div className="active-voice-profile">
        <span>{LOCALE_PROFILES[activeLocale].label}</span>
        <button type="button" onClick={shutdown} disabled={pending}>End session</button>
      </div>}
      <SceneStage scene={scene} />
      <main className="ui-overlay">
        <div id="greeting" className={greeting ? "show" : ""}>{greeting}</div>
        <div className="status-container">
          <StatusBar mode={status.mode} text={status.text} />
          <TranscriptPanel text={transcript} />
        </div>
      </main>
    </>
  );
}