import { createFileRoute, redirect } from "@tanstack/react-router";

// The Trend tab became the Data tab; old links land there with their query and hash.
export const Route = createFileRoute("/monitors/$id/trend")({
  beforeLoad: ({ params, location }) => {
    throw redirect({ to: "/monitors/$id/data", params, search: location.search, hash: location.hash, replace: true });
  },
});
