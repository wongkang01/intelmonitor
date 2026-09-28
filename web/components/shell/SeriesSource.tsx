"use client";

// A measured series as a source in the evidence drawer (structured-data-plan.md, F2 and F3):
// the series names the block and links its source table, the meta line gives when the value was
// known, the source, scope and domain, and flags the cited value Preliminary or Revised in words.
// Under the code sentence, a small chart shows the series over its span with the cited period
// highlighted like a quoted passage.
import { useState, type PointerEvent } from "react";

import type { Schema } from "@/lib/api/client";
import {
  capitalize,
  day,
  INDICATOR_STATE_LABEL,
  longDate,
  monthYear,
  revisionsTitle,
  SCOPE_LABEL,
  seriesPeriod,
  seriesTick,
  seriesValue,
} from "@/lib/format";
import { Dotted } from "@/components/monitor/parts";

type Chart = Schema<"SeriesChart">;
type Series = Schema<"SeriesInfo">;

const domainOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** "Jul 2026, preliminary" for a release; a daily value states its date in the sentence, so only its flag. */
function citedPeriod(chart: Chart) {
  const { series: s, cited, revisions } = chart;
  if (!cited) return null;
  const flag = revisions.length ? (
    <span title={revisionsTitle(s, revisions)}>{INDICATOR_STATE_LABEL.revised.toLowerCase()}</span>
  ) : cited.preliminary ? (
    INDICATOR_STATE_LABEL.preliminary.toLowerCase()
  ) : null;
  if (s.frequency === "daily") return flag;
  return (
    <span>
      {seriesPeriod(s, cited.period)}
      {flag && <>, {flag}</>}
    </span>
  );
}

/**
 * One series source. `known` is when the cited value became known (a detection's publication);
 * `sentence` is the code's sentence, left out where the development's title already states it.
 */
export function SeriesSource({
  chart,
  known,
  sentence,
  newInRun = false,
}: {
  chart: Chart;
  known: string | null;
  sentence: string | null;
  newInRun?: boolean;
}) {
  const s = chart.series;
  return (
    <article className="source series-src" data-series-id={s.id}>
      <a href={s.source_url} target="_blank" rel="noreferrer">
        {s.name}
      </a>
      <p className="meta">
        <Dotted
          parts={[
            known && longDate(known),
            `Data, ${s.source_label}`,
            s.scope && SCOPE_LABEL[s.scope],
            domainOf(s.source_url),
            citedPeriod(chart),
            newInRun && "new this run",
          ]}
        />
      </p>
      <div className="finding">
        {sentence && <p>{sentence}</p>}
        <SeriesChart chart={chart} />
      </div>
    </article>
  );
}

/** A fact's sentence without the series name it opens with, since the block's link names it. */
export function factSentence(s: Series, text: string): string {
  const prefix = `${s.name}: `;
  return text.startsWith(prefix) ? capitalize(text.slice(prefix.length)) : text;
}

// The chart's own coordinates; it scales down with the drawer.
const W = 480;
const H = 92;
const TOP = 6;
const BOTTOM = 70;
// Width of one tabular digit at the meta size, for the gutters the labels need.
const CHAR = 6.8;
// Room the tooltip needs right of the point; with less, it opens to the left.
const TIP_ROOM = 260;

/**
 * At most four round ticks, their step's decimals, and the range the chart spans. By default the
 * ticks cover `lo` to `hi` and the range runs from the first tick to the last; `inside` keeps the
 * range at `lo` to `hi` and puts the ticks within it, so the line fills the plot.
 */
export function niceTicks(lo: number, hi: number, inside = false) {
  const raw = (hi - lo) / 3 || Math.abs(hi) / 3 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const span = (m: number) =>
    inside ? [Math.ceil(lo / m - 1e-9) * m, Math.floor(hi / m + 1e-9) * m] : [Math.floor(lo / m + 1e-9) * m, Math.ceil(hi / m - 1e-9) * m];
  const fits = (m: number) => {
    const [a, b] = span(m);
    return Math.round((b - a) / m) + 1 <= 4;
  };
  const step = [1, 2, 2.5, 5, 10, 20].map((m) => m * mag).find((m) => (inside || m >= raw) && fits(m)) ?? 20 * mag;
  const [first, last] = span(step);
  const ticks: number[] = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / mag === 2.5 ? 1 : 0));
  return { ticks, decimals, lo: inside ? lo : first, hi: inside ? hi : last };
}

/** An axis end: "Sep 2025", or "Q3 2021" for a quarterly series. */
const axisLabel = (s: Series, iso: string) => (s.frequency === "quarterly" ? seriesPeriod(s, iso) : monthYear(day(iso)));

