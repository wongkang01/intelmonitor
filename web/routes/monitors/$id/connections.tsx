import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsView } from "@/components/monitor/Connections";
import { monitorPageOptions } from "@/lib/api/queries";

// A monitor page's Connections tab (groups and entities), opened from the tabs in its head.
export const Route = createFileRoute("/monitors/$id/connections")({
  loader: ({ context: { queryClient }, params }) => void queryClient.prefetchQuery(monitorPageOptions(params.id)),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const { id } = Route.useParams();
  return <ConnectionsView key={id} id={id} />;
}
