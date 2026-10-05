// The Trend view's chart (structured-data-plan.md, F6; mocks/trend-series.html, B "Brief"): one
// series on a fixed time axis ending on the window's last day, so a monthly or quarterly line
// stops at its last release. The stretch before the first document is shaded and named, the
// selected run's week is banded, the subject's Needs attention and Watch developments are ticks at
// their event dates along the bottom, and the note's cited developments are numbered markers on
// the line. The pointer snaps a crosshair to the nearest observation with its value, date and
// the developments marked that day.
import { Link } from "@tanstack/react-router";
import { useCallback, useState, type PointerEvent } from "react";

import type { Schema } from "@/lib/api/client";
import { day, longDate, plural, seriesPeriod, seriesTick, seriesValue, shortDate } from "@/lib/format";
import { evidenceLink } from "@/components/shell/Evidence";
import { niceTicks } from "@/components/shell/SeriesSource";

type Series = Schema<"TrendSeries">;
type Marked = Schema<"MarkedDevelopment">;
type Dated = Schema<"DatedDevelopment">;

const H = 240;
const TOP = 28;
const BOTTOM = 22;
const RIGHT = 8;
// Width of one tabular digit at the meta size, for the scale's gutter.
const CHAR = 6.8;
// Markers closer than this share one x and stack.
const STACK = 18;
// A tooltip opens to the left of the point with less room than this to its right.
const TIP_ROOM = 320;
const DAY_MS = 86_400_000;
// A peg's scale always shows the rule's 0.5% either side.
const PEG_SPAN = 0.6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BADGE_LABEL: Record<Marked["badge"], string> = { needs_attention: "Needs attention", watch: "Watch" };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The last point on or before `on`, else the first after it. */
function valueAt(line: Series["line"], on: string) {
  let found = line[0];
  for (const p of line) {
    if (p.period > on) break;
    found = p;
  }
  return found;
}

