"use client";

// The Indicator widget (structured-data-plan.md, F5; mocks/indicators.html, F5 B "State first"):
// the series' status is the answer and code writes the sentence. S adds the source; M puts a
// 12-month line beside the sentence; L puts the line under it with its scale, and the subject's
// Needs attention and Watch developments on a lane under the line, the latest two as rows.
import Link from "next/link";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import type { DataOf } from "@/lib/api/queries";
import {
  INDICATOR_STATE_LABEL,
  indicatorSentence,
  longDate,
  monthYear,
  plural,
  shortDate,
  STATE_LABEL,
  STATE_TONE,
} from "@/lib/format";
import { monitorHref } from "@/lib/widgets";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { IndicatorLine, yearAxis } from "@/components/monitor/Indicators";

import type { BodyProps } from "./bodies";
import { Head } from "./parts";

type Indicator = Schema<"SubjectIndicator">;
type Marked = Schema<"MarkedDevelopment">;

/** No data and Stale are the data's own states, in grey; otherwise the detector status in its color. */
function Status({ ind }: { ind: Indicator }) {
  if (ind.state === "no_data" || ind.state === "stale") return <span className="ink2">{INDICATOR_STATE_LABEL[ind.state]}</span>;
  return <span className={`c-${STATE_TONE[ind.status]}`}>{STATE_LABEL[ind.status]}</span>;
}

export function IndicatorBody({ data, widget, href }: BodyProps & { data: DataOf<"indicator"> }) {
  const evidence = useEvidenceHref();
  const [active, setActive] = useState<string | null>(null);
  const ind = data.indicator;
  const s = ind.series;
  const asOf = data.run.as_of;
  const sentence = indicatorSentence(ind, asOf);
  const head = (
    <>
      <Head title={s.name} href={href} meta={<SubjectLink subject={data.subject} />} />
      <p className="ans">
        <Status ind={ind} />
      </p>
    </>
  );

  if (widget.size === "S") {
    // A status from a detector event opens the development carrying it, as on the monitor page.
    const developmentId = ind.state === "no_data" ? null : ind.events.find((e) => e.development_id)?.development_id;
    return (
      <>
        {head}
        <p className="w-text summary">{sentence}</p>
        <div className="wf">
          {developmentId ? (
            <Link href={evidence.development(developmentId)} className="link" scroll={false}>
              See development
            </Link>
          ) : (
            <Link href={`${monitorHref(data.subject.id)}#indicators`} className="link">
              See data
            </Link>
          )}
          <span className="w-meta">{s.providers.join(", ")}</span>
        </div>
      </>
    );
  }

  if (widget.size === "M") {
    return (
      <>
        {head}
        <div className="ind-wm">
          <p className="w-text summary">{sentence}</p>
          <IndicatorLine ind={ind} name={s.name} asOf={asOf} className="ind-line ind-wm-line" />
        </div>
      </>
    );
  }

  const rows = data.developments.slice(0, 2);
  const axis = yearAxis(asOf);
  // The stretch before the first document, in percent of the axis.
  const empty = Math.min(100, Math.max(0, axis.x(data.documents_from)));
  return (
    <>
      {head}
      <p className="w-text c2">{sentence}</p>
      <IndicatorLine ind={ind} name={s.name} asOf={asOf} className="ind-line ind-wl" labels />
      <Lane marks={data.developments} empty={empty} asOf={asOf} active={active} onActive={setActive} />
      <span className="ind-xa">
        <span>{monthYear(axis.start)}</span>
        {/* Under the lane rather than in it, so markers dated before the first document (events
            reported later) never cross the words; they end where the documents start, clear of
            the start date when the stretch is over a third of the axis. */}
        {empty > 33 && (
          <span className="ind-none-label" style={{ right: `${100 - empty}%` }}>
            No documents before {shortDate(data.documents_from)}
          </span>
        )}
        <span>{shortDate(asOf)}</span>
      </span>
      {rows.length > 0 && (
        <div className="rows ind-wrows">
          {rows.map((m) => (
            <Link
              key={m.development.id}
              href={evidence.development(m.development.id)}
              scroll={false}
              className={`row no-stat${active === m.on ? " on" : ""}`}
              onPointerEnter={() => setActive(m.on)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="row-title one">{m.development.title}</span>
              <span className="row-end">{shortDate(m.on)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

const BADGE_LABEL: Record<Marked["badge"], string> = { needs_attention: "Needs attention", watch: "Watch" };
// Titles a marker's tooltip lists before "N more".
const TIP_TITLES = 3;
// A marker's tooltip opens to its left when there is less room than this to its right.
const TIP_ROOM = 320;

/**
 * Developments on the line's time axis, one marker per day at its event date, each opening its
 * most pressing development; the tooltip lists the day's titles with status and publication.
 * A hairline spans the `empty` percent before the first document, which the axis names.
 */
function Lane({
  marks,
  empty,
  asOf,
  active,
  onActive,
}: {
  marks: Marked[];
  empty: number;
  asOf: string;
  active: string | null;
  onActive: (on: string | null) => void;
}) {
  const evidence = useEvidenceHref();
  const [tip, setTip] = useState<{ on: string; x: number; y: number } | null>(null);
  const { x } = yearAxis(asOf);
  const days = new Map<string, Marked[]>();
  for (const m of marks) days.set(m.on, [...(days.get(m.on) ?? []), m]);
  // Needs attention first within a day; the marker opens the first.
  for (const list of days.values()) list.sort((a, b) => Number(b.badge === "needs_attention") - Number(a.badge === "needs_attention"));
  const shown = tip ? (days.get(tip.on) ?? []) : [];

  const open = (on: string, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    setTip({ on, x: box.left + box.width / 2, y: box.top });
    onActive(on);
  };
  const close = () => {
    setTip(null);
    onActive(null);
  };

  return (
    <span className="ind-lane">
      {empty > 0 && <span className="ind-none" style={{ width: `${empty}%` }} />}
      {/* Oldest first, so a later day's marker sits on top where hit areas overlap. */}
      {[...days].reverse().map(([on, list]) => (
        <Link
          key={on}
          href={evidence.development(list[0].development.id)}
          scroll={false}
          className={`ind-tk${active === on ? " on" : ""}`}
          style={{ left: `${x(on)}%` }}
          aria-label={`${shortDate(on)}: ${plural(list.length, "development")}`}
          onPointerEnter={(e) => open(on, e.currentTarget)}
          onPointerLeave={close}
          onFocus={(e) => open(on, e.currentTarget)}
          onBlur={close}
        />
      ))}
      {tip && shown.length > 0 && (
        <span
          className={`chart-tip wrap${tip.x + TIP_ROOM > window.innerWidth ? " before" : ""}`}
          role="tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          <b>{tip.on.slice(0, 4) === asOf.slice(0, 4) ? shortDate(tip.on) : longDate(tip.on)}</b>
          {shown.slice(0, TIP_TITLES).map((m) => (
            <span key={m.development.id} className="tip-item">
              <span className="tip-title">{m.development.title}</span>
              <span>
                {BADGE_LABEL[m.badge]} · published {shortDate(m.development.first_published)}
              </span>
            </span>
          ))}
          {shown.length > TIP_TITLES && <span>{shown.length - TIP_TITLES} more</span>}
        </span>
      )}
    </span>
  );
}
