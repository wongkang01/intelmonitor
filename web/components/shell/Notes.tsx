"use client";

// Analyst notes on a subject (monitor pages) or a development (evidence drawer), saved through
// the notes API.
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";

import type { Schema } from "@/lib/api/client";
import { useAddNote, useDeleteNote, useRestoreNote, type NoteTarget } from "@/lib/api/queries";
import { dateTime } from "@/lib/format";
import { XIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

export function Notes({ target, notes }: { target: NoteTarget; notes: Schema<"Note">[] }) {
  const [text, setText] = useState("");
  const add = useAddNote();
  const remove = useDeleteNote();
  const restore = useRestoreNote();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  // A note deleted from its focused button, and the note whose delete button takes focus (or null
  // for the note field) once it is gone.
  const deleted = useRef<{ id: number; next: number | null } | null>(null);

  useLayoutEffect(() => {
    const d = deleted.current;
    if (!d || notes.some((n) => n.id === d.id)) return;
    deleted.current = null;
    const next = d.next === null ? "textarea" : `[data-note-id="${d.next}"] button`;
    root.current?.querySelector<HTMLElement>(next)?.focus();
  }, [notes]);

  const onDelete = (i: number, button: HTMLButtonElement) => {
    const note = notes[i];
    if (remove.isPending && remove.variables === note.id) return;
    if (document.activeElement === button) deleted.current = { id: note.id, next: (notes[i + 1] ?? notes[i - 1])?.id ?? null };
    remove.mutate(note.id, {
      onSuccess: () =>
        toast({
          message: "Deleted note",
          action: {
            label: "Undo",
            run: () =>
              restore.mutateAsync(note.id).catch(() => toast({ message: "Could not restore the note" })),
          },
        }),
      onError: () => {
        deleted.current = null;
        toast({ message: "Could not delete the note" });
      },
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    // Add note disables itself once the field clears, so focus moves back to the field.
    const hadFocus = e.currentTarget.contains(document.activeElement);
    add.mutate(
      { target, text: text.trim() },
      {
        onSuccess: () => {
          setText("");
          if (hadFocus) root.current?.querySelector("textarea")?.focus();
        },
        onError: () => toast({ message: "Could not save the note" }),
      },
    );
  };

  return (
    <div className="notes" ref={root}>
      <form onSubmit={submit} className="note-form">
        <textarea
          className="input"
          aria-label="Note"
          placeholder="Add a note"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
        />
        <button type="submit" className="btn btn-sm" disabled={!text.trim() || add.isPending}>
          Add note
        </button>
      </form>
      {notes.map((n, i) => (
        <div key={n.id} className="note" data-note-id={n.id}>
          <p>{n.text}</p>
          <span className="note-meta">{dateTime(n.created_at)}</span>
          <button
            type="button"
            className="btn-icon"
            aria-label="Delete note"
            onClick={(e) => onDelete(i, e.currentTarget)}
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
