import { createFileRoute } from "@tanstack/react-router";

import { DashboardView } from "@/components/dashboard/DashboardView";
import { dashboardOptions } from "@/lib/api/queries";

export const Route = createFileRoute("/dashboards/$id")({
  loader: ({ context, params }) => void context.queryClient.prefetchQuery(dashboardOptions(params.id)),
  component: DashboardPage,
});

function DashboardPage() {
  const { id } = Route.useParams();
  return <DashboardView key={id} id={id} />;
}
