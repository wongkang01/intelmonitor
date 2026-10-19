// The walkthrough's steps, in order: the Phase 1 app (phase1-plan.md wave 4) as a first-time user
// meets it, then two scripted pipeline checks. The test runs them as test.step titles and the
// reporter lists them in index.html, including any that never ran.
export const STEPS = [
  "Onboarding: pick a role, trim the suggested picks, the preview follows, Create dashboard opens it",
  "Dashboard: the busiest entities on the watchlist with Show all, the feed under priority headings with New marked, upcoming dates, one Updated date, no parked controls",
  "Feed: Show all opens the developments list; This week and High narrow the feed and survive a reload",
  "Development popup from a feed row: labels, who it impacts, connections, sources; Esc returns to the same feed and it reads as read; the old page link opens the popup",
  "Dismiss and Undo in the development popup, read back from the API",
  "Edit dashboard: add an entity and Save; the watchlist follows",
  "New dashboard from the sidebar: Add all on a group names it, Create opens it",
  "Sidebar: groups as headings under Entities open an entity page; topics and new High marks; dashboard new counts",
  "Entity page: the brief, the top 5 developments and the Related card; See all links opens the Related tab with Could affect and Shared with; See all opens the Developments tab under priority headings; the Data tab in plain words",
  "⌘K search opens an entity and a development",
  "Profile menu: switch to FMD and its dashboard opens; ? opens Help with the labels",
  "At 1024 px nothing scrolls sideways and titles wrap in full",
  "Series fetch from cached responses: a backfill and the daily fetch after it reach no source, the fetch adds nothing and the values match the store",
  "Detector on fixture values: the loan-to-deposit rule fires into one High development",
] as const;

/** Where each run writes its artifacts; playwright.config.ts sets it once per run. */
export function runDir(): string {
  const dir = process.env.E2E_RUN_DIR;
  if (!dir) throw new Error("E2E_RUN_DIR is not set; run the suite with `pnpm e2e`");
  return dir;
}

/** Screenshot path for a step, relative to the run directory. */
export const screenshotName = (index: number) => `steps/${String(index + 1).padStart(2, "0")}.png`;
