import { TrendView } from "@/components/monitor/TrendView";

// A monitor page's Trend tab, opened from the tabs in its head.
export default async function TrendPage({ params }: PageProps<"/monitors/[id]/trend">) {
  const { id } = await params;
  return <TrendView key={id} id={id} />;
}
