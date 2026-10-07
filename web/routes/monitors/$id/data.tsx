import { createFileRoute } from "@tanstack/react-router";

import { DataView } from "@/components/monitor/TrendView";
import { monitorPageOptions, trendOptions } from "@/lib/api/queries";

// A monitor page's Data tab: its indicators, then why its series moved run by run.
export const Route = createFileRoute("/monitors/$id/data")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(monitorPageOptions(params.id));
    void queryClient.prefetchQuery(trendOptions(params.id));
  },
  component: DataPage,
});

function DataPage() {
  const { id } = Route.useParams();
  return <DataView key={id} id={id} />;
}
