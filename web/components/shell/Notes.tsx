"use client";

// Analyst notes on a subject (monitor pages) or a development (evidence drawer), saved through
// the notes API.
import { useState, type FormEvent } from "react";

import type { Schema } from "@/lib/api/client";
import { useAddNote, useDeleteNote, type NoteTarget } from "@/lib/api/queries";
import { dateTime } from "@/lib/format";
import { XIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

export function Notes({ target, notes }: { target: NoteTarget; notes: Schema<"Note">[] }) {
  const [text, setText] = useState("");
  const add = useAddNote();
  const remove = useDeleteNote();
  const toast = useToast();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate(
      { target, text: text.trim() },
      {
        onSuccess: () => setText(""),
        onError: () => toast({ message: "Could not save the note" }),
      },
    );
  };

  return (
    <div className="notes">
      <form onSubmit={submit} className="note-form">
        <textarea
          aria-label="Note"
          placeholder="Add a note for whoever reads this next"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
        />
        <button type="submit" className="btn sm" disabled={!text.trim() || add.isPending}>
          Add note
        </button>
      </form>
      {notes.map((n) => (
        <div key={n.id} className="note">
          <p>{n.text}</p>
          <span className="cap">{dateTime(n.created_at)}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete note"
            disabled={remove.isPending}
            onClick={() => remove.mutate(n.id, { onError: () => toast({ message: "Could not delete the note" }) })}
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
