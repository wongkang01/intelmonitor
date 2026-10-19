import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/styles/globals.css";
import "@/styles/shell.css";
import "@/styles/widgets.css";
import "@/styles/sheet.css";
import "@/styles/popup.css";
import "@/styles/monitor.css";
import "@/styles/graph.css";
import "@/styles/related.css";
import "@/styles/trend.css";
import "@/styles/custom.css";
import "@/styles/help.css";
import "@/styles/developments.css";
import "@/styles/onboarding.css";
import "@/styles/ask.css";
import "@/styles/touch.css";

import { ToastProvider } from "@/components/ui/Toast";
import { searchFromParams, searchToParams } from "@/lib/router";

import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  // Hovering or focusing a link loads its route's code and starts its loader's prefetch.
  defaultPreload: "intent",
  // Loaders only prefetch into the query cache, which decides freshness itself.
  defaultPreloadStaleTime: 0,
  // The page scrolls inside main, not the window. A new page starts at the top; Back and Forward,
  // and closing a development popup, return to where that page was scrolled.
  scrollToTopSelectors: ["main.main"],
  scrollRestoration: true,
  parseSearch: searchFromParams,
  stringifySearch: searchToParams,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  // Set on the history entry a development popup was opened into (components/developments/link.ts).
  interface HistoryState {
    developmentOpened?: boolean;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
