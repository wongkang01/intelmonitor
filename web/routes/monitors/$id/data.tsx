import { createFileRoute, redirect } from "@tanstack/react-router";

import { DataView } from "@/components/monitor/TrendView";
import { monitorPageOptions, trendOptions } from "@/lib/api/queries";

// A monitor page's Data tab: its indicators, then why its series moved run by run. Groups have no
// page (decision S3), so a group's Data URL lands on its member list.
export const Route = createFileRoute("/monitors/$id/data")({
  beforeLoad: async ({ context: { queryClient }, params }) => {
    const page = await queryClient.ensureQueryData(monitorPageOptions(params.id)).catch(() => null);
    if (page?.subject.type === "group") throw redirect({ to: "/monitors/$id", params, replace: true });
  },
  loader: ({ context: { queryClient }, params }) => void queryClient.prefetchQuery(trendOptions(params.id)),
  component: DataPage,
});

function DataPage() {
  const { id } = Route.useParams();
  return <DataView key={id} id={id} />;
}
