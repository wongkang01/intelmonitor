import { createFileRoute } from "@tanstack/react-router";

import { GraphView } from "@/components/graph/GraphView";

// Graph view route, opened from "Open graph view" in a monitor page's Links section.
export const Route = createFileRoute("/monitors/$id/graph")({
  component: GraphPage,
});

function GraphPage() {
  const { id } = Route.useParams();
  return <GraphView key={id} id={id} />;
}
