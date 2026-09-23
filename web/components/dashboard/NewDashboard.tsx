"use client";

// The New dashboard popup: about 80% of the screen, Build and Generate tabs, Esc or a backdrop
// click closes it. Both tabs edit one draft (lib/agent.ts), so users can switch at any time, and
// both create the same dashboard spec, which then appears in the sidebar and opens.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { Widget } from "@/lib/api/client";
import { errorMessage, useCreateDashboard, useSubjects } from "@/lib/api/queries";
import { useDashboardDraft, type DashboardDraft } from "@/lib/agent";
import { defaultName, subjectsUsed } from "@/lib/widgets";
import { PlusIcon, SendIcon, SparkleIcon } from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";
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

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function NewDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Esc goes to the popup body first, which closes the gallery sheet before the popup.
  const escapeRef = useRef<() => boolean>(() => false);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!escapeRef.current()) onClose();
      }}
      labelledBy="new-dashboard-title"
      className="sheet"
    >
      <NewDashboardBody onClose={onClose} escapeRef={escapeRef} />
    </Modal>
  );
}

function NewDashboardBody({
  onClose,
  escapeRef,
}: {
  onClose: () => void;
  escapeRef: React.RefObject<() => boolean>;
}) {
  const router = useRouter();
  const toast = useToast();
  const subjects = useSubjects();
  const create = useCreateDashboard();
  const draft = useDashboardDraft();
  const [tab, setTab] = useState<Tab>("build");
  const [gallery, setGallery] = useState(false);
  const [typedName, setTypedName] = useState<string | null>(null);

  useEffect(() => {
    escapeRef.current = () => {
      if (!gallery) return false;
      setGallery(false);
      return true;
    };
  }, [escapeRef, gallery]);

  const subjectIds = subjectsUsed(draft.widgets);
  const names = subjectIds.flatMap((id) => subjects.data?.find((s) => s.id === id)?.name ?? []);
  const name = typedName ?? defaultName(names);
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
          router.push(`/dashboards/${created.id}`);
          toast({ message: `Created ${created.name}` });
        },
        onError: (e) => toast({ message: errorMessage(e, "Could not create the dashboard") }),
      },
    );
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next: Tab = tab === "build" ? "generate" : "build";
    setTab(next);
    document.getElementById(`new-dashboard-tab-${next}`)?.focus();
  };

  return (
    <>
      <div className="sheet-head tabbed">
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
              {t.id === "generate" && <SparkleIcon twin />}
              {t.label}
            </button>
          ))}
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div
        className="sheet-body"
        role="tabpanel"
        id={`new-dashboard-${tab}`}
        aria-labelledby={`new-dashboard-tab-${tab}`}
      >
        {tab === "build" ? (
          <BuildPane
            draft={draft}
            subjectIds={subjectIds}
            gallery={gallery}
            setGallery={setGallery}
            footer={
              <>
                <div className="field">
                  <label htmlFor="new-dashboard-name">Name</label>
                  <input
                    id="new-dashboard-name"
                    value={name}
                    placeholder="Dashboard name"
                    maxLength={80}
                    onChange={(e) => setTypedName(e.target.value)}
                  />
                </div>
                <span className="grow" />
                <span className="hint">
                  {draft.pending
                    ? "Keep or undo the generated change first."
                    : draft.widgets.length
                      ? `${draft.widgets.length} widget${draft.widgets.length > 1 ? "s" : ""}`
                      : ""}
                </span>
                <CreateButton disabled={!canCreate} onClick={submit} />
              </>
            }
          />
        ) : (
          <GeneratePane
            draft={draft}
            subjectIds={subjectIds}
            footer={
              <>
                <span className="hint">
                  {draft.pending
                    ? "Keep or undo the last change first."
                    : draft.widgets.length
                      ? `${name}, ${draft.widgets.length} widget${draft.widgets.length > 1 ? "s" : ""}`
                      : "Nothing is saved until you keep it."}
                </span>
                <span className="grow" />
                <CreateButton disabled={!canCreate} onClick={submit} />
              </>
            }
          />
        )}
      </div>
    </>
  );
}

function CreateButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn primary" disabled={disabled} onClick={onClick}>
      Create dashboard
    </button>
  );
}

/** Grid callbacks that edit the draft by hand. */
function useDraftGrid(draft: DashboardDraft) {
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const byId = () => new Map(draft.widgets.map((w) => [w.id, w]));
  return {
    settingsFor,
    onSettings: setSettingsFor,
    onReorder: (ids: string[]) => {
      const map = byId();
      draft.edit(ids.flatMap((id) => map.get(id) ?? []));
    },
    onRemove: (id: string) => {
      draft.edit(draft.widgets.filter((w) => w.id !== id));
      if (settingsFor === id) setSettingsFor(null);
    },
    onChange: (widget: Widget) => draft.edit(draft.widgets.map((w) => (w.id === widget.id ? widget : w))),
    onLongPress: () => {},
  };
}

