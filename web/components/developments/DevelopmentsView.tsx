"use client";

// A dashboard's developments in the latest run, across all its subjects: what a dashboard-wide
// Since or Developments widget opens, counting what the widget counts. A filter bar narrows the
// list by facets and the table sorts by its columns; both live in the URL. What changed
// (`changed=1`) lists the developments changed since the review with the monitor page's triage.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, type ReactNode, type Ref } from "react";

import type { Schema } from "@/lib/api/client";
import { useDashboard, useDevelopments, useSubjects, useWhatChanged } from "@/lib/api/queries";
import { filtered as isFiltered, listQuery, sortList, sortOf, withoutFilters, withSort, type SortKey } from "@/lib/developments";
import { capitalize, COLLECTION_LABEL, plural, shortDate } from "@/lib/format";
import { Dotted } from "@/components/monitor/parts";
import {
  AnswerChanges,
  isFolded,
  TRIAGE_EMPTY,
  TRIAGE_FILTERS,
  TriageEnd,
  TriageFilters,
  useTriage,
  whatChangedLead,
  type Triage,
  type TriageFilterId,
} from "@/components/monitor/WhatChanged";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLink, SubjectLinks } from "@/components/shell/SubjectLink";
import { ChevronDownIcon, ChevronIcon, ChevronUpIcon } from "@/components/ui/icons";
import { DevelopmentBadge } from "@/components/widgets/parts";

import { FilterBar } from "./FilterBar";

type Listed = Schema<"ChangedDevelopment">;

export function DevelopmentsView({ dashboardId }: { dashboardId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const changed = params.get("changed") === "1";
  const dashboard = useDashboard(dashboardId);
  const subjects = useSubjects();
  const wc = useWhatChanged({ dashboard_id: dashboardId });
  // Once the dashboard is reviewed with nothing new since, What changed lists the run's changes.
  const folded = wc.data ? isFolded(wc.data) : false;
  const list = useDevelopments(
    listQuery(dashboardId, params, changed ? (folded ? "run" : "review") : undefined),
    !changed || wc.data !== undefined,
  );
  // The native history API updates useSearchParams without a server round trip.
  const onParams = useCallback((next: URLSearchParams) => window.history.replaceState(null, "", `${pathname}?${next}`), [pathname]);

  const d = dashboard.data;
  if (dashboard.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!d) return null;
  const scope = d.subject_ids.flatMap((id) => subjects.data?.find((s) => s.id === id) ?? []);
  const data = list.data;
  const newCount = wc.data?.new_count ?? 0;

  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>Developments</h1>
          <p>
            <Link href={`/dashboards/${d.id}`} className="subject-link">
              {d.name}
            </Link>{" "}
            dashboard: <SubjectLinks subjects={scope} />
            {data && ` · ${plural(data.in_scope, "development")}${newCount > 0 ? `, ${newCount} new` : ""}`}
          </p>
        </div>
      </div>
      <FilterBar
        params={params}
        facets={data?.facets}
        counts={data && { all: data.matching, changed: data.unreviewed }}
        changed={changed}
        onParams={onParams}
      />
      <div className="panel dv-table">
        {list.isError ? (
          <p className="mon-empty">
            These developments could not be loaded. <ClearFilters params={params} onParams={onParams} />
          </p>
        ) : !data ? null : changed && wc.data ? (
          <Changed key={String(folded)} data={data} wc={wc.data} folded={folded} params={params} onParams={onParams} />
        ) : (
          <Table developments={data.developments} params={params} onParams={onParams} />
        )}
      </div>
    </>
  );
}

/**
 * What changed since the review, as the dashboard's Since widget counts it, with the monitor page's
 * triage filter and row actions. Once reviewed with nothing new, the run's changes fold behind a line.
 */
function Changed({
  data,
  wc,
  folded,
  params,
  onParams,
}: {
  data: Schema<"DevelopmentList">;
  wc: Schema<"WhatChanged">;
  folded: boolean;
  params: URLSearchParams;
  onParams: (next: URLSearchParams) => void;
}) {
  const [filter, setFilter] = useState<TriageFilterId>("all");
  const [earlier, setEarlier] = useState(false);
  const developments = data.developments;
  const active = TRIAGE_FILTERS.find((f) => f.id === filter) ?? TRIAGE_FILTERS[0];
  const shown = developments.filter(active.test);
  const { list, seg, act } = useTriage<HTMLTableSectionElement>(active, shown);
  // Answers are not developments, so facets leave them out: they show while nothing is filtered.
  const questions = isFiltered(params) ? [] : folded ? wc.question_changes : wc.question_changes.filter((c) => c.unreviewed);
  const open = !folded || earlier;
  const runParts = [
    plural(developments.filter(TRIAGE_FILTERS[0].test).length, "development"),
    questions.length > 0 && `${plural(questions.length, "answer")} changed`,
  ];

  return (
    <>
      <div className="lead-row">
        <p className="mon-lead">{whatChangedLead(data, folded, developments.length)}</p>
        {open && developments.length > 0 && <TriageFilters developments={developments} filter={filter} onChange={setFilter} segRef={seg} />}
      </div>
      {folded && (developments.length > 0 || questions.length > 0) && (
        <button type="button" className="earlier" aria-expanded={earlier} onClick={() => setEarlier((e) => !e)}>
          <ChevronIcon />
          <Dotted parts={[`Run of ${shortDate(wc.run.as_of)}`, runParts.filter(Boolean).join(", ")]} />
        </button>
      )}
      {open &&
        (shown.length > 0 ? (
          <Table
            developments={shown}
            params={params}
            onParams={onParams}
            bodyRef={list}
            onTriage={act}
          />
        ) : developments.length > 0 ? (
          <p className="mon-empty">{TRIAGE_EMPTY[filter]}</p>
        ) : (
          isFiltered(params) && <NoMatch params={params} onParams={onParams} />
        ))}
      {open && filter === "all" && <AnswerChanges changes={questions} />}
    </>
  );
}

