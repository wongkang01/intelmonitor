import { createFileRoute, redirect } from "@tanstack/react-router";

// The Connections tab is gone (prd.md section 12); old links land on the Overview.
export const Route = createFileRoute("/monitors/$id/connections")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/monitors/$id", params, replace: true });
  },
});
