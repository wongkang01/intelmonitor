import { DevelopmentsView } from "@/components/developments/DevelopmentsView";

// `/developments?dashboard=<id>` lists a dashboard's developments; `&changed=1` lists What changed
// since the review. Facet filters and the sort are further parameters (lib/developments.ts).
export default async function DevelopmentsPage({ searchParams }: PageProps<"/developments">) {
  const { dashboard } = await searchParams;
  if (typeof dashboard !== "string") return <p className="page-message">Open developments from a dashboard.</p>;
  return <DevelopmentsView key={dashboard} dashboardId={dashboard} />;
}
