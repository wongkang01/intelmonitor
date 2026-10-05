import { createFileRoute } from "@tanstack/react-router";

import { TrendView } from "@/components/monitor/TrendView";
import { monitorPageOptions, trendOptions } from "@/lib/api/queries";

// A monitor page's Trend tab, opened from the tabs in its head.
export const Route = createFileRoute("/monitors/$id/trend")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(monitorPageOptions(params.id));
    void queryClient.prefetchQuery(trendOptions(params.id));
  },
  component: TrendPage,
});

function TrendPage() {
  const { id } = Route.useParams();
  return <TrendView key={id} id={id} />;
}
