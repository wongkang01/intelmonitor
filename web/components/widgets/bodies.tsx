"use client";

// The eight widget bodies (the Indicator's is in IndicatorBody.tsx). Each renders one widget's data from the API at its size, inside a
// fixed-height face, so each size shows only as many rows as fit without cutting a line.
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

import type { Schema, Widget, WidgetData } from "@/lib/api/client";
import { useMarkReviewed, useSubjects, type DataOf } from "@/lib/api/queries";
import { answerText, daysBetween, inDays, plural, runMeta, shortDate, whenAt } from "@/lib/format";
import { useCoarsePointer } from "@/lib/dom";
import { monitorHref, setEntities } from "@/lib/widgets";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { hasUnreviewed } from "@/components/monitor/WhatChanged";

import { IndicatorBody } from "./IndicatorBody";
import { DevelopmentRow, Head, StateBadge, StateWords, stateText } from "./parts";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

export interface BodyProps {
  widget: Widget;
  href: string | null;
  /** Saves a changed widget; watchlists edit their entities in place. */
  onChange: (widget: Widget) => void;
}

export function WidgetBody({ data, ...props }: BodyProps & { data: WidgetData }) {
  switch (data.type) {
    case "since":
      return <SinceBody data={data} {...props} />;
    case "question":
      return <QuestionBody data={data} {...props} />;
    case "summary":
      return <SummaryBody data={data} {...props} />;
    case "developments":
      return <DevelopmentsBody data={data} {...props} />;
    case "direction":
      return <DirectionBody data={data} {...props} />;
    case "watchlist":
      return <WatchlistBody data={data} {...props} />;
    case "upcoming":
      return <UpcomingBody data={data} {...props} />;
    case "indicator":
      return <IndicatorBody data={data} {...props} />;
  }
}

const needs = (n: number) => `${n} ${n === 1 ? "needs" : "need"} attention`;
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Rows shown under the Needs attention label, then New fills up to `until` rows (Large only). The 44px
 * touch rows from `styles/touch.css` fit one row fewer.
 */
const SINCE_ROWS = {
  mouse: { M: 1, L: 6, until: 5 },
  touch: { M: 1, L: 5, until: 4 },
} as const;

/**
 * Counts and rows since the review of the widget's subjects, as on their monitor pages: dismissed
 * developments leave, and read ones leave New.
 */
function SinceBody({ data, widget, href }: BodyProps & { data: DataOf<"since"> }) {
  const wc = data.what_changed;
  const review = useMarkReviewed();
  const size = widget.size === "L" ? "L" : "M";
  const rows = SINCE_ROWS[useCoarsePointer() ? "touch" : "mouse"];
  const hero =
    [wc.new_count > 0 && `${wc.new_count} new`, wc.needs_attention_count > 0 && needs(wc.needs_attention_count)]
      .filter(Boolean)
      .join(", ") ||
    (wc.updated_count > 0
      ? `${wc.updated_count} updated`
      : wc.reviewed_at && !hasUnreviewed(wc)
        ? "Nothing new since your review"
        : "No new developments");
  const current = wc.developments.filter((d) => d.unreviewed && !d.dismissed);
  const attention = current.filter((d) => d.needs_attention);
  const fresh = current.filter((d) => !d.needs_attention && d.change === "new" && !d.read);
  const attentionShown = attention.slice(0, rows[size]);
  const room = size === "L" ? rows.until - attentionShown.length : attentionShown.length ? 0 : 1;
  const freshShown = fresh.slice(0, Math.max(0, room));
  const changes = [
    wc.updated_count ? `${wc.updated_count} updated` : null,
    `${plural(wc.question_changes.filter((c) => c.unreviewed).length, "answer")} changed`,
  ].filter(Boolean);
  // Previews and edit mode have no href but keep the layout.
  const showAll = href ? (
    <Link href={href} className="link">
      Show all
    </Link>
  ) : (
    <span className="link">Show all</span>
  );
  return (
    <>
      <Head title="Since your last review" href={href} meta={runMeta(wc.run)} />
      <p className="hero">{hero}</p>
      {attentionShown.length > 0 && (
        <>
          <div className="gl c-attn">
            <span className="dot" aria-hidden="true" />
            Needs attention · {wc.needs_attention_count}
            {showAll}
          </div>
          <div className="rows">
            {attentionShown.map((d) => (
              <DevelopmentRow key={d.id} development={d} meta={false} status={false} lines={1} />
            ))}
          </div>
        </>
      )}
      {freshShown.length > 0 && (
        <>
          <div className="gl c-new">
            <span className="dot" aria-hidden="true" />
            New · {fresh.length}
            {attentionShown.length === 0 && showAll}
          </div>
          <div className="rows">
            {freshShown.map((d) => (
              <DevelopmentRow key={d.id} development={d} meta={false} status={false} lines={1} />
            ))}
          </div>
        </>
      )}
      {size === "L" && (
        <div className="wf">
          <button
            type="button"
            className="link"
            data-tour="mark-reviewed"
            disabled={review.isPending || !hasUnreviewed(wc)}
            onClick={() => review.mutate(data.scope.map((s) => s.id))}
          >
            Mark all reviewed
          </button>
          <span className="w-meta">
            {wc.reviewed_at && !hasUnreviewed(wc) ? `Reviewed ${whenAt(wc.reviewed_at)}` : changes.join(" · ")}
          </span>
        </div>
      )}
    </>
  );
}

