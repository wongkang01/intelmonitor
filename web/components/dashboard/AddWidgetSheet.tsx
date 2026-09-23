"use client";

// Add widget gallery sheet, like the iPadOS widget gallery with subjects in place of apps.
// Left: subjects with search and new-development counts. Right: the widgets that fit the subject,
// each a live preview of real data with a size picker and Add; the first two are Suggested.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Schema, Widget } from "@/lib/api/client";
import { useAnswers, useCatalog, useSubject, useSubjects } from "@/lib/api/queries";
import { TYPE_COLOR, TYPE_LABEL, TYPE_PLURAL } from "@/lib/format";
import {
  draftWidget,
  newWidgetId,
  OFFERS,
  SIZE_LABEL,
  SIZES,
  type DraftContext,
  type Size,
  type SubjectType,
  type WidgetType,
} from "@/lib/widgets";
import { SearchIcon } from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { WidgetCard } from "@/components/widgets/WidgetCard";

const TYPES: SubjectType[] = ["topic", "group", "entity"];
/** Previews lay out at this width, two grid columns, then scale to fit their card. */
const PREVIEW_WIDTH = 440;

export function AddWidgetSheet({
  open,
  onClose,
  onAdd,
  initialSubjectId,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (widget: Widget) => void;
  initialSubjectId: string | null;
}) {
  return (
    <Modal open={open} onClose={onClose} label="Add widget" className="sheet">
      <Gallery onClose={onClose} onAdd={onAdd} initialSubjectId={initialSubjectId} />
    </Modal>
  );
}

/** The gallery itself, also shown over the New dashboard Build preview. */
export function Gallery({
  onClose,
  onAdd,
  initialSubjectId,
}: {
  onClose: () => void;
  /** Gets the new widget and the subject it was added from. */
  onAdd: (widget: Widget, subjectId: string) => void;
  initialSubjectId: string | null;
}) {
  const subjects = useSubjects();
  const [selected, setSelected] = useState(initialSubjectId);
  const [query, setQuery] = useState("");
  const subject = subjects.data?.find((s) => s.id === selected) ?? subjects.data?.[0];

  const needle = query.trim().toLowerCase();
  const matches = (subjects.data ?? []).filter(
    (s) => !needle || [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(needle)),
  );

  return (
    <div className="gsheet-body">
      <div className="subjects">
        <label className="search">
          <SearchIcon />
          <input
            aria-label="Filter subjects"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </label>
        <div className="list">
          {TYPES.map((type) => {
            const list = matches.filter((s) => s.type === type);
            if (!list.length) return null;
            return (
              <div key={type} role="group" aria-label={TYPE_PLURAL[type]}>
                <div className="groupname">{TYPE_PLURAL[type]}</div>
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="subj"
                    aria-current={s.id === subject?.id}
                    onClick={() => setSelected(s.id)}
                  >
                    <span className="dot" style={{ background: TYPE_COLOR[s.type] }} />
                    <span>{s.name}</span>
                    {s.new_developments > 0 && <span className="meta">{s.new_developments} new</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {subjects.data && matches.length === 0 && <p className="muted">No subject matches.</p>}
        </div>
      </div>
      <div className="gallery">
        <div className="gallery-head">
          <h3>{subject?.name}</h3>
          {subject && <span className={`tag ${subject.type}`}>{TYPE_LABEL[subject.type]}</span>}
          <span style={{ marginLeft: "auto" }}>
            <CloseButton onClick={onClose} label="Close gallery" />
          </span>
        </div>
        {subject && <Offers key={subject.id} subject={subject} onAdd={onAdd} />}
      </div>
    </div>
  );
}

function Offers({
  subject,
  onAdd,
}: {
  subject: Schema<"SubjectSummary">;
  onAdd: (widget: Widget, subjectId: string) => void;
}) {
  const catalog = useCatalog();
  const detail = useSubject(subject.id);
  const answers = useAnswers(subject.id);
  const [sizes, setSizes] = useState<Partial<Record<WidgetType, Size>>>({});

  // Standing question widgets start on the subject's most pressing question.
  const question = answers.data?.find((a) => a.state !== "stable") ?? answers.data?.[0];
  const context: DraftContext = {
    questionId: question?.question_id ?? null,
    entityIds:
      subject.type === "entity" ? [subject.id] : (detail.data?.links.entities.map((e) => e.id) ?? []),
  };
  const offers = OFFERS[subject.type].filter(([type]) =>
    catalog.data?.find((t) => t.type === type)?.fits.includes(subject.type),
  );

  return (
    <div className="gcards">
      {offers.map(([type, defaultSize], i) => {
        const info = catalog.data?.find((t) => t.type === type);
        const size = sizes[type] ?? defaultSize;
        const draft = draftWidget(type, subject.id, size, context);
        const allowed: Size[] = SIZES[type];
        return (
          <section key={type} className="gcard" aria-label={info?.name}>
            <div className="gcard-top">
              <span>{info?.name}</span>
              {i < 2 && <span className="tag sugg">Suggested</span>}
            </div>
            <div className="gcard-top desc">{info?.description}</div>
            <div className="gprev">
              <Fit>
                <div className="grid">
                  {draft && <WidgetCard widget={draft} dashboardSubjectIds={[]} variant="preview" />}
                </div>
              </Fit>
            </div>
            <div className="gcard-bottom">
              <div className="seg small" role="group" aria-label={`${info?.name} size`}>
                {allowed.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={size === s}
                    onClick={() => setSizes((prev) => ({ ...prev, [type]: s }))}
                  >
                    {SIZE_LABEL[s]}
                  </button>
                ))}
              </div>
              <span className="grow" />
              <button
                type="button"
                className="btn primary sm"
                disabled={!draft}
                aria-label={`Add ${info?.name ?? "widget"}`}
                onClick={() => draft && onAdd({ ...draft, id: newWidgetId() }, subject.id)}
              >
                Add
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Lays its content out at PREVIEW_WIDTH and scales it down to the available width. */
function Fit({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    const outer = wrap.current;
    const content = inner.current;
    if (!outer || !content) return;
    const measure = () => {
      const scale = Math.min(1, outer.clientWidth / PREVIEW_WIDTH);
      setBox({ scale, height: content.offsetHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fit" ref={wrap} style={{ height: box.height || undefined }}>
      <div
        className="scaler"
        ref={inner}
        style={{ width: PREVIEW_WIDTH, transform: box.scale < 1 ? `scale(${box.scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
