import Link from "next/link";

import { monitorHref } from "@/lib/widgets";

// Graph view route, opened from a monitor page's Links section. Phase 7 fills it in.
export default async function GraphPage({ params }: PageProps<"/monitors/[id]/graph">) {
  const { id } = await params;
  return (
    <div className="pagehead">
      <div className="grow">
        <h1>Graph view</h1>
        <p>
          The graph view is not built yet. <Link href={monitorHref(id)}>Back to the monitor page</Link>
        </p>
      </div>
    </div>
  );
}
