import type { Metadata } from "next";

import "./globals.css";
import "@/styles/shell.css";
import "@/styles/widgets.css";
import "@/styles/sheet.css";
import "@/styles/monitor.css";
import "@/styles/graph.css";
import "@/styles/custom.css";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "IntelMonitor",
  description: "Standing questions over a curated corpus, answered with sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
