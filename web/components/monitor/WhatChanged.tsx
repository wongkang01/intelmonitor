"use client";

// What changed since the last review, on monitor pages. Rows carry read, flag and dismiss actions
// that replace the date while the pointer is over the row or focus is in it; a segmented control
// filters them. After Mark reviewed the list folds away behind a disclosure of the run's changes,
// which keeps the triage controls. A dashboard's developments list reuses the triage pieces.
import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";

import type { Schema } from "@/lib/api/client";
import { useSetTriage } from "@/lib/api/queries";
import { answerText, changeCounts, plural, runMeta, shortDate, whenAt } from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { ChevronIcon, DismissIcon, FlagIcon, ReadIcon, UnreadIcon } from "@/components/ui/icons";
import { DevelopmentRow, StateBadge } from "@/components/widgets/parts";

import { Dotted, Section, StateChange } from "./parts";

type WhatChangedData = Schema<"WhatChanged">;
type Changed = Schema<"ChangedDevelopment">;
/** One triage action: the states it sets. */
export type Triage = Partial<Pick<Changed, "read" | "flagged" | "dismissed">>;

export type TriageFilterId = "all" | "unread" | "flagged" | "dismissed";
export type TriageFilter = { id: TriageFilterId; label: string; test: (d: Changed) => boolean };

/** All hides dismissed developments; Dismissed lists only them. */
export const TRIAGE_FILTERS: TriageFilter[] = [
  { id: "all", label: "All", test: (d) => !d.dismissed },
  { id: "unread", label: "Unread", test: (d) => !d.read && !d.dismissed },
  { id: "flagged", label: "Flagged", test: (d) => d.flagged && !d.dismissed },
  { id: "dismissed", label: "Dismissed", test: (d) => d.dismissed },
];

export const TRIAGE_EMPTY: Record<TriageFilterId, string> = {
  all: "Every development here is dismissed.",
  unread: "Nothing unread.",
  flagged: "Nothing flagged.",
  dismissed: "Nothing dismissed.",
};

const FIRST_ROWS = 6;

/** Whether anything changed since the scope's review: what Mark reviewed would clear. */
export const hasUnreviewed = (wc: WhatChangedData) =>
  wc.developments.some((d) => d.unreviewed) || wc.question_changes.some((c) => c.unreviewed);

/** Whether the scope was reviewed with nothing changed since: its run's changes fold away. */
export const isFolded = (wc: WhatChangedData) => !hasUnreviewed(wc) && wc.reviewed_at !== null;

/** "Nothing new since your review" once folded, else the counts. `listed` is how many rows show. */
export const whatChangedLead = (counts: Parameters<typeof changeCounts>[0], folded: boolean, listed: number) =>
  folded ? "Nothing new since your review" : changeCounts(counts) || (listed > 0 ? "Nothing unread" : "Nothing new or updated");

/**
 * Triage for rows in `list` (elements with the `triage` class): `act` applies an action, and when it
 * takes a row out of `filter`, focus moves to the same action on the row after, or to the filter's
 * pressed button in `seg` when none is left. `filtered` is what the rows show.
 */
export function useTriage<List extends HTMLElement>(filter: TriageFilter, filtered: Changed[]) {
  const setTriage = useSetTriage();
  const list = useRef<List>(null);
  const seg = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: string; index: number; action: number } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    // The cache updates a moment after the click; wait until the row has left.
    if (!target || filtered.some((d) => d.id === target.id)) return;
    refocus.current = null;
    const rows = list.current?.querySelectorAll<HTMLElement>(".triage");
    const row = rows?.[Math.min(target.index, rows.length - 1)];
    if (!row) {
      seg.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      return;
    }
    // The actions show once focus is in the row, so focus its title first.
    row.querySelector<HTMLElement>("a")?.focus();
    row.querySelectorAll<HTMLButtonElement>(".triage-acts button")[target.action]?.focus();
  });

  const act = (d: Changed, index: number, action: number, change: Triage) => {
    if (!filter.test({ ...d, ...change })) refocus.current = { id: d.id, index, action };
    setTriage.mutate({ id: d.id, change });
  };
  return { list, seg, act };
}

