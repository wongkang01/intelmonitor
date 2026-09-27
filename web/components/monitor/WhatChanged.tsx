"use client";

// What changed since the last review, on monitor pages and a dashboard's developments page. Rows
// carry read, flag and dismiss actions that replace the date while the pointer is over the row or
// focus is in it; a segmented control filters them. After Mark reviewed the list folds away behind
// a disclosure of the run's changes, which keeps the triage controls.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
type Triage = Partial<Pick<Changed, "read" | "flagged" | "dismissed">>;

type FilterId = "all" | "unread" | "flagged" | "dismissed";

/** All hides dismissed developments; Dismissed lists only them. */
const FILTERS: { id: FilterId; label: string; test: (d: Changed) => boolean }[] = [
  { id: "all", label: "All", test: (d) => !d.dismissed },
  { id: "unread", label: "Unread", test: (d) => !d.read && !d.dismissed },
  { id: "flagged", label: "Flagged", test: (d) => d.flagged && !d.dismissed },
  { id: "dismissed", label: "Dismissed", test: (d) => d.dismissed },
];

const EMPTY: Record<FilterId, string> = {
  all: "Every development here is dismissed.",
  unread: "Nothing unread.",
  flagged: "Nothing flagged.",
  dismissed: "Nothing dismissed.",
};

const FIRST_ROWS = 6;

/** Whether anything changed since the scope's review: what Mark reviewed would clear. */
export const hasUnreviewed = (wc: WhatChangedData) =>
  wc.developments.some((d) => d.unreviewed) || wc.question_changes.some((c) => c.unreviewed);

/**
 * The What changed section. `subjectId` is the page's own subject, whose name answer changes leave
 * out.
 */
export function WhatChanged({ wc, subjectId }: { wc: WhatChangedData; subjectId?: string }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [all, setAll] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const evidence = useEvidenceHref();
  const setTriage = useSetTriage();
  const list = useRef<HTMLDivElement>(null);
  const seg = useRef<HTMLDivElement>(null);
  // A row that an action took out of the filter: focus moves to the same action on the row after.
  const refocus = useRef<{ id: string; index: number; action: number } | null>(null);

  const unreviewed = hasUnreviewed(wc);
  // Once reviewed, the run's changes stay behind the disclosure.
  const folded = !unreviewed && wc.reviewed_at !== null;
  const developments = folded ? wc.developments : wc.developments.filter((d) => d.unreviewed);
  const questions = folded ? wc.question_changes : wc.question_changes.filter((c) => c.unreviewed);
  const open = !folded || earlier;
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const filtered = developments.filter(active.test);
  const shown = all ? filtered : filtered.slice(0, FIRST_ROWS);

  useEffect(() => {
    const target = refocus.current;
    // The cache updates a moment after the click; wait until the row has left.
    if (!target || filtered.some((d) => d.id === target.id)) return;
    refocus.current = null;
    const rows = list.current?.querySelectorAll<HTMLElement>(".row.triage");
    const row = rows?.[Math.min(target.index, rows.length - 1)];
    if (!row) {
      seg.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      return;
    }
    // The actions show once focus is in the row, so focus its title first.
    row.querySelector<HTMLElement>("a.stretch")?.focus();
    row.querySelectorAll<HTMLButtonElement>(".triage-acts button")[target.action]?.focus();
  });

  const act = (d: Changed, index: number, action: number, change: Triage) => {
    if (!active.test({ ...d, ...change })) refocus.current = { id: d.id, index, action };
    setTriage.mutate({ id: d.id, change });
  };

  const lead = folded
    ? "Nothing new since your review"
    : changeCounts(wc) || (developments.length > 0 ? "Nothing unread" : "Nothing new or updated");
  const runParts = [
    plural(developments.filter(FILTERS[0].test).length, "development"),
    questions.length > 0 && `${plural(questions.length, "answer")} changed`,
  ];

  return (
    <Section
      id="what-changed"
      title="What changed since last review"
      meta={folded && wc.reviewed_at ? `Reviewed ${whenAt(wc.reviewed_at)}` : runMeta(wc.run)}
    >
      <div className="lead-row">
        <p className="mon-lead">{lead}</p>
        {open && developments.length > 0 && (
          <div className="seg" role="group" aria-label="Filter developments" ref={seg}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === filter}
                onClick={() => {
                  setFilter(f.id);
                  setAll(false);
                }}
              >
                {f.label}
                <span className="seg-n">{developments.filter(f.test).length}</span>
              </button>
            ))}
          </div>
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
            <p className="mon-empty">{EMPTY[filter]}</p>
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
      {open && filter === "all" && questions.length > 0 && (
        <>
          <h3 className="mon-sub">{plural(questions.length, "answer")} changed</h3>
          <div className="rows">
            {questions.map((c) => (
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
      )}
    </Section>
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
      end={
        <span className="row-end triage-end">
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
      }
    />
  );
}
