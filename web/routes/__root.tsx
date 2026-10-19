import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";

import { DevelopmentPopup } from "@/components/developments/DevelopmentPopup";
import { EvidenceDrawer } from "@/components/shell/Evidence";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

// The app shell around every page: sidebar, top bar, the answer drawer and the development popup.
// Onboarding (/setup) is a page of its own, without the shell. The first-run tour
// (components/shell/Tour.tsx) is off for the testing sessions.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Every page can carry the answer drawer's parameter (components/shell/Evidence.tsx) and the
  // development popup's (components/developments/link.ts); `evidence` is the popup's old name.
  validateSearch: (search): { evidence?: string; answer?: string; development?: string; scope?: string } => ({
    ...search,
    evidence: typeof search.evidence === "string" ? search.evidence : undefined,
    answer: typeof search.answer === "string" ? search.answer : undefined,
    development: typeof search.development === "string" ? search.development : undefined,
    scope: typeof search.scope === "string" ? search.scope : undefined,
  }),
  component: Shell,
  notFoundComponent: () => <p className="page-message">This page could not be found.</p>,
});

function Shell() {
  const setup = useRouterState({ select: (s) => s.location.pathname === "/setup" });
  if (setup) return <Outlet />;
  return (
    <div className="app">
      <Sidebar />
      <main className="main" data-scroll-restoration-id="main">
        <TopBar />
        <Outlet />
      </main>
      <EvidenceDrawer />
      <DevelopmentPopup />
    </div>
  );
}
