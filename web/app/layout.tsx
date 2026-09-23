import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IntelMonitor",
  description: "Standing questions over a curated corpus, answered with sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