// Build, mock variant B: the preview fills the popup in edit mode, and Add widget opens the
// gallery sheet over it. An added widget lands in the next free slot, outlined briefly.
function BuildPane({
  draft,
  subjectIds,
  gallery,
  setGallery,
  footer,
}: {
  draft: DashboardDraft;
  subjectIds: string[];
  gallery: boolean;
  setGallery: (open: boolean) => void;
  footer: React.ReactNode;
}) {
  const grid = useDraftGrid(draft);
  const [added, setAdded] = useState<string | null>(null);
  const [lastSubject, setLastSubject] = useState<string | null>(null);

  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [added]);

  const addButton = (
    <button type="button" className="btn primary sm with-icon" onClick={() => setGallery(true)}>
      <PlusIcon color="#fff" size={12} />
      Add widget
    </button>
  );

  return (
    <>
      <div className="canvas" inert={gallery}>
        <div className="canvas-head">
          <b>Preview</b>
          <span className="hint">
            {draft.widgets.length ? "Drag to rearrange. Tap a widget for its settings." : ""}
          </span>
          {addButton}
        </div>
        <div className="canvas-scroll">
          {draft.widgets.length ? (
            <WidgetGrid
              widgets={draft.widgets}
              dashboardSubjectIds={subjectIds}
              editing
              highlight={added ? [added] : []}
              {...grid}
            />
          ) : (
            <div className="empty">
              <span>Start with a widget.</span>
              <button type="button" className="btn primary" onClick={() => setGallery(true)}>
                Add widget
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="sheet-foot" inert={gallery}>
        {footer}
      </div>
      {gallery && (
        <div
          className="gsheet"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setGallery(false);
          }}
        >
          <div className="gsheet-card" role="dialog" aria-label="Add a widget">
            <Gallery
              initialSubjectId={lastSubject ?? subjectIds[0] ?? null}
              onClose={() => setGallery(false)}
              onAdd={(widget, subjectId) => {
                draft.edit([...draft.widgets, widget]);
                setAdded(widget.id);
                setLastSubject(subjectId);
                setGallery(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// Generate: a centered prompt that slides to the bottom on the first send, with the generated
// dashboard filling the space above it one widget at a time.
function GeneratePane({
  draft,
  subjectIds,
  footer,
}: {
  draft: DashboardDraft;
  subjectIds: string[];
  footer: React.ReactNode;
}) {
  const grid = useDraftGrid(draft);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const slideFrom = useRef<number | null>(null);
  const active = draft.prompts > 0 || draft.widgets.length > 0;

  useEffect(() => input.current?.focus(), []);

  // The one transition: the prompt glides from the centre to its new place at the bottom.
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
    el.style.transition = "transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = "";
  }, [active]);

  const send = (prompt: string) => {
    const clean = prompt.trim();
    if (!clean || draft.running) return;
    if (!active) slideFrom.current = form.current?.getBoundingClientRect().top ?? null;
    setText("");
    void draft.send(clean);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const reply = draft.error ?? (draft.reply || (draft.running ? "Working on your dashboard" : ""));

  return (
    <>
      <div className={`gen${active ? " active" : ""}`}>
        {!active && (
          <div className="gen-intro">
            <span className="ai large">
              <SparkleIcon size={20} />
            </span>
            <h3>What do you want to track?</h3>
          </div>
        )}
        {active && (
          <div className="gen-results">
            {reply && (
              <div className="reply">
                <span className="ai">
                  <SparkleIcon />
                </span>
                <div className={`reply-text${draft.error ? " c-attn" : ""}`} role="status">
                  {reply}
                </div>
                {draft.pending && !draft.running && (
                  <div className="changebar">
                    <button type="button" className="btn" onClick={draft.undo}>
                      Undo
                    </button>
                    <button type="button" className="btn primary" onClick={draft.keep}>
                      Keep
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="gen-scroll" inert={draft.running}>
              <WidgetGrid
                widgets={draft.widgets}
                dashboardSubjectIds={subjectIds}
                editing={!draft.running}
                highlight={[...draft.changed]}
                {...grid}
              />
            </div>
          </div>
        )}
        <form className="prompt" ref={form} onSubmit={onSubmit}>
          <input
            ref={input}
            aria-label="Describe your dashboard"
            placeholder={
              active
                ? "Ask for a change, e.g. remove the watchlist"
                : "Describe a dashboard, e.g. stablecoin risk for SG banks"
            }
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="send" aria-label="Send" disabled={!text.trim() || draft.running}>
            <SendIcon />
          </button>
        </form>
        {!active && (
          <div className="gen-sugg">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sheet-foot">{footer}</div>
    </>
  );
}