export function TrendChart({
  series: { series: s, line },
  from,
  to,
  documentsFrom,
  band,
  marks,
  cited,
}: {
  series: Series;
  /** The window, YYYY-MM-DD. */
  from: string;
  to: string;
  documentsFrom: string;
  band: [string, string] | null;
  marks: Marked[];
  cited: Dated[];
}) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pts = line.filter((p) => p.period >= from && p.period <= to);
  const peg = s.baseline !== null;

  let scale: { ticks: number[]; decimals: number; lo: number; hi: number };
  if (peg) {
    const span = Math.max(PEG_SPAN, ...pts.map((p) => Math.abs(p.value) * 1.1));
    scale = { ticks: [-0.5, 0, 0.5], decimals: 1, lo: -span, hi: span };
  } else {
    // A window with no release yet keeps the scale of the whole line.
    const values = (pts.length ? pts : line).map((p) => p.value);
    if (values.length === 0) values.push(0);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // Room above the line for the numbered markers.
    const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.01 || 1;
    scale = niceTicks(lo - pad * 0.4, hi + pad, true);
  }
  const tick = (v: number) => (peg ? `${seriesTick(s, v, 1)}%` : seriesTick(s, v, scale.decimals));
  const left = Math.ceil(Math.max(...scale.ticks.map((t) => tick(t).length)) * CHAR) + 8;
  const right = Math.max(left + 1, width - RIGHT);
  const t0 = day(from).getTime();
  const span = day(to).getTime() - t0 || 1;
  const x = (on: string) => left + ((day(on).getTime() - t0) / span) * (right - left);
  const y = (v: number) => TOP + ((scale.hi - v) / (scale.hi - scale.lo || 1)) * (H - TOP - BOTTOM);
  const base = H - BOTTOM;
  const inView = (on: string) => on >= from && on <= to;

  // The preliminary tail: the last points still flagged, joined to the final value before them.
  let tail = pts.length;
  while (tail > 0 && pts[tail - 1].preliminary) tail--;
  const path = (list: typeof pts) => list.map((p) => `${x(p.period).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  // Month starts, or for a window of a month or less the weekly days back from its end.
  const labels: { at: number; text: string }[] = [];
  if (span <= 31 * DAY_MS) {
    for (let t = day(to).getTime(); t >= t0; t -= 7 * DAY_MS) labels.push({ at: x(iso(new Date(t))), text: shortDate(iso(new Date(t))) });
    labels.reverse();
  } else {
    const d = day(from);
    for (let m = new Date(d.getFullYear(), d.getMonth() + 1, 1); m.getTime() <= day(to).getTime(); m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      labels.push({ at: x(iso(m)), text: m.getMonth() === 0 ? `${MONTHS[0]} ${m.getFullYear()}` : MONTHS[m.getMonth()] });
    }
  }
  const spaced = labels.filter((l, i, all) => i === 0 || l.at - all[i - 1].at >= 40);

  // Ticks: one per day, Needs attention first, taller with more developments.
  const days = new Map<string, Marked[]>();
  for (const m of marks) if (inView(m.on)) days.set(m.on, [...(days.get(m.on) ?? []), m]);
  for (const list of days.values()) list.sort((a, b) => Number(b.badge === "needs_attention") - Number(a.badge === "needs_attention"));

  // Numbered markers above the line at each cited development's date, stacked where close.
  const stacks: { at: number; top: number; items: { n: number; d: Dated }[] }[] = [];
  if (pts.length) {
    cited.forEach((d, i) => {
      if (!inView(d.on)) return;
      const at = x(d.on);
      const top = y(valueAt(pts, d.on).value);
      const stack = stacks.find((g) => Math.abs(g.at - at) < STACK);
      if (stack) {
        stack.items.push({ n: i + 1, d });
        stack.top = Math.min(stack.top, top);
      } else stacks.push({ at, top, items: [{ n: i + 1, d }] });
    });
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const vx = e.clientX - box.left;
    if (vx < left - 4 || vx > right + 4 || pts.length === 0) return setHover(null);
    let i = 0;
    for (let j = 1; j < pts.length; j++) if (Math.abs(x(pts[j].period) - vx) < Math.abs(x(pts[i].period) - vx)) i = j;
    setHover({ i, x: box.left + x(pts[i].period), y: box.top + y(pts[i].value) });
  };
  const at = hover ? pts[hover.i] : null;
  const atMarks = at ? (days.get(at.period) ?? []) : [];
  const when = (on: string) => (s.frequency === "daily" ? longDate(on) : seriesPeriod(s, on));
  const shade = documentsFrom > from ? x(documentsFrom < to ? documentsFrom : to) : null;
  const last = pts[pts.length - 1];

  return (
    <div className="tr-chart" ref={measure}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={
              last
                ? `${s.name}, ${when(from)} to ${when(to)}, latest ${seriesValue(s, last.value)} ${s.frequency === "daily" ? "on" : "for"} ${when(last.period)}`
                : `${s.name}: no data from ${when(from)} to ${when(to)}`
            }
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {shade !== null && (
              <>
                <rect className="tr-pre" x={left} y={TOP - 20} width={shade - left} height={base - TOP + 20} />
                {documentsFrom < to && <line className="tr-cut" x1={shade} x2={shade} y1={TOP - 20} y2={base} />}
              </>
            )}
            {band && band[1] >= from && (
              <rect
                className="tr-band"
                x={x(band[0] < from ? from : band[0])}
                y={TOP - 20}
                width={Math.max(2, x(band[1] > to ? to : band[1]) - x(band[0] < from ? from : band[0]))}
                height={base - TOP + 20}
              />
            )}
            {shade !== null && documentsFrom < to && shade - left > 180 && (
              <text className="tr-ax" x={shade - 6} y={TOP - 6} textAnchor="end">
                No documents before {shortDate(documentsFrom)}
              </text>
            )}
            {scale.ticks.map((t) => (
              <g key={t}>
                <line className={peg && t === 0 ? "tr-base" : "tr-grid"} x1={left} x2={right} y1={y(t)} y2={y(t)} />
                <text className="tr-ax" x={left - 8} y={y(t) + 4} textAnchor="end">
                  {tick(t)}
                </text>
              </g>
            ))}
            <line className="tr-base" x1={left} x2={right} y1={base} y2={base} />
            {spaced.map((l) => (
              <g key={l.at}>
                <line className="tr-base" x1={l.at} x2={l.at} y1={base} y2={base + 4} />
                <text className="tr-ax" x={l.at} y={base + 17} textAnchor={l.at - left < 16 ? "start" : right - l.at < 24 ? "end" : "middle"}>
                  {l.text}
                </text>
              </g>
            ))}
            {tail > 1 && <polyline className="tr-line" points={path(pts.slice(0, tail))} />}
            {pts.length - tail > 0 && <polyline className="tr-line pre" points={path(pts.slice(Math.max(0, tail - 1)))} />}
            {stacks.map((g) => (
              <line key={g.at} className="tr-leader" x1={g.at} x2={g.at} y1={g.top} y2={g.top - 14} />
            ))}
            {last && <circle className={`tr-end${last.preliminary ? " pre" : ""}`} cx={x(last.period)} cy={y(last.value)} r={4} />}
            {at && (
              <>
                <line className="tr-xh" x1={x(at.period)} x2={x(at.period)} y1={TOP - 20} y2={base} />
                <circle className="tr-xd" cx={x(at.period)} cy={y(at.value)} r={4} />
              </>
            )}
            {/* The whole plot takes the pointer, not only the thin line. */}
            <rect x={left} width={right - left} y={0} height={base} fill="transparent" />
          </svg>
          {/* Oldest first, so a later day sits on top where hit areas overlap. */}
          {[...days].sort(([a], [b]) => a.localeCompare(b)).map(([on, list]) => (
            <Link
              key={on}
              {...evidenceLink.development(list[0].development.id)}
              className={`tr-tk${list[0].badge === "needs_attention" ? " attn" : ""}`}
              style={{ left: x(on), bottom: BOTTOM + 1, height: Math.min(4 + list.length * 3, 14) }}
              aria-label={`${shortDate(on)}: ${plural(list.length, "development")}, ${list.map((m) => BADGE_LABEL[m.badge]).join(", ")}`}
              title={list.map((m) => `${BADGE_LABEL[m.badge]}: ${m.development.title} (published ${shortDate(m.development.first_published)})`).join("\n")}
            />
          ))}
          {stacks.flatMap((g) =>
            g.items.map(({ n, d }, k) => (
              <Link
                key={n}
                {...evidenceLink.development(d.development.id)}
                className={`tr-mk${d.development.needs_attention ? " attn" : ""}`}
                style={{ left: g.at, top: Math.max(8, g.top - 22 - k * 20) }}
                aria-label={`Cited ${n}: ${d.development.title}`}
                title={`${d.development.title} (${shortDate(d.on)})`}
              >
                {n}
              </Link>
            )),
          )}
          {hover && at && (
            <span className={`chart-tip${atMarks.length ? " wrap" : ""}${hover.x + TIP_ROOM > window.innerWidth ? " before" : ""}`} role="tooltip" style={{ left: hover.x, top: hover.y }}>
              <b>{seriesValue(s, at.value)}</b>
              <span>
                {when(at.period)}
                {at.preliminary && ", preliminary"}
              </span>
              {atMarks.slice(0, 3).map((m) => (
                <span key={m.development.id} className="tip-item">
                  <span className="tip-title">{m.development.title}</span>
                  <span>
                    {BADGE_LABEL[m.badge]} · published {shortDate(m.development.first_published)}
                  </span>
                </span>
              ))}
              {atMarks.length > 3 && <span>{atMarks.length - 3} more</span>}
            </span>
          )}
        </>
      )}
    </div>
  );
}
