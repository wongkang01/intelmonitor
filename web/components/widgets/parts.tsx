// Pieces shared by widget bodies, monitor pages and the evidence drawer: the widget header, state
// badges and state words, development rows in the shared list-row grammar (globals.css `.row`), and
// the series picker of the gallery and settings.
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { shortDate, STATE_LABEL, STATE_TONE, type State } from "@/lib/format";
import type { WidgetLink } from "@/lib/widgets";
import { evidenceLink } from "@/components/shell/Evidence";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { Dotted } from "@/components/monitor/parts";
import { ChangeMark, PriorityBadge, sourceCountText } from "@/components/developments/labels";

/** Widget header: 12px grey title top-left, optional link target, meta on the right. */
export function Head({
  title,
  link,
  meta,
  children,
}: {
  title: string;
  link?: WidgetLink | null;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="wh">
      {link ? (
        <Link {...link} className="wt">
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

/** A development's priority badge, then New or Updated (prd.md section 12: one label per question). */
export function DevelopmentBadge({ development: d }: { development: Schema<"DevelopmentSummary"> }) {
  return (
    <>
      <PriorityBadge priority={d.priority} />
      <ChangeMark change={d.change} />
    </>
  );
}

/**
 * A development as a list row that opens its popup: status column, title (two lines at most),
 * a meta line, and the date right-aligned. Subject names link to their pages; pass `subjects` to
 * name others (a group's members) than the development's first two. Widgets pass `meta={false}`
 * for the compact row, and `status={false}` when a group label above the rows carries the status.
 * `link={false}` renders a plain row, for dialogs that would cover the evidence drawer. `end` replaces
 * the date column, and `className` adds to the row's classes (What changed's triage rows).
 */
export function DevelopmentRow({
  development: d,
  subjects,
  meta = true,
  status = true,
  link = true,
  lines = 2,
  end,
  className,
}: {
  development: Schema<"DevelopmentSummary">;
  subjects?: Schema<"SubjectRef">[];
  meta?: boolean;
  status?: boolean;
  link?: boolean;
  /** Title lines before it truncates. */
  lines?: 1 | 2;
  end?: ReactNode;
  className?: string;
}) {
  // Unlinked rows sit in dialogs, where subject links would leave the dialog.
  const named = link ? (subjects ?? d.subjects.slice(0, 2)) : [];
  const more = link && !subjects ? d.subjects.length - named.length : 0;
  return (
    <div className={["row dev", !status && "no-stat", className].filter(Boolean).join(" ")}>
      {status && (
        <span className="stat">
          <DevelopmentBadge development={d} />
        </span>
      )}
      <span>
        <span className={`row-title${lines === 1 ? " one" : ""}`} title={lines === 1 ? d.title : undefined}>
          {link ? (
            <Link {...evidenceLink.development(d.id)} className="stretch">
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
                sourceCountText(d),
              ]}
            />
          </span>
        )}
      </span>
      {end ?? <span className="row-end">{shortDate(d.last_published)}</span>}
    </div>
  );
}

/**
 * A subject's listed series, its own (primary) first, then the system-wide or market-wide context.
 * The widget gallery and settings pick an indicator's series with it; custom questions pick theirs
 * (`none` adds an empty first option).
 */
export function SeriesSelect({
  listed,
  value,
  onChange,
  labelled = false,
  label = "Series",
  none,
  disabled,
}: {
  listed: Schema<"SubjectIndicator">[];
  value: string;
  onChange: (seriesId: string) => void;
  /** Settings faces show a visible label; the gallery names it for screen readers only. */
  labelled?: boolean;
  label?: string;
  /** The empty option's words, such as "None". */
  none?: string;
  disabled?: boolean;
}) {
  const groups = [
    { label: "Primary", items: listed.filter((i) => i.role === "primary") },
    { label: "Context", items: listed.filter((i) => i.role === "context") },
  ].filter((g) => g.items.length > 0);
  return (
    <label className="series-select">
      <span className={labelled ? undefined : "sr-only"}>{label}</span>
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {none !== undefined && <option value="">{none}</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((i) => (
              <option key={i.series.id} value={i.series.id}>
                {i.series.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
