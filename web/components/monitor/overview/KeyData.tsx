// Key data on a monitor's Overview: the indicators a detector flagged lead, worst first, each with
// its event statement; then up to 3 of the subject's own (primary) series and up to 3 context
// series, one per series group, daily ones first among the context. Each is a compact row: name,
// latest value in its unit, the weekly change (daily series) or the change on the previous
// release, and a small line over 12 months. "Open Data" leads to the Data tab.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { useIndicators } from "@/lib/api/queries";
import { seriesPeriod, seriesValue } from "@/lib/format";
import { evidenceLink } from "@/components/shell/Evidence";
import { StateBadge } from "@/components/widgets/parts";

import { IndicatorLine } from "../Indicators";
import { Section } from "../parts";

type Indicator = Schema<"SubjectIndicator">;

const STATUS_RANK: Record<Indicator["status"], number> = { needs_attention: 0, watch: 1, stable: 2 };
const FREQUENCY_RANK: Record<Indicator["series"]["frequency"], number> = { daily: 0, monthly: 1, quarterly: 2 };
// Rows per role after the flagged ones.
const PER_ROLE = 3;

/** A row a detector flagged, from a feed that still has data (the Indicators section's rule). */
const flagged = (i: Indicator) => i.status !== "stable" && i.state !== "no_data" && i.state !== "stale";

/** The first row of each series group (or ungrouped series), in order, up to `PER_ROLE`. */
function onePerGroup(rows: Indicator[]): Indicator[] {
  const seen = new Set<string>();
  return rows
    .filter((i) => {
      const key = i.series.group ?? i.series.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PER_ROLE);
}

/** The change a compact row shows: over a week for daily series, else against the previous release. */
function compactChange(ind: Indicator): string | null {
  const s = ind.series;
  const window = s.frequency === "daily" ? "1w" : s.frequency === "monthly" ? "1m" : "3m";
  const c = ind.changes.find((x) => x.window === window);
  if (!c || c.change === null || !c.since) return null;
  const points = ind.change_basis === "points";
  const size = Math.abs(c.change).toFixed(points ? s.decimals : 1);
  const sign = Number(size) === 0 ? "" : c.change > 0 ? "+" : "−";
  const when = s.frequency === "daily" ? "wk" : `vs ${seriesPeriod(s, c.since).split(" ")[0]}`;
  return `${sign}${size}${points ? " pt" : "%"} ${when}`;
}

export function KeyData({ subjectId, asOf }: { subjectId: string; asOf: string }) {
  const query = useIndicators(subjectId, asOf);
  const listed = query.data?.indicators.filter((i) => i.series.listed) ?? [];
  if (listed.length === 0) return null;
  const top = listed.filter(flagged).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const rest = listed.filter((i) => !flagged(i));
  const primary = onePerGroup(rest.filter((i) => i.role === "primary"));
  const context = onePerGroup(
    rest.filter((i) => i.role === "context").sort((a, b) => FREQUENCY_RANK[a.series.frequency] - FREQUENCY_RANK[b.series.frequency]),
  );
  return (
    <div className="panel ov-card">
      <Section
        id="key-data"
        title="Key data"
        meta={
          <Link to="/monitors/$id/data" params={{ id: subjectId }} className="link">
            Open Data
          </Link>
        }
      >
        {top.map((ind) => (
          <FlaggedRow key={ind.series.id} ind={ind} asOf={asOf} />
        ))}
        <div className="rows kd-rows">
          {[...primary, ...context].map((ind) => (
            <KeyRow key={ind.series.id} ind={ind} asOf={asOf} />
          ))}
        </div>
      </Section>
    </div>
  );
}

/** A flagged series: its status and name, the detector's statement, then the compact figures. */
function FlaggedRow({ ind, asOf }: { ind: Indicator; asOf: string }) {
  const developmentId = ind.events.find((e) => e.development_id)?.development_id;
  const name = ind.series.name;
  return (
    <div className="kd-flag" data-series-id={ind.series.id}>
      <div className="kd-flag-head">
        <StateBadge state={ind.status} />
        <span className="row-title">
          {developmentId ? (
            <Link {...evidenceLink.development(developmentId)} className="kd-name">
              {name}
            </Link>
          ) : (
            name
          )}
        </span>
      </div>
      {ind.events.map((e) => (
        <p key={e.statement} className="meta kd-statement">
          {e.statement}
        </p>
      ))}
      <KeyRow ind={ind} asOf={asOf} named={false} />
    </div>
  );
}

/**
 * Name, latest value with its change, and a 12-month line. `named={false}` puts the latest
 * value's period in place of the name, under a flagged series' own heading.
 */
function KeyRow({ ind, asOf, named = true }: { ind: Indicator; asOf: string; named?: boolean }) {
  const s = ind.series;
  const change = compactChange(ind);
  return (
    <div className={`row kd-row${named ? "" : " bare"}`} data-series-id={named ? s.id : undefined}>
      {named ? (
        <span className="kd-label" title={s.name}>
          {s.name}
        </span>
      ) : (
        <span className="kd-label meta">{ind.latest && seriesPeriod(s, ind.latest.period)}</span>
      )}
      <span className="kd-val">
        {ind.latest ? seriesValue(s, ind.latest.value) : "No data"}
        {change && <span className="meta"> {change}</span>}
      </span>
      <IndicatorLine ind={ind} name={s.name} asOf={asOf} className="ind-line kd-line" />
    </div>
  );
}
