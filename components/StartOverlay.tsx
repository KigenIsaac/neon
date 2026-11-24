"use client";

import { LOCALE_IDS, LOCALE_PROFILES, type VoiceLocale } from "@/lib/agent/localisation";

export function StartOverlay({
  visible, disabled, locale, onLocaleChange, onStart, error
}: {
  visible: boolean;
  disabled: boolean;
  locale: VoiceLocale;
  onLocaleChange: (locale: VoiceLocale) => void;
  onStart: () => void;
  error?: string;
}) {
  return (
    <div id="start-overlay" className={visible ? "" : "hidden"} inert={!visible}>
      <h1>NEON</h1>
      <div className="locale-settings">
        <label htmlFor="voice-locale">Conversation language</label>
        <select id="voice-locale" value={locale} disabled={disabled}
          onChange={(event) => {
            const next = LOCALE_IDS.find((id) => id === event.target.value);
            if (next) onLocaleChange(next);
          }}>
          {LOCALE_IDS.map((id) => <option key={id} value={id}>{LOCALE_PROFILES[id].label}</option>)}
        </select>
        <small id="locale-description" aria-live="polite">{LOCALE_PROFILES[locale].description}</small>
      </div>
      {error && <small role="alert" className="locale-error">{error}</small>}
      <button type="button" className="wake-button" disabled={disabled} onClick={onStart}>
        {disabled ? "Preparing your voice interface…" : "Wake the orb and begin"}
      </button>
    </div>
  );
}
