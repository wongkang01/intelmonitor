// E2E against the Portless dev servers (docs/archive/poc-plan.md, Verification > E2E). Start the proxy and both
// dev servers first, then `pnpm e2e`. Each run writes video, trace, per-step screenshots and an
// index.html into artifacts/e2e/<timestamp>/.
import { defineConfig } from "@playwright/test";
import path from "node:path";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
// Workers inherit this, so every process of one run writes to the same directory.
process.env.E2E_RUN_DIR ??= path.resolve(import.meta.dirname, "../artifacts/e2e", stamp);

export default defineConfig({
  testDir: "e2e",
  outputDir: path.join(process.env.E2E_RUN_DIR, "results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["./e2e/report.ts"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://intelmonitor.web.localhost",
    // Portless serves a local CA the test browser does not trust.
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    trace: "on",
    // A click on a missing element fails the step instead of hanging the run.
    actionTimeout: 30_000,
  },
});