type ParamsProps = { params: URLSearchParams; onParams: (next: URLSearchParams) => void };

/** An empty list: nothing in scope, or nothing matching the filters, with a way to clear them. */
function NoMatch({ params, onParams }: ParamsProps) {
  if (!isFiltered(params)) return <p className="mon-empty">No developments in scope.</p>;
  return (
    <p className="mon-empty">
      No developments match the filters. <ClearFilters params={params} onParams={onParams} />
    </p>
  );
}

function ClearFilters({ params, onParams }: ParamsProps) {
  return (
    <button type="button" className="link" onClick={() => onParams(withoutFilters(params))}>
      Clear filters
    </button>
  );
}

// Column widths are in styles/developments.css (`.c-<key>`); the title takes the rest.
const COLUMNS: { key: SortKey | null; label: string; num?: boolean }[] = [
  { key: "status", label: "Status" },
  { key: null, label: "" },
  { key: "subjects", label: "Subjects" },
  { key: "category", label: "Category" },
  { key: "materiality", label: "Materiality" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "sources", label: "Sources" },
  { key: "date", label: "Date", num: true },
];

/**
 * Developments as a table sorted by the URL's column. With `onTriage`, each row's date gives way to
 * Mark read, Flag and Dismiss while the pointer is over it or focus is in it, and a read row drops
 * its New or Updated badge.
 */
function Table({
  developments,
  params,
  onParams,
  bodyRef,
  onTriage,
}: {
  developments: Listed[];
  params: URLSearchParams;
  onParams: (next: URLSearchParams) => void;
  bodyRef?: Ref<HTMLTableSectionElement>;
  onTriage?: (d: Listed, index: number, action: number, change: Triage) => void;
}) {
  const evidence = useEvidenceHref();
  const sort = sortOf(params);
  const rows = sortList(developments, sort);
  if (rows.length === 0) return <NoMatch params={params} onParams={onParams} />;
  return (
    <table className={`dtable${onTriage ? " triaged" : ""}`}>
      <colgroup>
        {COLUMNS.map((c, i) => (
          <col key={i} className={c.key ? `c-${c.key}` : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map((c, i) => {
            const on = c.key !== null && sort.key === c.key;
            return (
              <th
                key={i}
                scope="col"
                className={[c.num && "num", on && "sorted"].filter(Boolean).join(" ") || undefined}
                aria-sort={on ? (sort.order === "asc" ? "ascending" : "descending") : undefined}
              >
                {c.key === null ? (
                  plural(rows.length, "development")
                ) : (
                  <button type="button" className="th-sort" onClick={() => onParams(withSort(params, c.key ?? "status"))}>
                    {c.label}
                    {on && (sort.order === "asc" ? <ChevronUpIcon /> : <ChevronDownIcon />)}
                  </button>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody ref={bodyRef}>
        {rows.map((d, i) => (
          <tr key={d.id} className={onTriage ? "triage" : undefined}>
            <td className="st">
              <DevelopmentBadge development={d.read ? { ...d, change: null } : d} />
            </td>
            <td className="tt">
              <Link href={evidence.development(d.id)} scroll={false} title={d.title}>
                {d.title}
              </Link>
            </td>
            <td>
              <Subjects development={d} />
            </td>
            <td>{capitalize(d.category)}</td>
            <td>{d.materiality_label}</td>
            <td title={d.jurisdictions.join(", ")}>{d.jurisdictions.join(", ")}</td>
            <td title={d.collections.map((c) => COLLECTION_LABEL[c]).join(", ")}>
              {[d.collections.map((c) => COLLECTION_LABEL[c]).join(", "), d.source_count].join(" · ")}
            </td>
            <td className="num">
              {onTriage ? (
                <TriageEnd development={d} onChange={(action, change) => onTriage(d, i, action, change)} />
              ) : (
                shortDate(d.last_published)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The first subject as a link, then how many more. */
function Subjects({ development: d }: { development: Listed }): ReactNode {
  const [first, ...rest] = d.subjects;
  if (!first) return null;
  return (
    <>
      <SubjectLink subject={first} />
      {rest.length > 0 && ` +${rest.length}`}
    </>
  );
}
