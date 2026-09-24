"use client";

// The New dashboard popup: about 80% of the screen, Build and Generate tabs, Esc or a backdrop
// click closes it. Both tabs edit one draft (lib/agent.ts), so users can switch at any time, and
// both create the same dashboard spec, which then appears in the sidebar and opens. The draft, tab
// and name live outside the dialog, so closing and reopening picks up where the user left off.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { Widget } from "@/lib/api/client";
import { errorMessage, useCatalog, useCreateDashboard, useSubjects } from "@/lib/api/queries";
import { useDashboardDraft } from "@/lib/agent";
import { defaultName, subjectsUsed } from "@/lib/widgets";
import { ChevronLeftIcon, PlusIcon, SendIcon, SparkleIcon } from "@/components/ui/icons";
import { CloseButton, Modal, type CloseReason } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

import { Gallery } from "./AddWidgetSheet";
import { WidgetGrid } from "./WidgetGrid";

type Tab = "build" | "generate";
const TABS: { id: Tab; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "generate", label: "Generate" },
];
const EXAMPLES = [
  "Stablecoin risk for Singapore banks",
  "Geopolitics across SEA countries",
  "Central banks on banking regulation",
];
const HIGHLIGHT_MS = 1600;
/** Generated changes to at most this many widgets are outlined; bigger ones are only listed. */
const OUTLINE_MAX = 2;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const widgetCount = (n: number) => `${n} widget${n === 1 ? "" : "s"}`;

export function NewDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  // A created or discarded dashboard starts a new session, with a fresh draft and agent conversation.
  const [session, setSession] = useState(0);
  return <Session key={session} open={open} onClose={onClose} onReset={() => setSession((n) => n + 1)} />;
}

/** Everything that survives closing the popup: the draft, the tab, the name and the Generate thread. */
function useSessionState() {
  const draft = useDashboardDraft();
  const [tab, setTab] = useState<Tab>("build");
  const [typedName, setTypedName] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  // Widgets in the draft when the latest prompt was sent: none means a first build.
  const [before, setBefore] = useState(0);

  return {
    draft,
    tab,
    setTab,
    typedName,
    setTypedName,
    lastPrompt,
    before,
    send: (prompt: string) => {
      setBefore(draft.widgets.length);
      setLastPrompt(prompt);
      void draft.send(prompt);
    },
  };
}
type SessionState = ReturnType<typeof useSessionState>;

function Session({ open, onClose, onReset }: { open: boolean; onClose: () => void; onReset: () => void }) {
  const state = useSessionState();
  // The body handles Esc and backdrop clicks first: it closes the gallery or asks before closing.
  const dismissRef = useRef<(reason: CloseReason) => boolean>(() => false);

  return (
    <Modal
      open={open}
      onClose={(reason) => {
        if (!dismissRef.current(reason)) onClose();
      }}
      labelledBy="new-dashboard-title"
      className="sheet"
    >
      <NewDashboardBody state={state} onClose={onClose} onReset={onReset} dismissRef={dismissRef} />
    </Modal>
  );
}

