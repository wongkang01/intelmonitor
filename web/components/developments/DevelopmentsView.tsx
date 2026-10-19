// A dashboard's developments across all its subjects (`/developments?dashboard=<id>`): the feed with
// the words filter, highest priority first. The period and filters live in the URL.
import { Link } from "@tanstack/react-router";

import { useDashboard, useSubjects } from "@/lib/api/queries";
import { SubjectLinks } from "@/components/shell/SubjectLink";

import { Feed } from "./Feed";

export function DevelopmentsView({ dashboardId }: { dashboardId: string }) {
  const dashboard = useDashboard(dashboardId);
  const subjects = useSubjects();
  const d = dashboard.data;
  if (dashboard.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!d) return null;
  const scope = d.subject_ids.flatMap((id) => subjects.data?.find((s) => s.id === id) ?? []);

  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>Developments</h1>
          <p>
            <Link to="/dashboards/$id" params={{ id: d.id }} className="subject-link">
              {d.name}
            </Link>{" "}
            dashboard: <SubjectLinks subjects={scope} />
          </p>
        </div>
      </div>
      <div className="panel dv-feed">
        <Feed scope={{ dashboard_id: dashboardId }} view={{ dashboard: dashboardId }} words />
      </div>
    </>
  );
}
