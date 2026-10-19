// The summary band at the top of an Overview (pipeline/summaries.py writes the brief): on the left
// the direction in words over the subject's state, then up to two concerns, each led by its bold
// label; on the right the top 3 Key data figures (KeyFigures.tsx), the next upcoming date and "Open
// Data". The brief never lists developments; Top developments below does, and the Related card
// beside it shows what reaches the subject through its links. A subject with no brief this run
// says so in one line; the right column drops when it has neither figures nor dates.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { shortDate } from "@/lib/format";
import { developmentLink } from "@/components/developments/link";

import { KeyFigures } from "./KeyFigures";

type Page = Schema<"MonitorPage">;

const DIRECTION: Record<Schema<"EntityBrief">["direction"], string> = {
  worse: "Worse than last week",
  better: "Better than last week",
  unchanged: "Unchanged from last week",
  mixed: "Mixed since last week",
};

export function SummaryBand({ page: p }: { page: Page }) {
  const b = p.brief;
  return (
    <section className="panel ov-band" aria-labelledby="brief">
      <div className="ov-band-main">
        <h2 id="brief" className="sr-only">
          This week
        </h2>
        {!b ? (
          <p className="mon-empty">No summary for {p.subject.name} this week.</p>
        ) : (
          <>
            <p className="brief-dir">
              {DIRECTION[b.direction]}
              {b.direction_reason && `. ${b.direction_reason}`}
            </p>
            <p className="brief-line">{b.state}</p>
            {b.concerns.length > 0 && (
              <ul className="brief-concerns">
                {b.concerns.map((c) => (
                  <li key={c.text}>
                    {c.label && <strong>{c.label}.</strong>} {c.text}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="ov-band-side">
        <KeyFigures subjectId={p.subject.id} asOf={p.run.as_of} />
        <NextDate page={p} />
      </div>
    </section>
  );
}

/**
 * The soonest of the brief's dates and the subject's upcoming dates in the next 90 days, in one
 * line. An upcoming date's label is short ("Applications close"), so its development's title is
 * the link's tooltip. Nothing renders when there are none.
 */
function NextDate({ page: p }: { page: Page }) {
  const [next] = [...(p.brief?.coming_up ?? []).map((d) => ({ ...d, development_title: null })), ...p.upcoming].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
  if (!next) return null;
  return (
    <p className="meta kf-next">
      Next: <span className="num">{shortDate(next.date)}</span>,{" "}
      <Link
        {...developmentLink(next.development_id, { subject: p.subject.id })}
        className="tlink"
        title={next.development_title ?? undefined}
      >
        {next.label}
      </Link>
    </p>
  );
}
