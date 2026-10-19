import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useDashboards, useProfile } from "@/lib/api/queries";

// Home opens the default dashboard from the profile, or the first one in the sidebar, keeping the
// query so a development popup opened at `/` stays open. Before a role is picked (the first visit),
// it opens onboarding instead.
export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const profile = useProfile();
  const dashboards = useDashboards();

  const list = dashboards.data;
  const target = list?.find((d) => d.id === profile.data?.default_dashboard_id) ?? list?.[0];

  const onboard = profile.data !== undefined && profile.data.role === null;
  useEffect(() => {
    if (onboard) void navigate({ to: "/setup", replace: true });
    else if (profile.isFetched && target)
      void navigate({ to: "/dashboards/$id", params: { id: target.id }, search: true, replace: true });
  }, [onboard, profile.isFetched, target, navigate]);

  if (dashboards.isError) return <p className="page-message">Could not reach the API.</p>;
  if (list && list.length === 0) return <p className="page-message">No dashboards yet.</p>;
  return null;
}
