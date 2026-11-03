"use client";

import { useEffect, useRef, useState } from "react";

interface Note {
  id: string;
  content: string;
  created_at: string;
}

export function NotesPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const controller = new AbortController();
    void fetch("/api/notes", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load notes");
        return res.json() as Promise<{ notes?: Note[] }>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setNotes(data.notes ?? []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load notes");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (dialog?.open) dialog.close();
    };
  }, []);

  const deleteNote = async (note: Note) => {
    if (!window.confirm("Delete this saved note permanently?")) return;
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error("Could not delete note");
      setNotes((current) => current.filter((entry) => entry.id !== note.id));
      setError("");
    } catch {
      setError("Could not delete that note. Please try again.");
    }
  };

  return (
    <dialog ref={ref} className="notes-dialog" onClose={onClose} aria-labelledby="notes-title">
      <div className="notes-heading">
        <h2 id="notes-title">Saved notes</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="notes-subtitle">Private to this sign-in session. Ask NEON to remember a note, then confirm it on screen.</p>
      {loading && <p>Loading your notes...</p>}
      {error && <p role="alert" className="input-error">{error}</p>}
      {!loading && !error && notes.length === 0 && <p>No notes saved yet.</p>}
      <ul className="notes-list">
        {notes.map((note) => (
          <li key={note.id}>
            <p>{note.content}</p>
            <div className="note-actions">
              <time dateTime={note.created_at}>{new Date(note.created_at).toLocaleDateString()}</time>
              <button type="button" onClick={() => { void deleteNote(note); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
