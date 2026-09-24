// Pieces shared by widget bodies, monitor pages and the evidence drawer: the widget header, state
// badges and state words, and development rows in the shared list-row grammar (globals.css `.row`).
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { plural, shortDate, STATE_LABEL, STATE_TONE, type State } from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { Dotted } from "@/components/monitor/parts";

/** Widget header: 12px grey title top-left, optional link target, meta on the right. */
export function Head({
  title,
  href,
  meta,
  children,
}: {
  title: string;
  href?: string | null;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="wh">
      {href ? (
        <Link href={href} className="wt">
          {title}
        </Link>
      ) : (
        <span className="wt">{title}</span>
      )}
      {children}
      {meta !== undefined && <span className="wm">{meta}</span>}
    </div>
  );
}

const stateLabel = (state: State, newCount = 0) =>
  state === "new" && newCount > 0 ? `${newCount} new` : STATE_LABEL[state];

/** A state as a badge; Stable is green text without a fill. */
export function StateBadge({ state, newCount = 0 }: { state: State; newCount?: number }) {
  return <span className={`badge b-${STATE_TONE[state]}`}>{stateLabel(state, newCount)}</span>;
}

/** "Watch → Needs attention" when the state changed since the previous run, else the state. */
export function stateText(answer: Schema<"QuestionAnswerView">): string {
  const now = stateLabel(answer.state, answer.new_count);
  const before = answer.change.previous_state;
  return answer.change.kind === "state_changed" && before ? `${STATE_LABEL[before]} → ${now}` : now;
}

/** The same words as `stateText`, each state in its status color and the arrow in grey. */
export function StateWords({ answer }: { answer: Schema<"QuestionAnswerView"> }) {
  const before = answer.change.kind === "state_changed" ? answer.change.previous_state : null;
  return (
    <>
      {before && (
        <>
          <span className={`c-${STATE_TONE[before]}`}>{STATE_LABEL[before]}</span>
          <span className="arrow"> → </span>
        </>
      )}
      <span className={`c-${STATE_TONE[answer.state]}`}>{stateLabel(answer.state, answer.new_count)}</span>
    </>
  );
}

export function DevelopmentBadge({ development: d }: { development: Schema<"DevelopmentSummary"> }) {
  if (d.needs_attention) return <span className="badge b-attn">Needs attention</span>;
  if (d.change === "new") return <span className="badge b-new">New</span>;
  if (d.change === "updated") return <span className="badge b-neutral">Updated</span>;
  return null;
}

/**
 * A development as a list row that opens its evidence: status column, title (two lines at most),
 * a meta line, and the date right-aligned. Subject names link to their pages; pass `subjects` to
 * name others (a group's members) than the development's first two. Widgets pass `meta={false}`
 * for the compact row, and `status={false}` when a group label above the rows carries the status.
 * `link={false}` renders a plain row, for dialogs that would cover the evidence drawer.
 */
export function DevelopmentRow({
  development: d,
  subjects,
  meta = true,
  status = true,
  link = true,
  lines = 2,
}: {
  development: Schema<"DevelopmentSummary">;
  subjects?: Schema<"SubjectRef">[];
  meta?: boolean;
  status?: boolean;
  link?: boolean;
  /** Title lines before it truncates. */
  lines?: 1 | 2;
}) {
  const evidence = useEvidenceHref();
  // Unlinked rows sit in dialogs, where subject links would leave the dialog.
  const named = link ? (subjects ?? d.subjects.slice(0, 2)) : [];
  const more = link && !subjects ? d.subjects.length - named.length : 0;
  return (
    <div className={`row dev${status ? "" : " no-stat"}`}>
      {status && (
        <span className="stat">
          <DevelopmentBadge development={d} />
        </span>
      )}
      <span>
        <span className={`row-title${lines === 1 ? " one" : ""}`} title={lines === 1 ? d.title : undefined}>
          {link ? (
            <Link href={evidence.development(d.id)} className="stretch" scroll={false}>
              {d.title}
            </Link>
          ) : (
            d.title
          )}
        </span>
        {meta && (
          <span className="row-meta">
            <Dotted
              parts={[
                named.length > 0 && (
                  <Fragment key="s">
                    <SubjectLinks subjects={named} />
                    {more > 0 && ` +${more}`}
                  </Fragment>
                ),
                d.category,
                plural(d.source_count, "source"),
              ]}
            />
          </span>
        )}
      </span>
      <span className="row-end">{shortDate(d.last_published)}</span>
    </div>
  );
}
