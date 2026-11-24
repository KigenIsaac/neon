/** Local conversation profiles, independent of provider-specific language codes. */
export const LOCALE_IDS = ["kenyan-english", "kiswahili-input", "international"] as const;
export type VoiceLocale = (typeof LOCALE_IDS)[number];
export const DEFAULT_LOCALE: VoiceLocale = "kenyan-english";
export const LOCALE_STORAGE_KEY = "neon.voice.locale.v1";

export function parseVoiceLocale(value: unknown): VoiceLocale {
  return LOCALE_IDS.find((locale) => locale === value) ?? DEFAULT_LOCALE;
}

const KENYAN_KEYTERMS = [
  "M-Pesa", "Safaricom", "Airtel Money", "matatu", "boda boda", "SACCO",
  "chama", "harambee", "Huduma Centre", "Nairobi", "Mombasa", "Kisumu",
  "Nakuru", "Eldoret", "Baringo", "Eldama Ravine", "Murang'a", "Kakamega",
  "KRA", "eCitizen", "NSSF", "SHA", "Kiswahili", "Sheng", "chapati",
  "ugali", "sukuma wiki", "nyama choma", "niaje", "sawa", "poa",
  "msee", "thao", "bob", "uko aje", "si ati", "sasa", "bana"
] as const;

const KENYAN_CONTEXT = `
KENYAN LINGUISTIC AND CULTURAL INTELLIGENCE:
- Treat Kenyan English as a legitimate variety, not an error. Use natural Kenyan English with British spelling where appropriate.
- Understand common Kiswahili and Sheng words and mixed English/Kiswahili phrases. Slang varies by region, speaker and time; ask rather than guessing unclear meanings.
- Use professional English for technical and formal discussions; in casual conversation mirror the user's register gently. Never force slang or caricature accents.
- Examples of context-dependent meaning: "si you explain" is a request to explain; "niko kwa mat" may mean on a matatu; "thao" may mean one thousand shillings; "bob" often means shillings; "form" may mean a plan, activity or document.
- Default to Kenyan shillings (KES), East Africa Time (UTC+3), metric units and unambiguous day-month-year dates when the context is Kenyan.
- Recognise local institutions and terms such as M-Pesa, SACCO, chama, KRA, NSSF, SHA, Huduma Centre and eCitizen. Do not invent current prices, policies, exchange rates or laws; say when live verification is needed.
- Preserve names, numbers, negation and the meaning of the original utterance. Confirm ambiguous names, financial amounts, dates and other consequential details instead of silently correcting them.
- Use mostly English in spoken replies because the current Zeus synthesizer is English-only. Short familiar local phrases are fine when they improve clarity; avoid long Kiswahili passages that the voice may mispronounce. Do not claim to have a native Kenyan accent.
`.trim();

export interface LocaleProfile {
  label: string;
  description: string;
  sttLanguage: "en" | "sw";
  keyterms: readonly string[];
  prompt: string;
  greeting: string;
}

export const LOCALE_PROFILES: Readonly<Record<VoiceLocale, LocaleProfile>> = {
  "kenyan-english": {
    label: "Kenyan English",
    description: "Local vocabulary and conversational style. English Zeus voice; mixed-language recognition is best effort.",
    sttLanguage: "en",
    keyterms: KENYAN_KEYTERMS,
    prompt: KENYAN_CONTEXT,
    greeting: "Hello! How are you doing today? I'm NEON. What can I help you with?"
  },
  "kiswahili-input": {
    label: "Kiswahili input (experimental)",
    description: "Speak Kiswahili; NEON answers in English. Not a full bilingual or Sheng speech model.",
    sttLanguage: "sw",
    keyterms: ["M-Pesa", "Safaricom", "matatu", "boda boda", "chama", "Nairobi", "Mombasa", "Kisumu", "Huduma Centre"],
    prompt: KENYAN_CONTEXT + "\nThe input speech is Kiswahili. Understand it directly and answer naturally in Kenyan English. Ask for clarification when needed.",
    greeting: "Hello! You can speak to me in Kiswahili. I will reply in English."
  },
  international: {
    label: "International English",
    description: "Original English conversation and Zeus voice, without local vocabulary bias.",
    sttLanguage: "en",
    keyterms: [],
    prompt: "Use clear, neutral international English. Follow the user's context rather than assuming a country.",
    greeting: "Hello! I am your NEON assistant. How can I help you today?"
  }
};