/** The triage filter, each option with its count among `developments`. */
export function TriageFilters({
  developments,
  filter,
  onChange,
  segRef,
}: {
  developments: Changed[];
  filter: TriageFilterId;
  onChange: (id: TriageFilterId) => void;
  segRef: Ref<HTMLDivElement>;
}) {
  return (
    <div className="seg" role="group" aria-label="Filter developments" ref={segRef}>
      {TRIAGE_FILTERS.map((f) => (
        <button key={f.id} type="button" aria-pressed={f.id === filter} onClick={() => onChange(f.id)}>
          {f.label}
          <span className="seg-n">{developments.filter(f.test).length}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The What changed section. `subjectId` is the page's own subject, whose name answer changes leave
 * out.
 */
export function WhatChanged({ wc, subjectId }: { wc: WhatChangedData; subjectId?: string }) {
  const [filter, setFilter] = useState<TriageFilterId>("all");
  const [all, setAll] = useState(false);
  const [earlier, setEarlier] = useState(false);

  // Once reviewed, the run's changes stay behind the disclosure.
  const folded = isFolded(wc);
  const developments = folded ? wc.developments : wc.developments.filter((d) => d.unreviewed);
  const questions = folded ? wc.question_changes : wc.question_changes.filter((c) => c.unreviewed);
  const open = !folded || earlier;
  const active = TRIAGE_FILTERS.find((f) => f.id === filter) ?? TRIAGE_FILTERS[0];
  const filtered = developments.filter(active.test);
  const shown = all ? filtered : filtered.slice(0, FIRST_ROWS);
  const { list, seg, act } = useTriage<HTMLDivElement>(active, filtered);

  const runParts = [
    plural(developments.filter(TRIAGE_FILTERS[0].test).length, "development"),
    questions.length > 0 && `${plural(questions.length, "answer")} changed`,
  ];

  return (
    <Section
      id="what-changed"
      title="What changed since last review"
      meta={folded && wc.reviewed_at ? `Reviewed ${whenAt(wc.reviewed_at)}` : runMeta(wc.run)}
    >
      <div className="lead-row">
        <p className="mon-lead">{whatChangedLead(wc, folded, developments.length)}</p>
        {open && developments.length > 0 && (
          <TriageFilters
            developments={developments}
            filter={filter}
            segRef={seg}
            onChange={(id) => {
              setFilter(id);
              setAll(false);
            }}
          />
        )}
      </div>
      {folded && (developments.length > 0 || questions.length > 0) && (
        <button type="button" className="earlier" aria-expanded={earlier} onClick={() => setEarlier((e) => !e)}>
          <ChevronIcon />
          <Dotted parts={[`Run of ${shortDate(wc.run.as_of)}`, runParts.filter(Boolean).join(", ")]} />
        </button>
      )}
      {open && developments.length > 0 && (
        <>
          {filtered.length > 0 ? (
            <div className="rows" ref={list}>
              {shown.map((d, i) => (
                <TriageRow key={d.id} development={d} onChange={(action, change) => act(d, i, action, change)} />
              ))}
            </div>
          ) : (
            <p className="mon-empty">{TRIAGE_EMPTY[filter]}</p>
          )}
          {filtered.length > FIRST_ROWS && (
            <p className="mon-more">
              <button type="button" className="link" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                {all ? "Show fewer" : `Show all ${filtered.length}`}
              </button>
            </p>
          )}
        </>
      )}
      {open && filter === "all" && <AnswerChanges changes={questions} subjectId={subjectId} />}
    </Section>
  );
}

/** Answers whose state changed, under a count; nothing when there are none. */
export function AnswerChanges({ changes, subjectId }: { changes: Schema<"QuestionStateChange">[]; subjectId?: string }) {
  const evidence = useEvidenceHref();
  if (changes.length === 0) return null;
  return (
    <>
      <h3 className="mon-sub">{plural(changes.length, "answer")} changed</h3>
      <div className="rows">
        {changes.map((c) => (
          <div key={`${c.subject.id}-${c.question_id}`} className="row qrow">
            <span className="stat">
              <StateBadge state={c.to_state} />
            </span>
            <div className="qbody">
              <div className="qlabel">
                <b>{c.label}</b>
                {c.subject.id !== subjectId && (
                  <span className="meta">
                    <SubjectLink subject={c.subject} />
                  </span>
                )}
              </div>
              <div className="qanswer">
                <p>{answerText(c.summary)}</p>
              </div>
              <p className="meta qmeta">
                <Dotted
                  parts={[
                    <StateChange key="s" state={c.to_state} from={c.from_state} />,
                    c.development_ids.length > 0 ? (
                      <Link key="e" href={evidence.answer(c.subject.id, c.question_id)} scroll={false} className="link">
                        See evidence
                      </Link>
                    ) : (
                      "No sources"
                    ),
                  ]}
                />
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * A development row whose date gives way to Mark read, Flag and Dismiss while the pointer is over
 * the row or focus is in it; on a touch screen the actions always show. A read row drops its New
 * or Updated badge; Needs attention stays. `onChange` gets the action's index and the change.
 */
function TriageRow({ development: d, onChange }: { development: Changed; onChange: (action: number, change: Triage) => void }) {
  return (
    <DevelopmentRow
      development={d.read ? { ...d, change: null } : d}
      className="triage"
      end={<TriageEnd development={d} onChange={onChange} className="row-end" />}
    />
  );
}

/**
 * A triage row's end: the date, with a flag mark when flagged, which gives way to Mark read, Flag
 * and Dismiss while the pointer is over the row (`.triage`) or focus is in it.
 */
export function TriageEnd({
  development: d,
  onChange,
  className,
}: {
  development: Changed;
  onChange: (action: number, change: Triage) => void;
  className?: string;
}) {
  return (
    <span className={[className, "triage-end"].filter(Boolean).join(" ")}>
      <span className="triage-date">
        {d.flagged && (
          <span className="flag-mark" role="img" aria-label="Flagged">
            <FlagIcon size={12} />
          </span>
        )}
        {shortDate(d.last_published)}
      </span>
      <span className="triage-acts">
        <button
          type="button"
          className="btn-icon"
          aria-label={d.read ? "Mark unread" : "Mark read"}
          title={d.read ? "Mark unread" : "Mark read"}
          onClick={() => onChange(0, { read: !d.read })}
        >
          {d.read ? <UnreadIcon /> : <ReadIcon />}
        </button>
        <button type="button" className="btn-icon" aria-pressed={d.flagged} aria-label="Flag" title="Flag" onClick={() => onChange(1, { flagged: !d.flagged })}>
          <FlagIcon filled={d.flagged} />
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-pressed={d.dismissed}
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => onChange(2, { dismissed: !d.dismissed })}
        >
          <DismissIcon />
        </button>
      </span>
    </span>
  );
}
