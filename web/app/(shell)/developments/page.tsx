import { DevelopmentsView } from "@/components/developments/DevelopmentsView";

// `/developments?dashboard=<id>` lists a dashboard's developments; `&changed=1` keeps the new and
// updated ones. The developments list with facets (iteration-plan.md B6) takes over this route.
export default async function DevelopmentsPage({ searchParams }: PageProps<"/developments">) {
  const { dashboard, changed } = await searchParams;
  if (typeof dashboard !== "string") return <p className="page-message">Open developments from a dashboard.</p>;
  return <DevelopmentsView key={dashboard} dashboardId={dashboard} changed={changed === "1"} />;
}