function NewDashboardBody({
  state,
  onClose,
  onReset,
  dismissRef,
}: {
  state: SessionState;
  onClose: () => void;
  onReset: () => void;
  dismissRef: React.RefObject<(reason: CloseReason) => boolean>;
}) {
  const router = useRouter();
  const toast = useToast();
  const subjects = useSubjects();
  const catalog = useCatalog();
  const create = useCreateDashboard();
  const { draft, tab, setTab } = state;
  const [gallery, setGallery] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    dismissRef.current = (reason) => {
      if (asking) {
        setAsking(false);
        return true;
      }
      if (tab === "build" && gallery && draft.widgets.length > 0) {
        setGallery(false);
        return true;
      }
      if (reason === "backdrop" && draft.widgets.length > 0) {
        setAsking(true);
        return true;
      }
      return false;
    };
  }, [dismissRef, asking, gallery, tab, draft.widgets.length]);

  const subjectIds = subjectsUsed(draft.widgets);
  const names = subjectIds.flatMap((id) => subjects.data?.find((s) => s.id === id)?.name ?? []);
  const name = state.typedName ?? defaultName(names);
  const canCreate = draft.widgets.length > 0 && !draft.pending && !draft.running && !create.isPending;

  const submit = () => {
    if (!canCreate) return;
    create.mutate(
      {
        name: name.trim() || defaultName(names),
        subject_ids: subjectIds,
        widgets: draft.widgets.map((w, order) => ({ ...w, order })),
      },
      {
        onSuccess: (created) => {
          onClose();
          onReset();
          router.push(`/dashboards/${created.id}`);
          toast({ message: `Created ${created.name}` });
        },
        onError: (e) => toast({ message: errorMessage(e, "Could not create the dashboard") }),
      },
    );
  };

  const onRemove = (id: string) => {
    const all = draft.widgets;
    const removed = all.find((w) => w.id === id);
    if (!removed) return;
    draft.edit(all.filter((w) => w.id !== id));
    const name = catalog.data?.find((t) => t.type === removed.type)?.name;
    toast({
      message: name ? `Removed ${name}` : "Widget removed",
      action: { label: "Undo", run: () => draft.edit(all) },
    });
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next: Tab = tab === "build" ? "generate" : "build";
    setTab(next);
    document.getElementById(`new-dashboard-tab-${next}`)?.focus();
  };

  return (
    <>
      <div className="sheet-head nd-head" inert={asking}>
        <h2 id="new-dashboard-title">New dashboard</h2>
        <div className="seg" role="tablist" aria-label="How to build" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`new-dashboard-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`new-dashboard-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.id === "generate" && <SparkleIcon size={12} twin />}
              {t.label}
            </button>
          ))}
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div
        className="nd-body"
        role="tabpanel"
        id={`new-dashboard-${tab}`}
        aria-labelledby={`new-dashboard-tab-${tab}`}
        inert={asking}
      >
        {tab === "build" ? (
          <BuildPane state={state} subjectIds={subjectIds} gallery={gallery} setGallery={setGallery} onRemove={onRemove} />
        ) : (
          <GeneratePane state={state} subjectIds={subjectIds} onRemove={onRemove} />
        )}
      </div>
      <div className="nd-foot" inert={asking}>
        <label htmlFor="new-dashboard-name">Name</label>
        <input
          id="new-dashboard-name"
          className="input"
          value={name}
          placeholder="Dashboard name"
          maxLength={80}
          onChange={(e) => state.setTypedName(e.target.value)}
        />
        <span className="grow" />
        <ChangeStatus state={state} />
        <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={submit}>
          Create dashboard
        </button>
      </div>
      {asking && (
        <CloseConfirm
          count={draft.widgets.length}
          onCancel={() => setAsking(false)}
          onClose={() => {
            setAsking(false);
            onClose();
          }}
          onDiscard={() => {
            onClose();
            onReset();
          }}
        />
      )}
    </>
  );
}

/** The footer's change line: what is pending with Undo and Keep, what was kept, or the widget count. */
function ChangeStatus({ state }: { state: SessionState }) {
  const { draft } = state;
  let content: React.ReactNode = null;
  if (draft.pending && !draft.running) {
    const n = draft.changed.size;
    content = (
      <>
        <b>{n ? `${widgetCount(n)} pending` : "Change pending"}</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={draft.undo}>
          Undo
        </button>
        <button type="button" className="btn btn-sm" onClick={draft.keep}>
          Keep
        </button>
      </>
    );
  } else if (draft.kept !== null) {
    content = (
      <>
        <span>{draft.kept ? `Kept ${widgetCount(draft.kept)}` : "Kept the change"}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={draft.undoKept}>
          Undo
        </button>
      </>
    );
  } else if (draft.widgets.length) {
    content = <span className="nd-num">{widgetCount(draft.widgets.length)}</span>;
  }
  return (
    <span className="nd-status" role="status">
      {content}
    </span>
  );
}

