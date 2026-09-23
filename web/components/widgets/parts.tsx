// Pieces shared by widget bodies: the header, state badges and development rows.
import Link from "next/link";
import type { ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { plural, shortDate, STATE_LABEL, STATE_TONE, type State } from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";

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

export function DevelopmentRow({ development: d }: { development: Schema<"DevelopmentSummary"> }) {
  const evidence = useEvidenceHref();
  const subjects = d.subjects.slice(0, 2).map((s) => s.name);
  const meta = [...subjects, d.category, plural(d.source_count, "source")].join(", ");
  return (
    <Link href={evidence(d.id)} className="row" scroll={false}>
      <DevelopmentBadge development={d} />
      <span className="tx">
        <b>{d.title}</b>
        <span>{meta}</span>
      </span>
      {!d.needs_attention && !d.change && <span className="when">{shortDate(d.last_published)}</span>}
    </Link>
  );
}
