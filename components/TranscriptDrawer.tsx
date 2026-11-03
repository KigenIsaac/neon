"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryTurn } from "@/lib/agent/settings";

export function TranscriptDrawer({
  messages, onClose
}: {
  messages: HistoryTurn[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const copyText = async () => {
    try {
      const text = messages.map((m) => `${m.role === "user" ? "You" : "NEON"}: ${m.content}`).join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied to clipboard");
    } catch {
      setCopyStatus("Clipboard permission unavailable");
    }
  };
  return (
    <dialog ref={ref} className="transcript-dialog" aria-labelledby="transcript-heading" onClose={onClose}>
      <header>
        <h2 id="transcript-heading">Conversation transcript</h2>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <p className="transcript-tip">Latest 100 messages from this session. The server stores conversation turns separately.</p>
      {messages.length === 0 ? <p className="transcript-empty">No messages yet.</p> : (
        <ol className="transcript-history">
          {messages.map((message, index) => (
            <li className={message.role} key={index}>
              <span>{message.role === "user" ? "You" : "NEON"}</span>
              <p>{message.content}</p>
            </li>
          ))}
        </ol>
      )}
      <footer>
        <button type="button" disabled={messages.length === 0} onClick={() => { void copyText(); }}>
          Copy transcript
        </button>
        <span role="status">{copyStatus}</span>
      </footer>
    </dialog>
  );
}
