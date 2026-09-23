import { Suspense } from "react";

import { EvidenceDrawer } from "@/components/shell/Evidence";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

export default function ShellLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TopBar />
        {children}
      </main>
      <Suspense>
        <EvidenceDrawer />
      </Suspense>
    </div>
  );
}
