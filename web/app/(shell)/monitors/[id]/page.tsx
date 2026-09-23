import { MonitorView } from "@/components/monitor/MonitorView";

export default async function MonitorPage({ params }: PageProps<"/monitors/[id]">) {
  const { id } = await params;
  return <MonitorView key={id} id={id} />;
}
