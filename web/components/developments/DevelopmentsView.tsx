"use client";

// A dashboard's developments in the latest run, across all its subjects: what a dashboard-wide
// Since or Developments widget opens, counting what the widget counts. An interim view built from
// the monitor page's What changed pieces, until the developments list with facets replaces it.
import Link from "next/link";

import { useDashboard, useDevelopments, useSubjects } from "@/lib/api/queries";
import { changeCounts, plural, TYPE_PLURAL } from "@/lib/format";
import { developmentsHref, type SubjectType } from "@/lib/widgets";
import { Section } from "@/components/monitor/parts";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { DevelopmentRow } from "@/components/widgets/parts";

const TYPES: SubjectType[] = ["topic", "group", "entity"];

export function DevelopmentsView({ dashboardId, changed }: { dashboardId: string; changed: boolean }) {
  const dashboard = useDashboard(dashboardId);
  const developments = useDevelopments({ dashboard_id: dashboardId, changed });
  const subjects = useSubjects();
  const d = dashboard.data;
  const list = developments.data;
  if (dashboard.isError || developments.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!d || !list) return null;

  const scope = d.subject_ids.flatMap((id) => subjects.data?.find((s) => s.id === id) ?? []);
  const attention = list.filter((x) => x.needs_attention).length;
  const lead = changed
    ? changeCounts({
        new_count: list.filter((x) => x.change === "new").length,
        updated_count: list.filter((x) => x.change === "updated").length,
        needs_attention_count: attention,
      }) || "Nothing new or updated"
    : [plural(list.length, "development"), attention > 0 && `${attention} ${attention === 1 ? "needs" : "need"} attention`]
        .filter(Boolean)
        .join(", ");

  return (
    <>
      <div className="mon-head">
        <h1>{d.name}</h1>
      </div>
      <div className="monitor">
        <div className="panel mon-main">
          <Section
            id="developments"
            title={changed ? "What changed since last review" : "Developments"}
            meta={
              <Link href={developmentsHref(d.id, !changed)} className="link">
                {changed ? "All developments" : "What changed"}
              </Link>
            }
          >
            <p className="mon-lead">{lead}</p>
            {list.length > 0 && (
              <div className="rows">
                {list.map((x) => (
                  <DevelopmentRow key={x.id} development={x} />
                ))}
              </div>
            )}
          </Section>
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
