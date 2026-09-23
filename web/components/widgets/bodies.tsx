"use client";

// The seven widget bodies. Each renders one widget's data from the API at its size.
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

import type { Schema, Widget, WidgetData } from "@/lib/api/client";
import { useMarkReviewed, useSubjects, type DataOf } from "@/lib/api/queries";
import {
  dateTime,
  daysBetween,
  inDays,
  initials,
  plural,
  shortDate,
  STATE_TONE,
} from "@/lib/format";
import { monitorHref, setEntities } from "@/lib/widgets";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import { useEvidenceHref } from "@/components/shell/Evidence";

import { DevelopmentRow, Head, StateBadge, stateText } from "./parts";

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
  }
}

function SinceBody({ data, widget, href }: BodyProps & { data: DataOf<"since"> }) {
  const wc = data.what_changed;
  const review = useMarkReviewed();
  const large = widget.size === "L";
  const hero = `${wc.new_count} new, ${wc.needs_attention_count} ${wc.needs_attention_count === 1 ? "needs" : "need"} attention`;
  const changes = [
    wc.updated_count ? `${wc.updated_count} updated` : null,
    plural(wc.question_changes.length, "answer") + " changed",
  ].filter(Boolean);
  const meta = data.scope.length === 1 ? data.scope[0].name : `Run of ${shortDate(data.run.as_of)}`;
  return (
    <>
      <Head title="Since your last review" href={href} meta={meta} />
      <p className={`hero one-line${large ? "" : " sm"}`} title={hero}>
        {hero}
      </p>
      <div className="rows">
        {wc.developments.slice(0, large ? 4 : 1).map((d) => (
          <DevelopmentRow key={d.id} development={d} />
        ))}
      </div>
      {large && (
        <>
          <span className="spacer" />
          <div className="foot">
            <button
              type="button"
              className="link"
              disabled={review.isPending}
              onClick={() => review.mutate(data.scope.map((s) => s.id))}
            >
              Mark all reviewed
            </button>
            <span className="cap">
              {data.reviewed_at ? `Reviewed ${dateTime(data.reviewed_at)}` : changes.join(", ")}
            </span>
          </div>
        </>
      )}
    </>
  );
}

function QuestionBody({ data, widget, href }: BodyProps & { data: DataOf<"question"> }) {
  const a = data.answer;
  const evidence = useEvidenceHref();
  const small = widget.size === "S";
  const first = a.development_ids[0];
  return (
    <>
      <Head title={`${a.label} · ${data.subject.name}`} href={href}>
        {a.custom && <span className="tag custom">Custom</span>}
      </Head>
      <span className={`big c-${STATE_TONE[a.state]}`} style={{ fontSize: small ? 18 : 22, lineHeight: small ? "22px" : "27px" }}>
        {stateText(a)}
      </span>
      <p className="body-text summary" style={{ WebkitLineClamp: small ? 2 : 3 }}>
        {a.summary}
      </p>
      <span className="spacer" />
      {first ? (
        <Link href={evidence(first)} className="link" scroll={false}>
          See evidence
        </Link>
      ) : (
        <span className="cap">No sources in the last {a.lookback_days} days</span>
      )}
    </>
  );
}

const SEVERITY = { needs_attention: 0, watch: 1, new: 2, stable: 3 } as const;

