"use client";
import { useEffect, useRef } from "react";

/** A real user gesture, rather than a model assertion, authorizes storage. */
export function SaveNoteDialog({
  note, onDecision
}: {
  note: string;
  onDecision: (approved: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onDecision(false);
    };
    dialog?.addEventListener("cancel", handleCancel);
    return () => {
      dialog?.removeEventListener("cancel", handleCancel);
      if (dialog?.open) dialog.close();
    };
  }, [onDecision]);
  return (
    <dialog ref={ref} className="note-confirm-dialog" aria-labelledby="note-confirm-title">
      <h2 id="note-confirm-title">Save this note?</h2>
      <p>NEON wants to remember the following text in your private notes:</p>
      <blockquote>{note}</blockquote>
      <p className="note-confirm-help">You can delete this note later. Do not store secrets or passwords.</p>
      <div className="note-confirm-actions">
        <button type="button" onClick={() => onDecision(false)}>Cancel</button>
        <button type="button" className="confirm-primary" onClick={() => onDecision(true)}>Save note</button>
      </div>
    </dialog>
  );
}
