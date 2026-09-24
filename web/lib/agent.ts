"use client";

// The New dashboard draft, shared by the Build and Generate tabs. Generate runs the agent over
// AG-UI (bare @ag-ui/client): each prompt sends the conversation and the current draft as state,
// so manual edits flow back to the agent; the agent's STATE_DELTA events land in the draft as they
// arrive, and a run's changes stay pending until Keep or Undo. A kept change can still be undone
// until the next prompt or manual edit.
import { HttpAgent } from "@ag-ui/client";
import { useEffect, useRef, useState } from "react";

import { API_URL, type Widget } from "./api/client";

interface DraftState {
  widgets: Widget[];
}

// The server validates the state against the widget schemas before sending it.
const isDraftState = (value: unknown): value is DraftState =>
  typeof value === "object" && value !== null && "widgets" in value && Array.isArray(value.widgets);

/** Type, size and settings without empty values, so client and server copies compare equal. */
const content = (w: Widget) =>
  JSON.stringify([w.type, w.size, Object.entries(w.settings).filter(([, v]) => v != null).sort()]);

/** Widgets in `next` that are new or different from `before`. */
function changedIds(before: Widget[], next: Widget[]): Set<string> {
  const old = new Map(before.map((w) => [w.id, content(w)]));
  return new Set(next.filter((w) => old.get(w.id) !== content(w)).map((w) => w.id));
}

const sameLayout = (a: Widget[], b: Widget[]) =>
  a.map((w) => w.id + content(w)).join() === b.map((w) => w.id + content(w)).join();

export interface DashboardDraft {
  widgets: Widget[];
  /** Manual edits: Build, and drags and removals in the Generate preview. */
  edit: (widgets: Widget[]) => void;
  /** Sends a prompt; a change still pending is kept. */
  send: (prompt: string) => Promise<void>;
  keep: () => void;
  undo: () => void;
  /** Widgets the last Keep kept, until the next prompt or manual edit; null when there is none. */
  kept: number | null;
  undoKept: () => void;
  running: boolean;
  /** A generated change is waiting for Keep or Undo. */
  pending: boolean;
  /** Widgets the current or pending change added or changed. */
  changed: ReadonlySet<string>;
  /** The agent's reply to the last prompt, then the changes it made, one per line. */
  reply: string;
  error: string | null;
  /** Prompts sent so far. */
  prompts: number;
}

export function useDashboardDraft(): DashboardDraft {
  const [agent] = useState(() => new HttpAgent({ url: `${API_URL}/agent/generate` }));
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const latest = useRef<Widget[]>([]);
  const [undoTo, setUndoTo] = useState<Widget[] | null>(null);
  const [kept, setKept] = useState<{ from: Widget[]; count: number } | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState(0);

  useEffect(() => () => agent.abortRun(), [agent]);

  const apply = (next: Widget[]) => {
    latest.current = next;
    setWidgets(next);
  };

  const edit = (next: Widget[]) => {
    setKept(null);
    apply(next);
  };

  const settle = () => {
    setUndoTo(null);
    setChanged(new Set());
  };

  const send = async (prompt: string) => {
    if (agent.isRunning) return;
    const start = latest.current;
    settle();
    setKept(null);
    setReply("");
    setError(null);
    setRunning(true);
    setPrompts((n) => n + 1);
    agent.setState({ widgets: start });
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: prompt });
    const texts = new Map<string, string>();
    try {
      await agent.runAgent(
        {},
        {
          onStateChanged: ({ state }) => {
            if (!isDraftState(state)) return;
            apply(state.widgets);
            setChanged(changedIds(start, state.widgets));
          },
          // The buffer holds the message before this event's delta.
          onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
            texts.set(event.messageId, textMessageBuffer + event.delta);
            setReply([...texts.values()].join("\n"));
          },
          onRunErrorEvent: ({ event }) => setError(event.message),
        },
      );
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : "Generate failed"));
    } finally {
      setRunning(false);
    }
    if (!sameLayout(start, latest.current)) setUndoTo(start);
  };

  /** Restores `to` and tells the agent its last changes are gone. */
  const revert = (to: Widget[]) => {
    apply(to);
    setReply("Undone.");
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "system",
      content: "The user undid the changes from your last reply.",
    });
  };

  const undo = () => {
    if (!undoTo) return;
    revert(undoTo);
    settle();
  };

  const keep = () => {
    if (undoTo) setKept({ from: undoTo, count: changed.size });
    settle();
  };

  const undoKept = () => {
    if (!kept) return;
    revert(kept.from);
    setKept(null);
  };

  return {
    widgets,
    edit,
    send,
    keep,
    undo,
    kept: kept?.count ?? null,
    undoKept,
    running,
    pending: undoTo !== null,
    changed,
    reply,
    error,
    prompts,
  };
}
