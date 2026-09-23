import { GraphView } from "@/components/graph/GraphView";

// Graph view route, opened from "Open graph view" in a monitor page's Links section.
export default async function GraphPage({ params }: PageProps<"/monitors/[id]/graph">) {
  const { id } = await params;
  return <GraphView key={id} id={id} />;
}
