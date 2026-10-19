import { createFileRoute, redirect } from "@tanstack/react-router";

import { DevelopmentsTab } from "@/components/monitor/SubjectDevelopments";
import { monitorPageOptions } from "@/lib/api/queries";

// A monitor page's Developments tab: the subject's full feed, its period and filters in the URL.
// Groups have no page (decision S3), so a group's URL lands on its member list.
export const Route = createFileRoute("/monitors/$id/developments")({
  beforeLoad: async ({ context: { queryClient }, params }) => {
    const page = await queryClient.ensureQueryData(monitorPageOptions(params.id)).catch(() => null);
    if (page?.subject.type === "group") throw redirect({ to: "/monitors/$id", params, replace: true });
  },
  component: DevelopmentsPage,
});

function DevelopmentsPage() {
  const { id } = Route.useParams();
  return <DevelopmentsTab key={id} id={id} />;
}