/**
 * The series from the chart's start to the run date on a fixed time axis, so a monthly or
 * quarterly line ends at its last release. Recessive grid and scale at the left, the latest value
 * labelled at the line's end, a preliminary tail drawn lighter with a hollow end, a peg's zero
 * line, and the cited period as a highlight band. The pointer snaps a crosshair to the nearest
 * observation with a readout of its value and date.
 */
export function SeriesChart({ chart }: { chart: Chart }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const { series: s, line: pts } = chart;
  if (pts.length === 0) return null;
  const values = pts.map((p) => p.value);
  if (s.baseline !== null) values.push(s.baseline);
  const scale = niceTicks(Math.min(...values), Math.max(...values));
  const last = pts[pts.length - 1];
  const endLabel = seriesValue(s, last.value);
  const left = Math.ceil(Math.max(...scale.ticks.map((t) => seriesTick(s, t, scale.decimals).length)) * CHAR) + 8;
  const right = W - Math.ceil(endLabel.length * CHAR) - 13;
  const t0 = day(chart.start).getTime();
  const span = day(chart.end).getTime() - t0 || 1;
  const x = (iso: string) => left + ((day(iso).getTime() - t0) / span) * (right - left);
  const y = (v: number) => BOTTOM - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * (BOTTOM - TOP);
  const path = (list: typeof pts) => list.map((p) => `${x(p.period).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  // The preliminary tail: the last points still flagged, joined to the final value before them.
  let tail = pts.length;
  while (tail > 0 && pts[tail - 1].preliminary) tail--;
  const firm = pts.slice(0, tail);
  const soft = pts.slice(Math.max(0, tail - 1));
  const band =
    chart.cited_from && chart.cited_to ? { from: x(chart.cited_from) - 4, to: x(chart.cited_to) + 4 } : null;
  const at = hover ? pts[hover.i] : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const k = box.width / W;
    const vx = (e.clientX - box.left) / k;
    let i = 0;
    for (let j = 1; j < pts.length; j++) if (Math.abs(x(pts[j].period) - vx) < Math.abs(x(pts[i].period) - vx)) i = j;
    setHover({ i, x: box.left + x(pts[i].period) * k, y: box.top + y(pts[i].value) * k });
  };
  const when = (iso: string) => (s.frequency === "daily" ? longDate(iso) : seriesPeriod(s, iso));
  const cited = chart.cited_from && chart.cited_to && chart.cited_from !== chart.cited_to
    ? `${when(chart.cited_from)} to ${when(chart.cited_to)}`
    : chart.cited_to && when(chart.cited_to);
  return (
    <figure
      className="series-chart"
      role="img"
      aria-label={`${s.name}, ${axisLabel(s, chart.start)} to ${axisLabel(s, chart.end)}, latest ${endLabel}${cited ? `; cited: ${cited}` : ""}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {band && <rect className="sc-band" x={band.from} width={band.to - band.from} y={TOP - 2} height={BOTTOM - TOP + 4} rx={2} />}
        {scale.ticks.map((t) => (
          <g key={t}>
            <line className="sc-grid" x1={left} x2={right} y1={y(t)} y2={y(t)} />
            <text className="sc-ax" x={left - 8} y={y(t) + 4} textAnchor="end">
              {seriesTick(s, t, scale.decimals)}
            </text>
          </g>
        ))}
        {s.baseline !== null && <line className="ind-base" x1={left} x2={right} y1={y(s.baseline)} y2={y(s.baseline)} />}
        <text className="sc-ax" x={left} y={H - 5}>
          {axisLabel(s, chart.start)}
        </text>
        <text className="sc-ax" x={right} y={H - 5} textAnchor="end">
          {axisLabel(s, chart.end)}
        </text>
        {firm.length > 1 && <polyline className="sc-line" points={path(firm)} />}
        {soft.length > 1 && <polyline className="sc-line pre" points={path(soft)} />}
        <circle className={`sc-dot${last.preliminary ? " pre" : ""}`} cx={x(last.period)} cy={y(last.value)} r={4} />
        <text className="sc-end" x={x(last.period) + 9} y={y(last.value) + 4}>
          {endLabel}
        </text>
        {at && (
          <>
            <line className="sc-xh" x1={x(at.period)} x2={x(at.period)} y1={TOP} y2={BOTTOM} />
            <circle className="sc-xd" cx={x(at.period)} cy={y(at.value)} r={4} />
          </>
        )}
        {/* The whole plot takes the pointer, not only the thin line. */}
        <rect x={left} width={right - left} y={0} height={BOTTOM + 4} fill="transparent" />
      </svg>
      {hover && at && (
        <span
          className={`chart-tip${hover.x + TIP_ROOM > window.innerWidth ? " before" : ""}`}
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
        >
          <b>{seriesValue(s, at.value)}</b>
          <span>
            {when(at.period)}
            {at.preliminary && `, ${INDICATOR_STATE_LABEL.preliminary.toLowerCase()}`}
          </span>
        </span>
      )}
    </figure>
  );
}
