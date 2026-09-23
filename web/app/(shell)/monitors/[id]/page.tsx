import { MonitorHeader } from "@/components/monitor/MonitorHeader";

// Monitor page. Phase 4 renders its header; phase 5 adds What changed, questions and links.
export default async function MonitorPage({ params }: PageProps<"/monitors/[id]">) {
  const { id } = await params;
  return <MonitorHeader id={id} />;
}
