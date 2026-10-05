import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { EvidenceDrawer } from "@/components/shell/Evidence";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { TourProvider } from "@/components/shell/Tour";

// The app shell around every page: sidebar, top bar and the evidence drawer over the page.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Every page can carry the drawer's parameter (components/shell/Evidence.tsx).
  validateSearch: (search): { evidence?: string; answer?: string } => ({
    ...search,
    evidence: typeof search.evidence === "string" ? search.evidence : undefined,
    answer: typeof search.answer === "string" ? search.answer : undefined,
  }),
  component: Shell,
  notFoundComponent: () => <p className="page-message">This page could not be found.</p>,
});

function Shell() {
  return (
    <TourProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <TopBar />
          <Outlet />
        </main>
        <EvidenceDrawer />
      </div>
    </TourProvider>
  );
}
