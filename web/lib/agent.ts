"use client";

// The New dashboard draft, shared by the Build and Generate tabs. Generate runs the agent over
// AG-UI (bare @ag-ui/client): each prompt sends the conversation and the current draft as state,
// so manual edits flow back to the agent; the agent's STATE_DELTA events land in the draft as they
// arrive, and a run's changes stay pending until Keep or Undo. A kept change can still be undone
// until the next prompt or manual edit. The server lists a run's changes in a text message of their
// own, which a CUSTOM "changes" event names (`ChangesEvent` in api/intelmonitor/agent/generate.py),
// so Claude's words are never read as changes. A prompt whose request fails before the run begins
// (a dropped connection, a network change, the API restarting) is sent again, up to three times.
import { EventType, HttpAgent } from "@ag-ui/client";
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

/** How many widgets a change added, changed and removed, from the drafts before and after it. */
export interface Tally {
  added: number;
  changed: number;
  removed: number;
}

function tally(before: Widget[], next: Widget[]): Tally {
  const old = new Map(before.map((w) => [w.id, content(w)]));
  const ids = new Set(next.map((w) => w.id));
  return {
    added: next.filter((w) => !old.has(w.id)).length,
    changed: next.filter((w) => old.has(w.id) && old.get(w.id) !== content(w)).length,
    removed: before.filter((w) => !ids.has(w.id)).length,
  };
}

interface ChangesEvent {
  message_id: string;
  lines: string[];
}

const isChangesEvent = (value: unknown): value is ChangesEvent =>
  typeof value === "object" &&
  value !== null &&
  "message_id" in value &&
  typeof value.message_id === "string" &&
  "lines" in value &&
  Array.isArray(value.lines) &&
  value.lines.every((l) => typeof l === "string");

/** Waits before sending a prompt again whose request failed before the run began. */
const RETRY_MS = [1000, 2000, 4000];

/**
 * A request that failed on the way, not in the agent: the connection dropped or Chrome aborted it
 * (a network change), or the proxy answered 502 to 504 while the API restarted. An abort from
 * the page closing is not.
 */
const transient = (e: unknown) =>
  e instanceof Error &&
  e.name !== "AbortError" &&
  (e instanceof TypeError || ("status" in e && typeof e.status === "number" && e.status >= 502 && e.status <= 504));

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
  /** The agent's own words in reply to the last prompt. */
  reply: string;
  /** The last prompt's changes as the server listed them, one per tool edit. */
  changes: string[];
  /** The last prompt's changes counted on the draft; null until one lands. */
  tally: Tally | null;
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
  const [changes, setChanges] = useState<string[]>([]);
  const [counted, setCounted] = useState<Tally | null>(null);
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
    setChanges([]);
    setCounted(null);
    setError(null);
    setRunning(true);
    setPrompts((n) => n + 1);
    agent.setState({ widgets: start });
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: prompt });
    const texts = new Map<string, string>();
    let changesId: string | null = null;
    // Claude's words, a tool call or an edit: past this, the run may have changed something, so
    // it is never sent again.
    let progressed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        await agent.runAgent(
          {},
          {
            onEvent: ({ event }) => {
              if (event.type !== EventType.RUN_STARTED && event.type !== EventType.STATE_SNAPSHOT) progressed = true;
            },
            onStateChanged: ({ state }) => {
              if (!isDraftState(state)) return;
              apply(state.widgets);
              setChanged(changedIds(start, state.widgets));
              setCounted(tally(start, state.widgets));
            },
            onCustomEvent: ({ event }) => {
              if (event.name !== "changes" || !isChangesEvent(event.value)) return;
              changesId = event.value.message_id;
              setChanges(event.value.lines);
            },
            // The buffer holds the message before this event's delta. Only the latest message
            // shows: Claude's closing sentence, not what it said before a tool call.
            onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
              if (event.messageId === changesId) return;
              texts.set(event.messageId, textMessageBuffer + event.delta);
              setReply([...texts.values()].at(-1) ?? "");
            },
            onRunErrorEvent: ({ event }) => setError(event.message),
          },
        );
        break;
      } catch (e) {
        if (!progressed && attempt < RETRY_MS.length && transient(e)) {
          await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS[attempt]));
          agent.setState({ widgets: start });
          continue;
        }
        setError((prev) => prev ?? (e instanceof Error ? e.message : "Generate failed"));
        break;
      }
    }
    setRunning(false);
    if (!sameLayout(start, latest.current)) setUndoTo(start);
  };

  /** Restores `to` and tells the agent its last changes are gone. */
  const revert = (to: Widget[]) => {
    apply(to);
    setReply("Undone.");
    setChanges([]);
    setCounted(null);
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
    changes,
    tally: counted,
    error,
    prompts,
  };
}
