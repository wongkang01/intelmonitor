"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";

let browserClient: QueryClient | undefined;

function queryClient() {
  const make = () =>
    new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
    });
  // Keep server renders isolated and reuse one cache in the browser.
  if (typeof window === "undefined") return make();
  browserClient ??= make();
  return browserClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
