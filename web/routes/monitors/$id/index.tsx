import { createFileRoute } from "@tanstack/react-router";

import { MonitorView } from "@/components/monitor/MonitorView";
import { monitorPageOptions } from "@/lib/api/queries";

export const Route = createFileRoute("/monitors/$id/")({
  loader: ({ context, params }) => void context.queryClient.prefetchQuery(monitorPageOptions(params.id)),
  component: MonitorPage,
});

function MonitorPage() {
  const { id } = Route.useParams();
  return <MonitorView key={id} id={id} />;
}
