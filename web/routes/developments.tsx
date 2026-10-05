import { createFileRoute } from "@tanstack/react-router";

import { DevelopmentsView } from "@/components/developments/DevelopmentsView";

// `/developments?dashboard=<id>` lists a dashboard's developments; `&changed=1` lists What changed
// since the review. Facet filters and the sort are further parameters (lib/developments.ts).
export const Route = createFileRoute("/developments")({
  validateSearch: (search): { dashboard?: string; changed?: string } => ({
    ...search,
    dashboard: typeof search.dashboard === "string" ? search.dashboard : undefined,
    changed: typeof search.changed === "string" ? search.changed : undefined,
  }),
  component: DevelopmentsPage,
});

function DevelopmentsPage() {
  const { dashboard } = Route.useSearch();
  if (!dashboard) return <p className="page-message">Open developments from a dashboard.</p>;
  return <DevelopmentsView key={dashboard} dashboardId={dashboard} />;
}
