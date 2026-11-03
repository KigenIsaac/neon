"use client";

export interface RecentConversation {
  id: string;
  title: string | null;
  started_at: string;
}

export function StartOverlay({
  visible, disabled, onStart, conversations, onResume, onDelete, error, onRetryAuth
}: {
  visible: boolean;
  disabled: boolean;
  onStart: () => void;
  conversations: RecentConversation[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  error?: string;
  onRetryAuth?: () => void;
}) {
  return (
    <section id="start-overlay" className={visible ? "" : "hidden"} aria-label="Start NEON">
      <h1>NEON</h1>
      <button className="wake-button" type="button" disabled={disabled} onClick={onStart}>
        {disabled ? "Preparing your voice interface..." : "Wake the orb and begin"}
      </button>
      {error && (
        <div className="auth-error" role="alert">
          <p>{error}</p>
          {onRetryAuth && <button type="button" onClick={onRetryAuth}>Retry sign-in</button>}
        </div>
      )}
      {conversations.length > 0 && (
        <div className="recent-sessions">
          <h2>Continue a conversation</h2>
          <ul>
            {conversations.slice(0, 6).map((item) => (
              <li key={item.id}>
                <button type="button" className="resume-session"
                  onClick={() => onResume(item.id)}
                  aria-label={`Resume ${item.title || "Voice session"}`}>
                  <span>{item.title || "Voice session"}</span>
                  <time dateTime={item.started_at}>
                    {new Date(item.started_at).toLocaleDateString()}
                  </time>
                </button>
                <button type="button" className="delete-session"
                  onClick={() => onDelete(item.id)}
                  title="Delete conversation" aria-label="Delete saved conversation">
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <p className="history-notice">Resuming shares recent conversation turns with the voice AI provider.</p>
        </div>
      )}
    </section>
  );
}
