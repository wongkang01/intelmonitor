// A development's sources under two tabs, News (news, official and research reports) and Social
// (posts), at the top of the popup's right column. Each source keeps its highlighted excerpts.
// Social posts read Unverified until a news or official source in the same development confirms them, and when posts came first the tab says by how much (decision X2: both
// are worked out here from each source's collection and timestamp). An unconfirmed development
// says above its sources what the source gate (api pipeline/corroboration.py) found missing.
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { longDate, plural } from "@/lib/format";
import { Dotted } from "@/components/monitor/parts";
import { SeriesSource } from "@/components/shell/SeriesSource";

import { SOURCE_TYPE_LABEL } from "./labels";

type Source = Schema<"EvidenceSource">;
type Tab = "reports" | "social";

/** Collections that confirm a social post: reports by a newsroom, an official body or a researcher. */
const REPORT_WORD: Partial<Record<Source["collection"], string>> = { news: "news report", official: "official report", dms: "research report" };
const REPORTS = new Set(Object.keys(REPORT_WORD));
// A post that came less than this before the first report is not called earlier.
const MIN_LEAD_MS = 10 * 60_000;

export function Sources({ sources, title, unconfirmed = false }: { sources: Source[]; title: string; unconfirmed?: boolean }) {
  const social = sources.filter((s) => s.collection === "social");
  const reports = sources.filter((s) => s.collection !== "social");
  const [tab, setTab] = useState<Tab>(reports.length > 0 || social.length === 0 ? "reports" : "social");
  const id = useId();
  const confirmed = sources.some((s) => REPORTS.has(s.collection));
  const lead = leadTime(sources);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "reports", label: "News", count: reports.length },
    { id: "social", label: "Social", count: social.length },
  ];

  // Arrow keys move between the two tabs.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "reports" ? "social" : "reports";
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };

  const shown = tab === "reports" ? reports : social;
  return (
    <section className="dp-src" aria-label={plural(sources.length, "source")} id="sources">
      <div className="src-tabs" role="tablist" aria-label="Source types" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="n">{t.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="src-panel">
        {unconfirmed && (
          <p className="src-lead">
            <span className="unv">Unconfirmed:</span> not enough independent sources yet.
          </p>
        )}
        {tab === "social" && lead && <p className="src-lead">{lead}</p>}
        {shown.length === 0 && (
          <p className="muted">{tab === "social" ? "No social posts about this development." : "No news or official report yet. The posts are unverified."}</p>
        )}
        {shown.map((s) => (
          <SourceBlock key={s.document_id} source={s} title={title} verified={s.collection === "social" ? confirmed : undefined} />
        ))}
      </div>
    </section>
  );
}

/** "Social, X" or "Social, forum"; other sources show their collection and document type. */
function kindOf(s: Source): string {
  if (s.collection === "social") return `Social, ${/^x\b/i.test(s.doc_type) ? "X" : s.doc_type.toLowerCase().replace(/ thread$/, "")}`;
  const label = SOURCE_TYPE_LABEL[s.collection];
  return s.doc_type.toLowerCase() === s.collection ? label : `${label}, ${s.doc_type}`;
}

/**
 * One source with its findings; a detector's document is its series, with the event highlighted.
 * `verified` marks a social post Confirmed by news or Unverified.
 */
export function SourceBlock({ source: s, title, verified }: { source: Source; title: string; verified?: boolean }) {
  if (s.series) {
    const sentence = s.findings.find((f) => f.statement !== title)?.statement ?? null;
    return <SeriesSource chart={s.series} known={s.published_at} sentence={sentence} />;
  }
  const status: ReactNode =
    verified === undefined ? null : verified ? (
      <span className="c-stable">Confirmed by news</span>
    ) : (
      <span className="unv">Unverified</span>
    );
  return (
    <article className="source">
      <a href={s.url} target="_blank" rel="noreferrer">
        {s.title}
      </a>
      <p className="meta">
        <Dotted parts={[publishedText(s.published_at), kindOf(s), s.domain, status]} />
      </p>
      {s.findings.map((f) => (
        <div key={f.id} className="finding">
          {f.statement !== title && <p>{f.statement}</p>}
          <blockquote>
            <Highlighted passage={f.passage} />
          </blockquote>
        </div>
      ))}
    </article>
  );
}

/** Many news sources carry only a date, stored at midnight UTC; those have no time to compare. */
const dateOnly = (iso: string) => /T00:00:00(\.0+)?(Z|\+00:00)$/.test(iso);
const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });

/** "15 Aug 2026, 5:37 pm" for a timestamp, "15 Aug 2026" for a date-only source. */
const publishedText = (iso: string) => (dateOnly(iso) ? longDate(iso.slice(0, 10)) : `${longDate(iso)}, ${time.format(new Date(iso))}`);

/** The calendar day of a timestamp in Singapore, where the sources are read. */
const sgDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date(iso));

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 && hours < 10 ? `${hours} hr ${minutes % 60} min` : `${hours} hr`;
  return plural(Math.floor(hours / 24), "day");
}

/**
 * "Posts came 40 min before the first news report", when the first social post precedes the first
 * news or official report. A date-only report compares by calendar day, so a post on the same day
 * gives no line rather than a guess.
 */
export function leadTime(sources: Source[]): string | null {
  const byTime = (a: Source, b: Source) => Date.parse(a.published_at) - Date.parse(b.published_at);
  const post = sources.filter((s) => s.collection === "social").sort(byTime)[0];
  const report = sources.filter((s) => REPORTS.has(s.collection)).sort(byTime)[0];
  if (!post || !report) return null;
  const what = REPORT_WORD[report.collection] ?? "report";
  if (!dateOnly(report.published_at)) {
    const ms = Date.parse(report.published_at) - Date.parse(post.published_at);
    return ms >= MIN_LEAD_MS ? `Posts came ${duration(ms)} before the first ${what}.` : null;
  }
  const days = (Date.parse(report.published_at.slice(0, 10)) - Date.parse(sgDay(post.published_at))) / 86_400_000;
  return days >= 1 ? `Posts came ${plural(Math.round(days), "day")} before the first ${what}.` : null;
}

/** A passage with its quote spans wrapped in <mark>, and an ellipsis where the document goes on. */
export function Highlighted({ passage }: { passage: Schema<"Passage"> }) {
  const parts: ReactNode[] = [passage.clipped_start && "…"];
  let at = 0;
  for (const h of [...passage.highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    parts.push(passage.text.slice(at, h.start));
    parts.push(<mark key={h.start}>{passage.text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  parts.push(passage.text.slice(at), passage.clipped_end && "…");
  return <>{parts}</>;
}