/** Asked when a backdrop click would close a popup that holds a draft. */
function CloseConfirm({
  count,
  onCancel,
  onClose,
  onDiscard,
}: {
  count: number;
  onCancel: () => void;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Deferred: a backdrop mousedown opens this, and its default action then focuses the dialog.
  useEffect(() => {
    const t = window.setTimeout(() => cancel.current?.focus());
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="nd-confirm-layer" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="nd-confirm" role="alertdialog" aria-labelledby="nd-confirm-title" aria-describedby="nd-confirm-desc">
        <h3 id="nd-confirm-title">Close with {widgetCount(count)} in the draft?</h3>
        <p id="nd-confirm-desc">The draft stays until you create the dashboard or discard it.</p>
        <div className="nd-confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onDiscard}>
            Discard draft
          </button>
          <span className="grow" />
          <button type="button" className="btn" ref={cancel} onClick={onCancel}>
            Keep editing
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// The server's change lines, one per widget: "Added Watchlist, medium, OCBC."
const CHANGE = /^(Added|Changed|Removed) .+/;
const VERB_PAST = { Added: "added", Changed: "changed", Removed: "removed" } as const;

/** Splits the agent reply into a one-line summary of the changes ("Added 6 widgets"), the agent's
 *  own sentence, and the change lines for the Details disclosure. Without change lines, the agent's
 *  text is the summary. */
function readReply(reply: string) {
  const lines = reply.split("\n").filter((l) => l.trim());
  const changes = lines.filter((l) => CHANGE.test(l));
  const note = lines.filter((l) => !CHANGE.test(l)).join(" ");
  if (!changes.length) return { summary: note, note: "", changes };
  const counts = (["Added", "Changed", "Removed"] as const)
    .map((verb) => [verb, changes.filter((l) => l.startsWith(`${verb} `)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([verb, n], i) => `${i ? VERB_PAST[verb] : verb} ${widgetCount(n)}`);
  return { summary: counts.join(", "), note, changes };
}

/** Grid callbacks that edit the draft by hand. */
function useDraftGrid(state: SessionState, onRemove: (id: string) => void) {
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const widgets = state.draft.widgets;
  return {
    settingsFor,
    onSettings: setSettingsFor,
    onReorder: (ids: string[]) => {
      const byId = new Map(widgets.map((w) => [w.id, w]));
      state.draft.edit(ids.flatMap((id) => byId.get(id) ?? []));
    },
    onRemove: (id: string) => {
      onRemove(id);
      if (settingsFor === id) setSettingsFor(null);
    },
    onChange: (widget: Widget) => state.draft.edit(widgets.map((w) => (w.id === widget.id ? widget : w))),
    onLongPress: () => {},
  };
}

// Build: the preview fills the popup in edit mode, and Add widget swaps the body for the gallery with
// a "Back to preview" link. An empty draft opens straight on the gallery, so Build is never blank.
// An added widget lands in the next free slot, outlined briefly.
function BuildPane({
  state,
  subjectIds,
  gallery,
  setGallery,
  onRemove,
}: {
  state: SessionState;
  subjectIds: string[];
  gallery: boolean;
  setGallery: (open: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const { draft } = state;
  const grid = useDraftGrid(state, onRemove);
  const [added, setAdded] = useState<string | null>(null);
  const [lastSubject, setLastSubject] = useState<string | null>(null);
  const empty = draft.widgets.length === 0;

  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [added]);

  if (gallery || empty) {
    return (
      <>
        <div className="nd-gbar">
          {!empty && (
            <button type="button" className="link nd-back" onClick={() => setGallery(false)}>
              <ChevronLeftIcon />
              Back to preview
            </button>
          )}
          <span className="nd-meta">
            {empty ? "Pick a subject and add a widget to start." : "Adding a widget places it in the next free slot."}
          </span>
        </div>
        <div className="nd-gallery">
          <Gallery
            initialSubjectId={lastSubject ?? subjectIds[0] ?? null}
            onAdd={(widget, subjectId) => {
              draft.edit([...draft.widgets, widget]);
              setAdded(widget.id);
              setLastSubject(subjectId);
              setGallery(false);
            }}
          />
        </div>
      </>
    );
  }

  return (
    <div className="nd-canvas">
      <div className="nd-canvas-head">
        <b>Preview</b>
        <span className="nd-meta">Drag to reorder. Click a widget for settings.</span>
        <button type="button" className="btn btn-sm" onClick={() => setGallery(true)}>
          <PlusIcon size={14} />
          Add widget
        </button>
      </div>
      <WidgetGrid
        widgets={draft.widgets}
        dashboardSubjectIds={subjectIds}
        editing
        highlight={added ? [added] : []}
        {...grid}
      />
    </div>
  );
}

// Generate: a floating prompt, centered with a heading and examples until the first send, then
// slid to the bottom where it keeps floating over the generated dashboard.
function GeneratePane({
  state,
  subjectIds,
  onRemove,
}: {
  state: SessionState;
  subjectIds: string[];
  onRemove: (id: string) => void;
}) {
  const { draft } = state;
  const grid = useDraftGrid(state, onRemove);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const slideFrom = useRef<number | null>(null);
  const active = draft.prompts > 0 || draft.widgets.length > 0;

  useEffect(() => input.current?.focus(), []);

  // The one transition: the prompt moves from the centre to its place at the bottom.
  useLayoutEffect(() => {
    const el = form.current;
    const from = slideFrom.current;
    slideFrom.current = null;
    if (!el || from === null || reducedMotion()) return;
    const dy = from - el.getBoundingClientRect().top;
    if (!dy) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 240ms ease-out";
    el.style.transform = "";
  }, [active]);

  const send = (prompt: string) => {
    const clean = prompt.trim();
    if (!clean || draft.running) return;
    if (!active) slideFrom.current = form.current?.getBoundingClientRect().top ?? null;
    setText("");
    state.send(clean);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const { summary, note, changes } = readReply(draft.reply || (draft.running ? "Working on your dashboard" : ""));
  // Outline only small edits to an existing draft; a first build or a big change is listed instead.
  const outline = state.before > 0 && draft.changed.size <= OUTLINE_MAX ? [...draft.changed] : [];

  return (
    <div className={`nd-gen${active ? " active" : ""}`}>
      {!active && <h3 className="nd-gen-title">What do you want to track?</h3>}
      {active && (
        <>
          <div className="nd-thread" aria-live="polite">
            {state.lastPrompt && <p className="nd-you">{state.lastPrompt}</p>}
            {draft.error ? (
              <p className="nd-error">Could not generate: {draft.error}</p>
            ) : changes.length ? (
              <details key={draft.prompts}>
                <summary>
                  <b>{summary}</b> <span className="link">Details</span>
                </summary>
                {note && <p className="nd-note">{note}</p>}
                <ul>
                  {changes.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <p>
                <b>{summary}</b>
              </p>
            )}
          </div>
          <div className="nd-canvas nd-gen-scroll" inert={draft.running}>
            <WidgetGrid
              widgets={draft.widgets}
              dashboardSubjectIds={subjectIds}
              editing={!draft.running}
              highlight={outline}
              {...grid}
            />
          </div>
        </>
      )}
      <form className="nd-prompt" ref={form} onSubmit={onSubmit}>
        <input
          ref={input}
          aria-label="Describe your dashboard"
          placeholder={
            active
              ? "Ask for a change, for example add a watchlist of Singapore banks"
              : "Describe a dashboard, for example stablecoin risk for Singapore banks"
          }
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="nd-send" aria-label="Send" disabled={!text.trim() || draft.running}>
          <SendIcon />
        </button>
      </form>
      {!active && (
        <div className="nd-examples">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="btn btn-sm" onClick={() => send(example)}>
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
