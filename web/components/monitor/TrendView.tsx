// A monitor page's Data tab: the Indicators section (flagged rows first), then the trend
// (docs/archive/structured-data-plan.md, F6; mocks/trend-series.html, B "Brief"): the selected run's note on why
// the subject's series moved leads, its citations numbered on the chart of the 12 months to the
// latest run, with the facts the note was given beside it, and the cited developments below. Each
// week is one weekly update; "Before <first document>" shows the series where no document or note
// exists.
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useIndicators, useMonitorPage, useTrend } from "@/lib/api/queries";
import { trackRailHeight, useHashScroll } from "@/lib/dom";
import { capitalize, longDate, monthsBefore, plural, seriesChange, seriesPeriod, seriesValue, shortDate } from "@/lib/format";
import { evidenceLink } from "@/components/shell/Evidence";
import { PriorityBadge, sourceCountText } from "@/components/developments/labels";

import { Indicators } from "./Indicators";
import { MonitorHead } from "./MonitorView";
import { Section } from "./parts";
import { TrendChart } from "./TrendChart";

type Trend = Schema<"SubjectTrend">;
type Move = Schema<"SeriesMove">;
type SeriesInfo = Schema<"SeriesInfo">;
type Dated = Schema<"DatedDevelopment">;

// The chart's windows: 12 months to the latest run, or 3 months or 1 month to the selected one.
const ZOOMS = [
  { months: 12, label: "12 months" },
  { months: 3, label: "3 months" },
  { months: 1, label: "1 month" },
] as const;
type Zoom = (typeof ZOOMS)[number]["months"];
// A series switcher with more options than this is a menu.
const MAX_SEGMENTS = 3;
const PRE = "pre";

export function DataView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  const trend = useTrend(id);
  const p = page.data;
  // The Indicators section reads the same query; waiting for it here keeps the trend from jumping down.
  const indicators = useIndicators(id, p?.run.as_of, p !== undefined);
  useHashScroll();
  if (page.isError || trend.isError) return <p className="page-message">This data could not be loaded.</p>;
  if (!p || !trend.data || indicators.isPending) return null;
  const listed = indicators.data?.indicators.some((i) => i.series.listed) ?? false;
  return (
    <>
      <MonitorHead page={p} view="data" />
      <div className="data-tab">
        {listed && (
          <div className="panel">
            <Indicators subjectId={p.subject.id} asOf={p.run.as_of} />
          </div>
        )}
        {trend.data.series.length > 0 ? (
          <Brief key={trend.data.run.id} t={trend.data} />
        ) : (
          !listed && <p className="mon-empty">{p.subject.name} has no measured series.</p>
        )}
      </div>
    </>
  );
}

