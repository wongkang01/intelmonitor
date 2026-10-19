import { createFileRoute, redirect } from "@tanstack/react-router";

import { scopeParam } from "@/components/developments/link";

// The old address of a development's own page, `/developments/<id>?subject=<id>` or
// `?dashboard=<id>`. It opens the development's popup on the scope's page, or on the default
// dashboard without a scope.
export const Route = createFileRoute("/developments_/$id")({
  validateSearch: (search): { subject?: string; dashboard?: string } => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
    dashboard: typeof search.dashboard === "string" ? search.dashboard : undefined,
  }),
  beforeLoad: ({ params, search: { subject, dashboard } }) => {
    const scope = subject ? { subject } : dashboard ? { dashboard } : {};
    const popup = { development: params.id, scope: scopeParam(scope) };
    if (scope.subject) throw redirect({ to: "/monitors/$id", params: { id: scope.subject }, search: popup, replace: true });
    if (scope.dashboard) throw redirect({ to: "/dashboards/$id", params: { id: scope.dashboard }, search: popup, replace: true });
    throw redirect({ to: "/", search: popup, replace: true });
  },
});
