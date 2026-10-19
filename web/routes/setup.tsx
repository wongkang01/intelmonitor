import { createFileRoute } from "@tanstack/react-router";

import { Setup } from "@/components/shell/Setup";
import type { Role } from "@/lib/api/queries";
import { ROLES } from "@/lib/roles";

// Onboarding: `/setup` asks for the role, `/setup?role=<role>` picks the first dashboard's subjects.
export const Route = createFileRoute("/setup")({
  validateSearch: (search): { role?: Role } => ({
    role: ROLES.find((r) => r.role === search.role)?.role,
  }),
  component: SetupPage,
});

function SetupPage() {
  const { role } = Route.useSearch();
  return <Setup role={role} />;
}
