"use client";

// Home opens the default dashboard from the profile, or the first one in the sidebar.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useDashboards, useProfile } from "@/lib/api/queries";

export default function Home() {
  const router = useRouter();
  const profile = useProfile();
  const dashboards = useDashboards();

  const list = dashboards.data;
  const target = list?.find((d) => d.id === profile.data?.default_dashboard_id) ?? list?.[0];

  useEffect(() => {
    if (profile.isFetched && target) router.replace(`/dashboards/${target.id}`);
  }, [profile.isFetched, target, router]);

  if (dashboards.isError) return <p className="page-message">Could not reach the API.</p>;
  if (list && list.length === 0) return <p className="page-message">No dashboards yet.</p>;
  return null;
}
