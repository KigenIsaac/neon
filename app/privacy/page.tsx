import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy and data | NEON",
  description: "How NEON processes voice, conversation history, notes, and account data."
};

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <a href="/" className="privacy-back">← Back to NEON</a>
      <h1>Privacy and data</h1>
      <p className="privacy-lead">NEON is an experimental voice-first AI application. This page explains what the software is designed to do with your data.</p>

      <h2>Voice and AI processing</h2>
      <p>When you begin a voice session and grant microphone permission, your browser sends live microphone audio to Deepgram&apos;s Voice Agent service. Deepgram coordinates transcription, language-model responses and speech synthesis using the providers configured for this application. Generated speech audio is returned to your browser for playback.</p>
      <p>You can choose keyboard-only mode instead. Muting the microphone stops its browser media tracks. The browser asks for permission when microphone access is first needed.</p>

      <h2>Saved conversations</h2>
      <p>NEON stores transcripts and AI-generated visual scene snapshots in its Supabase database, associated with your authenticated session. On conversation resume or reconnection, recent transcripts can be provided to the AI voice service to recover context. You can review recent conversations and permanently delete one from the start screen.</p>

      <h2>Private notes</h2>
      <p>When you explicitly ask NEON to save a note, you must approve the exact text in an on-screen confirmation. Notes are stored in Supabase with row-level security and can be reviewed and deleted using Saved notes. Do not save passwords, secret tokens, financial card numbers or sensitive identification data.</p>

      <h2>Anonymous accounts and retention</h2>
      <p>By default, NEON creates an anonymous Supabase authentication session. It is not a permanent account and cannot be recovered if you lose the browser&apos;s session storage. Conversation records and notes remain in the database until deleted or removed under the operator&apos;s data retention process. This application does not currently provide automatic expiration of all stored conversations.</p>

      <h2>Rate limiting and operational data</h2>
      <p>To control abuse and costs, the server tracks temporary voice-token issuance for authenticated sessions and global hourly usage. The application may record server-side errors needed for debugging and reliability.</p>

      <h2>External providers</h2>
      <p>Deepgram and its configured voice/AI services process requests needed to deliver conversations. Supabase hosts account and conversation data. Their own privacy, retention and data processing practices apply independently. Deleting an item inside NEON does not necessarily remove data retained separately by upstream providers.</p>

      <h2>Your controls</h2>
      <p>You can use text-only mode, stop or mute the microphone, end the session, delete saved notes and conversations, and choose not to save new notes. Avoid sharing highly sensitive information in experimental AI conversations.</p>

      <p className="privacy-footnote">This is a technical description of the application behavior, not a complete legal privacy policy for commercial deployment. The production operator must add a verified identity, contact information, lawful-basis disclosures, retention periods and applicable compliance notices before offering the service broadly.</p>
    </main>
  );
}
