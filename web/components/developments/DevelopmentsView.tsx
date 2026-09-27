"use client";

// A dashboard's developments in the latest run, across all its subjects: what a dashboard-wide
// Since or Developments widget opens, counting what the widget counts. The changed view is the
// monitor page's What changed section, with its triage; the other lists every development. An
// interim view until the developments list with facets replaces it.
import Link from "next/link";

import { useDashboard, useDevelopments, useSubjects, useWhatChanged, type Dashboard } from "@/lib/api/queries";
import { plural, TYPE_PLURAL } from "@/lib/format";
import { developmentsHref, type SubjectType } from "@/lib/widgets";
import { Section } from "@/components/monitor/parts";
import { WhatChanged } from "@/components/monitor/WhatChanged";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { DevelopmentRow } from "@/components/widgets/parts";

const TYPES: SubjectType[] = ["topic", "group", "entity"];

export function DevelopmentsView({ dashboardId, changed }: { dashboardId: string; changed: boolean }) {
  const dashboard = useDashboard(dashboardId);
  const subjects = useSubjects();
  const d = dashboard.data;
  if (dashboard.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!d) return null;

  const scope = d.subject_ids.flatMap((id) => subjects.data?.find((s) => s.id === id) ?? []);

  return (
    <>
      <div className="mon-head">
        <h1>{d.name}</h1>
      </div>
      <div className="monitor">
        <div className="panel mon-main">
          {changed ? <Changed dashboard={d} /> : <All dashboard={d} />}
        </div>
        <aside className="panel mon-rail" aria-label="Links">
          <Section id="links" title="Links">
            <dl className="mon-links">
              {TYPES.map((type) => {
                const of = scope.filter((s) => s.type === type);
                return (
                  of.length > 0 && (
                    <div key={type}>
                      <dt>{TYPE_PLURAL[type]}</dt>
                      <dd>
                        {of.map((s) => (
                          <SubjectLink key={s.id} subject={s} />
                        ))}
                      </dd>
                    </div>
                  )
                );
              })}
            </dl>
            <Link href={`/dashboards/${d.id}`} className="link">
              Open dashboard
            </Link>
          </Section>
        </aside>
      </div>
    </>
  );
}

/** What changed since the review of the dashboard's subjects, as its Since widget counts it. */
function Changed({ dashboard }: { dashboard: Dashboard }) {
  const wc = useWhatChanged({ dashboard_id: dashboard.id });
  if (wc.isError) return <p className="mon-empty">What changed could not be loaded.</p>;
  if (!wc.data) return null;
  return (
    <>
      <WhatChanged wc={wc.data} />
      <p className="mon-more">
        <Link href={developmentsHref(dashboard.id, false)} className="link">
          All developments
        </Link>
      </p>
    </>
  );
}

/** Every development of the dashboard's subjects in the latest run. */
function All({ dashboard }: { dashboard: Dashboard }) {
  const developments = useDevelopments({ dashboard_id: dashboard.id });
  const list = developments.data;
  if (developments.isError) return <p className="mon-empty">These developments could not be loaded.</p>;
  if (!list) return null;
  const attention = list.filter((x) => x.needs_attention).length;
  return (
    <Section
      id="developments"
      title="Developments"
      meta={
        <Link href={developmentsHref(dashboard.id, true)} className="link">
          What changed
        </Link>
      }
    >
      <p className="mon-lead">
        {[plural(list.length, "development"), attention > 0 && `${attention} ${attention === 1 ? "needs" : "need"} attention`]
          .filter(Boolean)
          .join(", ")}
      </p>
      {list.length > 0 && (
        <div className="rows">
          {list.map((x) => (
            <DevelopmentRow key={x.id} development={x} />
          ))}
        </div>
      )}
    </Section>
  );
}
