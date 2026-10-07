// The Summary on a monitor's Overview: the run's paragraph on the subject (written by the summary
// step, api/intelmonitor/pipeline/summaries.py), its counts, and the direction against the
// previous run with what it was measured on. Older runs have no summary; the page then shows none.
import type { Schema } from "@/lib/api/client";
import { shortDate } from "@/lib/format";

import { Section } from "../parts";

type Direction = NonNullable<Schema<"RunSummary">["direction"]>;

const DIRECTION: Record<Direction, { label: string; tone: string }> = {
  more_adverse: { label: "More adverse", tone: "c-attn" },
  less_adverse: { label: "Less adverse", tone: "c-stable" },
  unchanged: { label: "Unchanged", tone: "" },
};

export function RunSummary({ summary: s, run }: { summary: Schema<"RunSummary">; run: Schema<"RunRef"> }) {
  const direction = s.direction ? DIRECTION[s.direction] : null;
  return (
    <div className="panel ov-card">
      <Section
        id="summary"
        title="Summary"
        meta={`Run of ${shortDate(run.as_of)}${run.previous_run_id ? ` against ${shortDate(run.previous_run_id)}` : ""}`}
      >
        <p className="ov-lead" title={`Written by ${s.model}`}>
          {s.text}
        </p>
        <p className="ov-counts">
          <span>
            <b>{s.developments_in_scope}</b> developments in scope
          </span>
          <span>
            <b className={s.needs_attention > 0 ? "c-attn" : undefined}>{s.needs_attention}</b> need attention
          </span>
          <span>
            <b>{s.adverse}</b> adverse
          </span>
        </p>
        {direction && (
          <p className="meta ov-direction">
            <b className={direction.tone}>{direction.label}</b>
            {s.direction_basis && `: ${s.direction_basis}`}
          </p>
        )}
      </Section>
    </div>
  );
}
