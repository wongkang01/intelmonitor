import { createFileRoute } from "@tanstack/react-router";

import { SubjectDevelopments, type DevelopmentScope } from "@/components/monitor/SubjectDevelopments";
import { monitorPageOptions } from "@/lib/api/queries";

// A monitor page's Developments tab. `?scope=peers` lists the developments of an entity's peers.
export const Route = createFileRoute("/monitors/$id/developments")({
  validateSearch: (search): { scope?: "peers" } => ({
    ...search,
    scope: search.scope === "peers" ? "peers" : undefined,
  }),
  loader: ({ context: { queryClient }, params }) => void queryClient.prefetchQuery(monitorPageOptions(params.id)),
  component: DevelopmentsPage,
});

function DevelopmentsPage() {
  const { id } = Route.useParams();
  const { scope } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The scope replaces the history entry, so Back leaves the tab rather than undoing a switch.
  const onScope = (next: DevelopmentScope) =>
    void navigate({ search: (prev) => ({ ...prev, scope: next === "peers" ? "peers" : undefined }), replace: true, resetScroll: false });
  return <SubjectDevelopments key={id} id={id} scope={scope ?? "subject"} onScope={onScope} />;
}
