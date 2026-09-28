"use client";

// The Indicators section of a monitor page (structured-data-plan.md, F4): one row per measured
// series mapped to the subject, as of the page's run date. Status from the detector rules, the
// latest value with its period, the change with its window, and a line over 12 months. Series
// that share a group heading in api/seed/series.yaml sit under it when two or more are on the
// page; the rest lead, under their full names.
import Link from "next/link";
import { useState, type PointerEvent, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { useIndicators } from "@/lib/api/queries";
import {
  day,
  indicatorChange,
  INDICATOR_STATE_LABEL,
  longDate,
  SCOPE_LABEL,
  seriesPeriod,
  seriesValue,
  shortDate,
} from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { StateBadge } from "@/components/widgets/parts";

import { Dotted } from "./parts";

type Indicator = Schema<"SubjectIndicator">;

interface Group {
  heading: string | null;
  rows: { ind: Indicator; name: string }[];
}

/** Lead rows (ungrouped, or alone in their group) first, then each group of two or more in order. */
function grouped(indicators: Indicator[]): Group[] {
  const members = new Map<string, Indicator[]>();
  for (const ind of indicators) {
    if (ind.series.group) members.set(ind.series.group, [...(members.get(ind.series.group) ?? []), ind]);
  }
  const lead: Group = { heading: null, rows: [] };
  const groups = new Map<string, Group>();
  for (const ind of indicators) {
    const heading = ind.series.group;
    const peers = heading ? (members.get(heading) ?? []) : [];
    if (!heading || peers.length < 2) {
      lead.rows.push({ ind, name: ind.series.name });
      continue;
    }
    // A group where two rows share a short name (Paxos's two coins) uses full names throughout.
    const shared = new Set(peers.map((p) => p.series.short_name)).size < peers.length;
    const group = groups.get(heading) ?? { heading, rows: [] };
    group.rows.push({ ind, name: shared ? ind.series.name : ind.series.short_name });
    groups.set(heading, group);
  }
  return [lead, ...groups.values()].filter((g) => g.rows.length > 0);
}

/** "System-wide" when every row is the banking system's, else the APIs the values come from. */
function sectionMeta(indicators: Indicator[]): string {
  if (indicators.every((i) => i.series.scope === "system")) return SCOPE_LABEL.system;
  return [...new Set(indicators.flatMap((i) => i.series.providers))].join(", ");
}

export function Indicators({ subjectId, asOf }: { subjectId: string; asOf: string }) {
  const query = useIndicators(subjectId, asOf);
  const listed = query.data?.indicators.filter((i) => i.series.listed) ?? [];
  if (listed.length === 0) return null;
  return (
    <section className="mon-sec ind" aria-labelledby="indicators">
      <div className="mon-sec-head">
        <h2 id="indicators">Indicators</h2>
        <span className="meta">{sectionMeta(listed)}</span>
      </div>
      <div className="ind-cols" aria-hidden="true">
        <span />
        <span />
        <span>Latest</span>
        <span>Change</span>
        <span>12 months</span>
      </div>
      {grouped(listed).map((g) => (
        <div key={g.heading ?? ""}>
          {g.heading && <h3 className="mon-sub">{g.heading}</h3>}
          <div className="rows">
            {g.rows.map(({ ind, name }) => (
              <IndicatorRow key={ind.series.id} ind={ind} name={name} asOf={asOf} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** "Jun 2026 was 69.8%, revised 12 Sep" for each recent revision, for the Revised label's tooltip. */
function revisedTitle(ind: Indicator): string {
  return ind.revisions
    .map((r) => `${seriesPeriod(ind.series, r.period)} was ${seriesValue(ind.series, r.old_value)}, revised ${shortDate(r.revised_at)}`)
    .join("\n");
}

function IndicatorRow({ ind, name, asOf }: { ind: Indicator; name: string; asOf: string }) {
  const evidence = useEvidenceHref();
  const s = ind.series;
  const change = indicatorChange(ind);
  const flag =
    ind.state === "revised" ? (
      <span title={revisedTitle(ind)}>{INDICATOR_STATE_LABEL.revised.toLowerCase()}</span>
    ) : ind.state === "preliminary" ? (
      INDICATOR_STATE_LABEL.preliminary.toLowerCase()
    ) : null;
  const when = ind.latest ? (
    <>
      {seriesPeriod(s, ind.latest.period)}
      {flag && <>, {flag}</>}
    </>
  ) : (
    `No data by ${shortDate(asOf)}`
  );
  const unusable = ind.state === "no_data" || ind.state === "stale";
  const cells: ReactNode = (
    <>
      <span className="stat">
        {unusable ? (
          <span className="badge b-neutral">{INDICATOR_STATE_LABEL[ind.state]}</span>
        ) : (
          <span title={ind.events.map((e) => e.statement).join("\n") || undefined}>
            <StateBadge state={ind.status} />
          </span>
        )}
      </span>
      <span className="ind-name">
        <span className="row-title one">{name}</span>
        <span className="row-meta">
          {/* Each part wraps whole: "System-wide" never breaks at its hyphen. */}
          <Dotted parts={[when, s.source_label, s.scope && SCOPE_LABEL[s.scope]].map((p, i) => p && <span key={i}>{p}</span>)} />
        </span>
      </span>
      <span className="ind-val">{ind.latest ? seriesValue(s, ind.latest.value) : null}</span>
      <span className="ind-chg">
        {change && (
          <>
            {change.value}
            <span className="row-meta">{change.window}</span>
          </>
        )}
      </span>
      <IndicatorLine ind={ind} name={name} asOf={asOf} />
    </>
  );
  // A row whose status comes from a detector event opens the development that carries it.
  const developmentId = unusable ? null : ind.events.find((e) => e.development_id)?.development_id;
  return developmentId ? (
    <Link href={evidence.development(developmentId)} scroll={false} className="row ind-row" data-series-id={s.id}>
      {cells}
    </Link>
  ) : (
    <div className="row ind-row" data-series-id={s.id}>
      {cells}
    </div>
  );
}

// Vertical room kept above and below the line, in percent of the chart's height.
const PAD = 6;
// Room the tooltip needs right of the point; with less, it opens to the left.
const TIP_ROOM = 260;

/** The 12 months to the run date as a time axis: its start, and a date's place on it in percent. */
export function yearAxis(asOf: string) {
  const end = day(asOf);
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
  const span = end.getTime() - start.getTime();
  return { start, span, x: (iso: string) => ((day(iso).getTime() - start.getTime()) / span) * 100 };
}

/**
 * The series over the 12 months to the run date on a fixed time axis, so a monthly or quarterly
 * line stops at its last release and the gap shows the reporting lag. No axes unless `labels`
 * puts the scale's top and bottom values at its left; the pointer snaps a crosshair to the
 * nearest observation and a tooltip gives its value and date. A peg's distance is drawn against
 * its zero line. `className` sizes it: `ind-line` alone is the list-row height.
 */
export function IndicatorLine({
  ind,
  name,
  asOf,
  className = "ind-line",
  labels = false,
}: {
  ind: Indicator;
  name: string;
  asOf: string;
  className?: string;
  labels?: boolean;
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const s = ind.series;
  const pts = ind.line;
  if (pts.length === 0) return <span className={className} />;
  const { start, span, x } = yearAxis(asOf);
  const values = pts.map((p) => p.value);
  if (s.baseline !== null) values.push(s.baseline);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) [lo, hi] = [lo - 1, hi + 1];
  const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * (100 - 2 * PAD);
  const last = pts[pts.length - 1];
  const at = hover ? pts[hover.i] : null;

  const onMove = (e: PointerEvent<HTMLSpanElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = start.getTime() + ((e.clientX - box.left) / box.width) * span;
    let i = 0;
    for (let k = 1; k < pts.length; k++) {
      if (Math.abs(day(pts[k].period).getTime() - t) < Math.abs(day(pts[i].period).getTime() - t)) i = k;
    }
    setHover({
      i,
      x: box.left + (box.width * x(pts[i].period)) / 100,
      y: box.top + (box.height * y(pts[i].value)) / 100,
    });
  };
  const range = `${seriesValue(s, Math.min(...pts.map((p) => p.value)))} to ${seriesValue(s, Math.max(...pts.map((p) => p.value)))}`;
  return (
    <span
      className={className}
      role="img"
      aria-label={`${s.name}, 12 months to ${shortDate(asOf)}: ${range}, latest ${seriesValue(s, last.value)}`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        {s.baseline !== null && (
          <line x1="0" x2="1000" y1={y(s.baseline)} y2={y(s.baseline)} className="ind-base" vectorEffect="non-scaling-stroke" />
        )}
        <polyline
          points={pts.map((p) => `${(x(p.period) * 10).toFixed(1)},${y(p.value).toFixed(2)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {labels && (
        <>
          <span className="ind-y top">{seriesValue(s, hi)}</span>
          <span className="ind-y bottom">{seriesValue(s, lo)}</span>
        </>
      )}
      {/* Dots sit outside the stretched SVG so they stay round. */}
      <span className="spark-dot" style={{ left: `${x(last.period)}%`, top: `${y(last.value)}%` }} />
      {hover && at && (
        <>
          <span className="ind-x" style={{ left: `${x(at.period)}%` }} />
          <span className="ind-hd" style={{ left: `${x(at.period)}%`, top: `${y(at.value)}%` }} />
          <span
            className={`chart-tip${hover.x + TIP_ROOM > window.innerWidth ? " before" : ""}`}
            role="tooltip"
            style={{ left: hover.x, top: hover.y }}
          >
            <b>{seriesValue(s, at.value)}</b>
            <span>{s.frequency === "daily" ? longDate(at.period) : seriesPeriod(s, at.period)}</span>
            <span>{name}</span>
          </span>
        </>
      )}
    </span>
  );
}
