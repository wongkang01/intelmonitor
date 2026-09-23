import { DashboardView } from "@/components/dashboard/DashboardView";

export default async function DashboardPage({ params }: PageProps<"/dashboards/[id]">) {
  const { id } = await params;
  return <DashboardView key={id} id={id} />;
}
