import { createFileRoute, redirect } from "@tanstack/react-router";

import { RelatedTab } from "@/components/monitor/Related";
import { monitorPageOptions } from "@/lib/api/queries";

// A monitor page's Related tab: Could affect, linked institutions and Shared with. Groups have no
// page (decision S3), so a group's URL lands on its member list; a subject with nothing related
// lands on its Overview from the tab itself.
export const Route = createFileRoute("/monitors/$id/related")({
  beforeLoad: async ({ context: { queryClient }, params }) => {
    const page = await queryClient.ensureQueryData(monitorPageOptions(params.id)).catch(() => null);
    if (page?.subject.type === "group") throw redirect({ to: "/monitors/$id", params, replace: true });
  },
  component: RelatedPage,
});

function RelatedPage() {
  const { id } = Route.useParams();
  return <RelatedTab key={id} id={id} />;
}