function Brief({ t }: { t: Trend }) {
  const latest = t.runs[t.runs.length - 1];
  const [selected, setSelected] = useState<string>(latest?.run.id ?? PRE);
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>(12);
  const index = t.runs.findIndex((r) => r.run.id === selected);
  const run = index >= 0 ? t.runs[index] : null;
  const note = run?.note ?? null;
  const hasPre = t.documents_from > t.start;
  const series = t.series.find((s) => s.series.id === (picked ?? note?.series_id)) ?? t.series[0];
  const s = series.series;
  // A window holds at least two periods of the series: none narrower than 3 months for a monthly one.
  const zooms = ZOOMS.filter((z) => s.frequency === "daily" || z.months === 12 || (s.frequency === "monthly" && z.months === 3));
  const months = zooms.some((z) => z.months === zoom) ? zoom : 12;
  // Narrower windows end on the selected run, or where the documents start.
  const end = months === 12 ? t.run.as_of : run ? run.run.as_of : t.documents_from;
  const from = months === 12 ? t.start : monthsBefore(end, months);
  const band: [string, string] = run ? [run.since, run.run.as_of] : [t.start, t.documents_from];
  const cited = note?.developments ?? [];

  return (
    <div className="tr-brief">
      <div className="panel">
        <Section
          id="why"
          title="Why it moved"
          meta={
            run
              ? `Week to ${shortDate(run.run.as_of)}`
              : `Before ${shortDate(t.documents_from)}`
          }
        >
          <div className="seg tr-runs" role="group" aria-label="Week">
            {[...t.runs].reverse().map((r) => (
              <button key={r.run.id} type="button" aria-pressed={r.run.id === selected} onClick={() => setSelected(r.run.id)}>
                {shortDate(r.run.as_of)}
              </button>
            ))}
            {hasPre && (
              <button type="button" aria-pressed={selected === PRE} onClick={() => setSelected(PRE)}>
                Before {shortDate(t.documents_from)}
              </button>
            )}
          </div>
          {run ? (
            note ? (
              <>
                <p className="tr-lead">{note.headline}</p>
                <NoteBody body={note.body} cited={cited} />
              </>
            ) : (
              <p className="tr-lead">No note for this week.</p>
            )
          ) : (
            <>
              <p className="tr-lead">No news before {shortDate(t.documents_from)}</p>
              <p className="tr-prose">News collection started on {longDate(t.documents_from)}, so nothing explains these weeks.</p>
            </>
          )}
          <div className="tr-bar">
            {t.series.length === 1 ? (
              <b className="tr-name">{s.name}</b>
            ) : t.series.length <= MAX_SEGMENTS ? (
              <div className="seg" role="group" aria-label="Series">
                {t.series.map((x) => (
                  <button key={x.series.id} type="button" aria-pressed={x.series.id === s.id} onClick={() => setPicked(x.series.id)}>
                    {x.series.short_name}
                  </button>
                ))}
              </div>
            ) : (
              <select className="input tr-select" aria-label="Series" value={s.id} onChange={(e) => setPicked(e.target.value)}>
                {t.series.map((x) => (
                  <option key={x.series.id} value={x.series.id}>
                    {x.series.name}
                  </option>
                ))}
              </select>
            )}
            {zooms.length > 1 && (
              <div className="seg" role="group" aria-label="Period">
                {zooms.map((z) => (
                  <button key={z.months} type="button" aria-pressed={z.months === months} onClick={() => setZoom(z.months)}>
                    {z.label}
                  </button>
                ))}
              </div>
            )}
            <span className="tr-legend">
              <span>
                <i className="attn" />
                High
              </span>
              <span>
                <i className="watch" />
                Medium
              </span>
            </span>
          </div>
          <TrendChart series={series} from={from} to={end} documentsFrom={t.documents_from} band={band} marks={t.developments} cited={cited} />
        </Section>
        {note && (
          <Section id="cited" title="Cited" meta={plural(cited.length, "development")}>
            {cited.length === 0 ? <p className="mon-empty">The note cites no development.</p> : <Cited cited={cited} />}
          </Section>
        )}
      </div>
      <aside className="panel tr-rail" aria-label="Facts" ref={trackRailHeight}>
        <Section id="facts" title="Facts" meta={run ? "Behind the note" : "Computed"}>
          <dl className="tr-facts">
            {(run ? noteFacts(s, note?.facts.find((m) => m.series_id === s.id)) : preFacts(series, t.documents_from)).map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="tr-src">{s.source_label}</p>
          <a className="link" href={s.source_url} target="_blank" rel="noreferrer">
            Open source table
          </a>
        </Section>
      </aside>
    </div>
  );
}

/** The note's body with its [n] citations as numbered links to the developments they cite. */
function NoteBody({ body, cited }: { body: string; cited: Dated[] }) {
  const parts = body.split(/(\[\d+\])/);
  return (
    <p className="tr-prose">
      {parts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const d = n ? cited[Number(n) - 1] : undefined;
        if (!n) return <Fragment key={i}>{part}</Fragment>;
        if (!d) return null;
        return (
          <Fragment key={i}>
            {/^\[\d+\]$/.test(parts[i - 2] ?? "") && parts[i - 1] === "" && <sup className="cite-sep">,</sup>}
            <Link {...evidenceLink.development(d.development.id)} className="cite" title={d.development.title}>
              {n}
            </Link>
          </Fragment>
        );
      })}
    </p>
  );
}

