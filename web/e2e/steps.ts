// The walkthrough's steps, in order: poc-plan.md, Verification > E2E. The test runs them as
// test.step titles and the reporter lists them in index.html, including any that never ran.
export const STEPS = [
  "Since your last review shows Run 2 changes, Show all lists them",
  "Evidence highlights the quote in its source",
  "Edit mode: drag, remove, reload keeps the layout",
  "New dashboard, Build",
  "New dashboard, Generate",
  "Monitor page from ⌘K: mark reviewed and Undo, add a note, delete and Undo, the rail's foot in reach",
  "Triage: row actions by keyboard, filters, follow, alerts read on open",
  "Custom question with answer and citations",
  "Graph view: 2 hops, click a node, its page opens",
  "Sidebar: drag and Move up reorder dashboards, colors stay",
  "⌘K full text: a development and a document open their evidence, snippets are body text",
  "Correct the AI: mark an answer wrong and Undo, remove a tag and Undo",
  "Help: ? opens it, Replay tour walks the five coach marks, Esc skips and puts the page back",
  "Developments list: facets, sort and words survive reload and the drawer, What changed triage in the table",
  "Developments list: popovers follow the keyboard, bad parameters are ignored, at 1024 px the bar wraps and titles keep room",
  "Series: per-100 quotes stored per unit, indicators as of Run 1 see nothing later, gaps never compare with zero",
  "Facts in answers: answers cite their series' facts, a past date's facts see nothing later, a held depeg fixes Peg",
] as const;

/** Where each run writes its artifacts; playwright.config.ts sets it once per run. */
export function runDir(): string {
  const dir = process.env.E2E_RUN_DIR;
  if (!dir) throw new Error("E2E_RUN_DIR is not set; run the suite with `pnpm e2e`");
  return dir;
}

/** Screenshot path for a step, relative to the run directory. */
export const screenshotName = (index: number) => `steps/${String(index + 1).padStart(2, "0")}.png`;
