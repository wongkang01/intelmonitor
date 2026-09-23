// Pieces shared by widget bodies: the header, state badges and development rows.
import Link from "next/link";
import type { ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { plural, shortDate, STATE_LABEL, STATE_TONE, type State } from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLinks } from "@/components/shell/SubjectLink";

/** Widget header: grey title top-left, optional link target, meta on the right. */
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

/** A state as a badge; Stable is green text without a fill. */
export function StateBadge({ state, newCount = 0 }: { state: State; newCount?: number }) {
  const label = state === "new" && newCount > 0 ? `${newCount} new` : STATE_LABEL[state];
  return <span className={`badge b-${STATE_TONE[state]}`}>{label}</span>;
}

/** "Watch → Needs attention" when the state changed since the previous run, else the state. */
export function stateText(answer: Schema<"QuestionAnswerView">): string {
  const now = answer.state === "new" && answer.new_count > 0 ? `${answer.new_count} new` : STATE_LABEL[answer.state];
  const before = answer.change.previous_state;
  return answer.change.kind === "state_changed" && before ? `${STATE_LABEL[before]} → ${now}` : now;
}

export function DevelopmentBadge({ development: d }: { development: Schema<"DevelopmentSummary"> }) {
  if (d.needs_attention) return <span className="badge b-attn">Needs attention</span>;
  if (d.change === "new") return <span className="badge b-new">New</span>;
  if (d.change === "updated") return <span className="badge b-new">Updated</span>;
  return null;
}

/**
 * A development as a row that opens its evidence. Subject names link to their pages; pass
 * `subjects` to name others (a group's members) than the development's first two.
 */
export function DevelopmentRow({
  development: d,
  subjects = d.subjects.slice(0, 2),
}: {
  development: Schema<"DevelopmentSummary">;
  subjects?: Schema<"SubjectRef">[];
}) {
  const evidence = useEvidenceHref();
  return (
    <div className="row dev">
      <DevelopmentBadge development={d} />
      <span className="tx">
        <Link href={evidence.development(d.id)} className="stretch" scroll={false}>
          <b>{d.title}</b>
        </Link>
        <span>
          {subjects.length > 0 && (
            <>
              <SubjectLinks subjects={subjects} />,{" "}
            </>
          )}
          {d.category}, {plural(d.source_count, "source")}
        </span>
      </span>
      {!d.needs_attention && !d.change && <span className="when">{shortDate(d.last_published)}</span>}
    </div>
  );
}