function QuestionBody({ data, href }: BodyProps & { data: DataOf<"question"> }) {
  const a = data.answer;
  const evidence = useEvidenceHref();
  return (
    <>
      <Head title={a.label} href={href} meta={<SubjectLink subject={data.subject} />}>
        {a.custom && <span className="badge b-neutral">Custom</span>}
      </Head>
      <p className="ans">
        <StateWords answer={a} />
      </p>
      <p className="w-text summary">{answerText(a.summary)}</p>
      <div className="wf">
        {a.development_ids.length > 0 ? (
          <Link href={evidence.answer(data.subject.id, a.question_id)} className="link" scroll={false}>
            See evidence
          </Link>
        ) : (
          <span className="w-meta">No sources in the last {a.lookback_days} days</span>
        )}
      </div>
    </>
  );
}

const SEVERITY = { needs_attention: 0, watch: 1, new: 2, stable: 3 } as const;

function SummaryBody({ data, widget, href }: BodyProps & { data: DataOf<"summary"> }) {
  const evidence = useEvidenceHref();
  // Most severe first, two columns of 34px rows: three rows at Medium, nine at Large.
  const answers = [...data.answers].sort((x, y) => SEVERITY[x.state] - SEVERITY[y.state]);
  const shown = answers.slice(0, widget.size === "L" ? 18 : 6);
  const hidden = answers.length - shown.length;
  return (
    <>
      <Head
        title="Standing questions"
        href={href}
        meta={
          <>
            <SubjectLink subject={data.subject} />
            {hidden > 0 && ` · ${hidden} more`}
          </>
        }
      />
      <div className="qtable">
        {shown.map((a) => {
          const cells = (
            <>
              <span className="ql">{a.label}</span>
              <span className="qa">
                <StateWords answer={a} />
              </span>
            </>
          );
          // Answers with sources open their evidence; the rest are plain rows.
          return a.development_ids.length > 0 ? (
            <Link
              key={a.question_id}
              href={evidence.answer(data.subject.id, a.question_id)}
              scroll={false}
              className="qr"
              aria-label={`${a.label}: ${stateText(a)}. See evidence`}
            >
              {cells}
            </Link>
          ) : (
            <div key={a.question_id} className="qr">
              {cells}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DevelopmentsBody({ data, widget, href }: BodyProps & { data: DataOf<"developments"> }) {
  // Medium fits three one-line rows; Large shows five with two-line titles.
  const large = widget.size === "L";
  const count = large ? 5 : 3;
  // A dashboard-wide widget's count opens the dashboard's developments list.
  const inScope = `${data.total} in scope`;
  const meta =
    data.scope.length === 1 ? (
      <SubjectLink subject={data.scope[0]} />
    ) : href ? (
      <Link href={href} className="scope-count">
        {inScope}
      </Link>
    ) : (
      inScope
    );
  return (
    <>
      <Head title="Developments" href={href} meta={meta} />
      <div className="rows">
        {data.developments.slice(0, count).map((d) => (
          <DevelopmentRow key={d.id} development={d} meta={false} lines={large ? 2 : 1} />
        ))}
        {data.developments.length === 0 && <p className="muted">No developments in scope.</p>}
      </div>
    </>
  );
}

const TREND = { rising: "Rising", flat: "Flat", falling: "Falling" } as const;
const SPARK = { width: 240, height: 40, pad: 3 };

function DirectionBody({ data, widget, href }: BodyProps & { data: DataOf<"direction"> }) {
  const counts = data.weeks.map((w) => w.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const step = SPARK.width / Math.max(1, counts.length - 1);
  const points = counts.map(
    (c, i) =>
      [i * step, SPARK.pad + (1 - (c - min) / (max - min || 1)) * (SPARK.height - 2 * SPARK.pad)] as const,
  );
  const last = points.at(-1);
  const first = data.weeks[0];
  return (
    <>
      <Head title="Direction of travel" href={href} meta={<SubjectLink subject={data.subject} />} />
      <p className="ans">{TREND[data.trend]}</p>
      {/* The latest week's dot sits outside the stretched SVG so it stays round. */}
      <span className="spark">
        <svg
          viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Material developments per week since ${first ? shortDate(first.week_start) : ""}: ${counts.join(", ")}`}
        >
          <polyline
            points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {last && (
          <span
            className="spark-dot"
            style={{ left: `${(last[0] / SPARK.width) * 100}%`, top: `${(last[1] / SPARK.height) * 100}%` }}
          />
        )}
      </span>
      <p className="w-meta">
        {widget.size === "S" ? `${data.this_week} this week, ${data.previous_average} a week before` : data.caption}
      </p>
    </>
  );
}

function UpcomingBody({ data, href }: BodyProps & { data: DataOf<"upcoming"> }) {
  const evidence = useEvidenceHref();
  const asOf = data.run.as_of;
  const [next, then] = data.items;
  const head = (
    <Head
      title="Upcoming"
      href={href}
      meta={
        <>
          <SubjectLink subject={data.subject} />
          {data.items.length > 2 && ` · ${data.items.length} dates`}
        </>
      }
    />
  );
  if (!next)
    return (
      <>
        {head}
        <p className="muted">No dates in the next 90 days.</p>
      </>
    );
  return (
    <>
      {head}
      <Link href={evidence.development(next.development_id)} scroll={false} className="up-next">
        <span className="ans">
          {shortDate(next.date)} <span className="w-meta">· {lower(inDays(daysBetween(asOf, next.date)))}</span>
        </span>
        <span className="w-text c2">{next.label}</span>
        <span className="w-meta c2">{next.development_title}</span>
      </Link>
      {then && (
        <div className="rows up-then">
          <Link href={evidence.development(then.development_id)} scroll={false} className="row no-stat">
            <span className="row-title one">{then.label}</span>
            <span className="row-end">{shortDate(then.date)}</span>
          </Link>
        </div>
      )}
    </>
  );
}

function WatchlistBody({ data, widget, onChange }: BodyProps & { data: DataOf<"watchlist"> }) {
  const large = widget.size === "L";
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const subjects = useSubjects();
  const ids = widget.type === "watchlist" ? widget.settings.entity_ids : [];

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? (subjects.data ?? [])
        .filter((s) => s.type === "entity" && !ids.includes(s.id))
        .filter((s) => [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(needle)))
        .slice(0, 6)
    : [];

  const add = (id: string) => {
    onChange(setEntities(widget, [...ids, id]));
    setQuery("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && matches[0]) {
      e.preventDefault();
      add(matches[0].id);
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
      setAdding(false);
    }
  };

  // Large always shows the add field; Medium opens it from the header to keep room for rows.
  const showField = large || adding;
  return (
    <>
      <Head title="Watchlist" meta={plural(data.entries.length, "entity", "entities")}>
        {!large && (
          <button
            type="button"
            className="btn-icon wh-end"
            aria-label={adding ? "Stop adding" : "Add an entity"}
            aria-expanded={adding}
            onClick={() => setAdding((a) => !a)}
          >
            {adding ? <XIcon /> : <PlusIcon size={14} />}
          </button>
        )}
      </Head>
      {showField && (
        <label className="field addfield">
          <PlusIcon size={14} />
          <input
            aria-label="Add an entity"
            placeholder="Add a bank, central bank, issuer or country"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            autoFocus={adding}
          />
        </label>
      )}
      {needle ? (
        <div className="rows scroll" role="listbox" aria-label="Matching entities">
          {matches.map((s) => (
            <button key={s.id} type="button" role="option" aria-selected={false} className="pick" onClick={() => add(s.id)}>
              <SubjectIcon subject={s} />
              <span className="pick-name">{s.name}</span>
              {s.new_developments > 0 && <span className="w-meta">{s.new_developments} new</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="muted">No entity matches “{query.trim()}”.</p>}
        </div>
      ) : (
        <div className="rows scroll">
          {data.entries.map((e) => (
            <WatchRow
              key={e.entity.id}
              entry={e}
              lines={large ? 2 : 1}
              onRemove={() => onChange(setEntities(widget, ids.filter((i) => i !== e.entity.id)))}
            />
          ))}
          {data.entries.length === 0 && <p className="muted">No entities yet. Add one above.</p>}
        </div>
      )}
    </>
  );
}

function WatchRow({
  entry: e,
  lines,
  onRemove,
}: {
  entry: Schema<"WatchlistEntry">;
  lines: 1 | 2;
  onRemove: () => void;
}) {
  const counts = [e.new_developments > 0 && `${e.new_developments} new`, e.needs_attention > 0 && needs(e.needs_attention)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ent">
      <span className="stat">
        <StateBadge state={e.state} newCount={e.new_developments} />
      </span>
      <span className="ent-body">
        <span className="ent-name">
          <SubjectIcon subject={e.entity} size={20} />
          <Link href={monitorHref(e.entity.id)} className="stretch">
            {e.entity.name}
          </Link>
          {counts && <span className="w-meta">{counts}</span>}
        </span>
        <span className={lines === 1 ? "w-text c1" : "w-text c2"}>
          {e.headline ? (
            <>
              <span className="ink2">{e.headline.label}:</span> {answerText(e.headline.summary)}
            </>
          ) : (
            e.groups.map((g) => g.name).join(", ")
          )}
        </span>
        {lines === 2 && e.latest && (
          <span className="ent-latest w-meta">
            <span>{e.latest.title}</span>
            <span>{shortDate(e.latest.last_published)}</span>
          </span>
        )}
      </span>
      <button type="button" className="btn-icon" aria-label={`Remove ${e.entity.name}`} onClick={onRemove}>
        <XIcon />
      </button>
    </div>
  );
}
