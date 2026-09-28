"use client";

// Add widget gallery sheet, like the iPadOS widget gallery with subjects in place of apps.
// Left: subjects with search and new-development counts. Right: the widgets that fit the subject,
// each a live preview of real data at dashboard size with a size picker and Add; the first two are
// grouped under Suggested, the rest under More widgets.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Schema, Widget } from "@/lib/api/client";
import { useAnswers, useCatalog, useIndicators, useSubject, useSubjects } from "@/lib/api/queries";
import { plural, TYPE_LABEL, TYPE_PLURAL } from "@/lib/format";
import {
  defaultSeriesId,
  draftWidget,
  indicatorOffer,
  newWidgetId,
  OFFERS,
  SIZE_LABEL,
  SIZES,
  type DraftContext,
  type Size,
  type SubjectType,
  type WidgetType,
} from "@/lib/widgets";
import { CustomQuestionComposer } from "@/components/custom/CustomQuestion";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { WidgetCard } from "@/components/widgets/WidgetCard";
import { SeriesSelect } from "@/components/widgets/parts";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

const TYPES: SubjectType[] = ["topic", "group", "entity"];
/** Previews render at dashboard size (one grid column, 176px rows) and scale down only if the sheet is narrow. */
const PREVIEW = { S: { width: 264, height: 176 }, M: { width: 544, height: 176 }, L: { width: 544, height: 368 } } as const;
const SUGGESTED = 2;

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
    <Modal open={open} onClose={onClose} labelledBy="add-widget-title" className="sheet">
      <div className="sheet-head">
        <h2 id="add-widget-title">Add widget</h2>
        <CloseButton onClick={onClose} />
      </div>
      <Gallery onAdd={onAdd} initialSubjectId={initialSubjectId} />
    </Modal>
  );
}

/**
 * The gallery itself, also shown in the New dashboard Build tab. Pass `onClose` only where the host
 * has no close of its own; it adds a close button to the gallery head.
 */
export function Gallery({
  onClose,
  onAdd,
  initialSubjectId,
}: {
  onClose?: () => void;
  /** Gets the new widget and the subject it was added from. */
  onAdd: (widget: Widget, subjectId: string) => void;
  initialSubjectId: string | null;
}) {
  const subjects = useSubjects();
  const [selected, setSelected] = useState(initialSubjectId);
  const [query, setQuery] = useState("");
  const subject = subjects.data?.find((s) => s.id === selected) ?? subjects.data?.[0];
  const filter = useRef<HTMLInputElement>(null);
  // Focus the filter on open, unless the keyboard is on the New dashboard tabs.
  useEffect(() => {
    if (!document.activeElement?.matches('[role="tab"]:focus-visible')) filter.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (subjects.data ?? []).filter(
    (s) => !needle || [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(needle)),
  );

  return (
    <div className="gsheet-body">
      <div className="subjects">
        <label className="field subj-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Filter subjects"
            placeholder="Search subjects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            ref={filter}
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
                    <SubjectIcon subject={s} />
                    <span className="subj-name">{s.name}</span>
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
          <h3>
            {subject && <SubjectIcon subject={subject} size={20} />}
            {subject?.name}
          </h3>
          {subject && (
            <span className="meta">
              {[
                TYPE_LABEL[subject.type],
                subject.new_developments > 0 && `${subject.new_developments} new`,
                subject.needs_attention > 0 && `${plural(subject.needs_attention, "needs", "need")} attention`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          {onClose && (
            <span className="push">
              <CloseButton onClick={onClose} label="Close gallery" />
            </span>
          )}
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
  const indicators = useIndicators(subject.id);
  const [sizes, setSizes] = useState<Partial<Record<WidgetType, Size>>>({});
  const [seriesId, setSeriesId] = useState<string | null>(null);

  // Standing question widgets start on the subject's most pressing question, indicators on its
  // primary series.
  const question = answers.data?.find((a) => a.state !== "stable") ?? answers.data?.[0];
  const listed = indicators.data?.indicators.filter((i) => i.series.listed) ?? [];
  const context: DraftContext = {
    questionId: question?.question_id ?? null,
    entityIds:
      subject.type === "entity" ? [subject.id] : (detail.data?.links.entities.map((e) => e.id) ?? []),
    seriesId: seriesId ?? defaultSeriesId(listed),
  };
  const offers = OFFERS[subject.type].filter(([type]) =>
    catalog.data?.find((t) => t.type === type)?.fits.includes(subject.type),
  );
  const indicator: [WidgetType, Size] = ["indicator", "S"];
  const place = indicatorOffer(listed);
  const suggested = [...(place === "suggested" ? [indicator] : []), ...offers.slice(0, SUGGESTED)];
  const more = [...offers.slice(SUGGESTED), ...(place === "more" ? [indicator] : [])];

  const offer = ([type, defaultSize]: [WidgetType, Size]) => {
    const info = catalog.data?.find((t) => t.type === type);
    const size = sizes[type] ?? defaultSize;
    const draft = draftWidget(type, subject.id, size, context);
    const allowed: Size[] = SIZES[type];
    return (
      <section key={type} className="offer" aria-label={info?.name}>
        <div className="offer-side">
          <h4>{info?.name}</h4>
          {type === "indicator" && (
            <SeriesSelect listed={listed} value={context.seriesId ?? ""} onChange={setSeriesId} />
          )}
          <div className="seg" role="group" aria-label={`${info?.name} size`}>
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
          <button
            type="button"
            className="btn btn-sm"
            disabled={!draft}
            aria-label={`Add ${info?.name ?? "widget"}`}
            onClick={() => draft && onAdd({ ...draft, id: newWidgetId() }, subject.id)}
          >
            <PlusIcon size={14} />
            Add
          </button>
        </div>
        <Fit size={draft?.size ?? size}>
          {draft && <WidgetCard widget={draft} dashboardSubjectIds={[]} variant="preview" />}
        </Fit>
      </section>
    );
  };

  return (
    <div className="offers">
      <p className="og">Suggested</p>
      {suggested.map(offer)}
      <p className="og">More widgets</p>
      {more.map(offer)}
      <CustomOffer subject={subject} onAdd={onAdd} />
    </div>
  );
}

/** "Custom question": the user writes a question, previews it, and Keep adds its widget. */
function CustomOffer({
  subject,
  onAdd,
}: {
  subject: Schema<"SubjectSummary">;
  onAdd: (widget: Widget, subjectId: string) => void;
}) {
  const [size, setSize] = useState<(typeof SIZES.question)[number]>("S");
  return (
    <section className="offer" aria-label="Custom question">
      <div className="offer-side">
        <h4>Custom question</h4>
        <div className="seg" role="group" aria-label="Custom question size">
          {SIZES.question.map((s) => (
            <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="offer-custom">
        <p className="meta">Your own standing question about {subject.name}, answered for every run</p>
        <CustomQuestionComposer
        subject={subject}
        linkCitations={false}
        onKept={(q) =>
          onAdd(
            {
              id: newWidgetId(),
              order: 0,
              type: "question",
              size,
              settings: { subject_id: q.subject.id, question_id: q.id },
            },
            subject.id,
          )
        }
        />
      </div>
    </section>
  );
}

/** Shows a preview at its dashboard size, scaled down only when the gallery is narrower. */
function Fit({ size, children }: { size: Size; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { width, height } = PREVIEW[size];
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = wrap.current;
    if (!outer) return;
    const measure = () => setScale(Math.min(1, outer.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div className="fit" ref={wrap} style={{ maxWidth: width, height: height * scale }}>
      <div
        className="scaler"
        style={{ width, height, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