function Cited({ cited }: { cited: Dated[] }) {
  return (
    <div className="rows">
      {cited.map(({ development: d, on }, i) => (
        <div key={d.id} className="row dev tr-cited">
          <span className="tr-n">{i + 1}</span>
          <span className="stat">
            <PriorityBadge priority={d.priority} />
          </span>
          <span>
            <span className="row-title full">
              <Link {...evidenceLink.development(d.id)} className="stretch tlink">
                {d.title}
              </Link>
            </span>
            <span className="row-meta">
              {[capitalize(d.category), sourceCountText(d), d.first_published !== on && `reported ${shortDate(d.first_published)}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <span className="row-end">{shortDate(on)}</span>
        </div>
      ))}
    </div>
  );
}

/** The facts the note was given about one series, as label and value rows. */
function noteFacts(s: SeriesInfo, m: Move | undefined): [string, string][] {
  if (!m) return [["Facts", "None for this series"]];
  if (!m.latest) return [["Data", `None by ${shortDate(m.since)}`]];
  const at = (on: string) => (s.frequency === "daily" ? shortDate(on) : seriesPeriod(s, on));
  const rows: [string, string][] = [[`Latest, ${at(m.latest.period)}`, `${seriesValue(s, m.latest.value)}${m.latest.preliminary ? ", preliminary" : ""}`]];
  if (m.widest) rows.push(["Widest gap", `${seriesValue(s, m.widest.value)} on ${shortDate(m.widest.period)}`]);
  if (s.baseline === null) {
    if (!m.start) rows.push(["Known before", `None by ${shortDate(m.since)}`]);
    else if (s.frequency !== "daily" && !m.released) rows.push(["New release", `None since ${shortDate(m.since)}`]);
    else if (s.frequency === "daily") rows.push([`Change since ${shortDate(m.start.period)}`, seriesChange(s, m.start.value, m.latest.value)]);
    // A year-to-date total was compared with the same period a year earlier.
    else if (s.year_to_date && !m.base) rows.push(["Year earlier", "None"]);
    else if (s.year_to_date && m.base) rows.push([`Change on ${at(m.base.period)}`, seriesChange(s, m.base.value, m.latest.value)]);
    else rows.push([`Change on ${at(m.start.period)}`, seriesChange(s, m.start.value, m.latest.value)]);
  }
  if (m.largest_day) rows.push(["Largest day", `${seriesChange(s, m.largest_day.from_value, m.largest_day.value).split(" (")[0]} on ${shortDate(m.largest_day.period)}`]);
  if (m.record) {
    rows.push([
      m.record.kind === "high" ? "Highest since" : "Lowest since",
      m.record.whole_history ? `History began, ${at(m.record.since)}` : longDate(m.record.since),
    ]);
  }
  if (m.rule) rows.push(["Flagged at", `${m.rule.beyond}% off for ${m.rule.for_hours} h`]);
  return rows;
}

/** Before the first document: the series' first and last values in the chart's span, and its range. */
function preFacts({ series: s, line }: Schema<"TrendSeries">, documentsFrom: string): [string, string][] {
  const pts = line.filter((p) => p.period < documentsFrom);
  if (pts.length === 0) return [["Data", `None before ${shortDate(documentsFrom)}`]];
  // The span crosses a year end, so daily dates carry their year.
  const at = (on: string) => (s.frequency === "daily" ? longDate(on) : seriesPeriod(s, on));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const low = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const high = pts.reduce((a, b) => (b.value > a.value ? b : a));
  return [
    [`First, ${at(first.period)}`, seriesValue(s, first.value)],
    [`Last, ${at(last.period)}`, seriesValue(s, last.value)],
    ["Change", seriesChange(s, first.value, last.value)],
    ["Low", `${seriesValue(s, low.value)} on ${at(low.period)}`],
    ["High", `${seriesValue(s, high.value)} on ${at(high.period)}`],
  ];
}