function SummaryBody({ data, widget, href }: BodyProps & { data: DataOf<"summary"> }) {
  const large = widget.size === "L";
  // Most severe first; a medium widget shows the first six.
  const answers = [...data.answers].sort((x, y) => SEVERITY[x.state] - SEVERITY[y.state]);
  const shown = large ? answers : answers.slice(0, 6);
  const hidden = answers.length - shown.length;
  return (
    <>
      <Head
        title="Standing questions"
        href={href}
        meta={hidden > 0 ? `${data.subject.name}, ${hidden} more` : data.subject.name}
      />
      <div className="qgrid">
        {shown.map((a) => {
          const tone = STATE_TONE[a.state];
          return (
            <div key={a.question_id} className={`q ${tone === "watch" || tone === "attn" ? tone : ""}`}>
              <span>{a.label}</span>
              <b className={`c-${tone}`} title={stateText(a)}>
                {stateText(a)}
              </b>
              {large && <p style={{ WebkitLineClamp: 2 }}>{a.summary}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DevelopmentsBody({ data, widget, href }: BodyProps & { data: DataOf<"developments"> }) {
  const count = widget.size === "L" ? 5 : 2;
  const meta = data.scope.length === 1 ? data.scope[0].name : `${data.total} in scope`;
  return (
    <>
      <Head title="Developments" href={href} meta={meta} />
      <div className="rows">
        {data.developments.slice(0, count).map((d) => (
          <DevelopmentRow key={d.id} development={d} />
        ))}
        {data.developments.length === 0 && <p className="muted">No developments in scope.</p>}
      </div>
    </>
  );
}

const TREND = {
  rising: { word: "Rising", color: "var(--watch)" },
  flat: { word: "Flat", color: "var(--ink3)" },
  falling: { word: "Falling", color: "var(--stable)" },
} as const;

function DirectionBody({ data, widget, href }: BodyProps & { data: DataOf<"direction"> }) {
  const small = widget.size === "S";
  const trend = TREND[data.trend];
  const counts = data.weeks.map((w) => w.count);
  const max = Math.max(1, ...counts);
  const width = 200;
  const height = 44;
  const points = counts
    .map((c, i) => `${((i * width) / (counts.length - 1)).toFixed(1)},${(3 + (1 - c / max) * (height - 6)).toFixed(1)}`)
    .join(" ");
  const first = data.weeks[0];
  return (
    <>
      <Head title="Direction of travel" href={href} meta={data.subject.name} />
      <span className="big">{trend.word}</span>
      <svg
        className="spark"
        width="100%"
        height={small ? 32 : 44}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Material developments per week since ${first ? shortDate(first.week_start) : ""}: ${counts.join(", ")}`}
      >
        <polyline
          points={points}
          fill="none"
          stroke={trend.color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="cap">
        {small ? `${data.this_week} this week, ${data.previous_average} a week before` : data.caption}
      </span>
    </>
  );
}

function UpcomingBody({ data, widget, href }: BodyProps & { data: DataOf<"upcoming"> }) {
  const evidence = useEvidenceHref();
  const asOf = data.run.as_of;
  const [next] = data.items;
  if (!next)
    return (
      <>
        <Head title="Upcoming" href={href} meta={data.subject.name} />
        <p className="muted">No dates in the next 90 days.</p>
      </>
    );
  if (widget.size === "S")
    return (
      <>
        <Head title="Upcoming" href={href} meta={data.subject.name} />
        <Link href={evidence(next.development_id)} scroll={false} style={{ color: "inherit", display: "contents" }}>
          <span className="big" style={{ fontSize: 28 }}>
            {shortDate(next.date)}
          </span>
          <span className="body-text" style={{ fontSize: 14, lineHeight: "19px", fontWeight: 500, WebkitLineClamp: 2 }}>
            {next.label}
          </span>
        </Link>
        <span className="spacer" />
        <span className="cap">{inDays(daysBetween(asOf, next.date))}</span>
      </>
    );
  return (
    <>
      <Head
        title="Upcoming"
        href={href}
        meta={data.items.length > 2 ? `${data.subject.name}, ${data.items.length} dates` : data.subject.name}
      />
      <div className="rows">
        {data.items.slice(0, 2).map((item) => (
          <Link key={`${item.development_id}-${item.date}`} href={evidence(item.development_id)} className="row" scroll={false}>
            <span className="date">{shortDate(item.date)}</span>
            <span className="tx">
              <b>{item.label}</b>
              <span>{inDays(daysBetween(asOf, item.date))}</span>
            </span>
          </Link>
        ))}
      </div>
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

  const showField = large || adding;
  return (
    <>
      <Head title="Watchlist" meta={`${plural(data.entries.length, "entity", "entities")} tracked`}>
        {!large && (
          <button
            type="button"
            className="icon-btn"
            aria-label={adding ? "Stop adding" : "Add an entity"}
            aria-expanded={adding}
            onClick={() => setAdding((a) => !a)}
            style={{ marginLeft: "auto", order: 2 }}
          >
            {adding ? <XIcon /> : <PlusIcon color="#0A64D8" size={14} />}
          </button>
        )}
      </Head>
      {showField && (
        <label className="addfield">
          <PlusIcon color="#0A64D8" size={14} />
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
              <span className="ini">{initials(s.name)}</span>
              {s.name}
              {s.new_developments > 0 && <span className="cap">{s.new_developments} new</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="muted">No entity matches “{query.trim()}”.</p>}
        </div>
      ) : (
        <div className="rows scroll">
          {data.entries.map((e) => (
            <WatchRow key={e.entity.id} entry={e} onRemove={() => onChange(setEntities(widget, ids.filter((i) => i !== e.entity.id)))} />
          ))}
          {data.entries.length === 0 && <p className="muted">No entities yet. Add one above.</p>}
        </div>
      )}
    </>
  );
}

function WatchRow({ entry: e, onRemove }: { entry: Schema<"WatchlistEntry">; onRemove: () => void }) {
  const sub = e.headline ? `${e.headline.label}: ${e.headline.summary}` : e.groups.map((g) => g.name).join(", ");
  return (
    <div className="row tight">
      <Link href={monitorHref(e.entity.id)} className="row" style={{ padding: 0, border: 0, flexGrow: 1, minWidth: 0 }}>
        <span className="ini" aria-hidden="true">
          {initials(e.entity.name)}
        </span>
        <span className="tx">
          <b>{e.entity.name}</b>
          <span>{sub}</span>
        </span>
        <StateBadge state={e.state} newCount={e.new_developments} />
      </Link>
      <button type="button" className="icon-btn" aria-label={`Remove ${e.entity.name}`} onClick={onRemove}>
        <XIcon />
      </button>
    </div>
  );
}
