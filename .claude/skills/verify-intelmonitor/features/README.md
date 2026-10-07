# IntelMonitor feature map

Behavior-level inventory of what an analyst can do in IntelMonitor.
Agents use it to decide what to drive and what counts as proof; humans use it as the regression checklist.
Open the one file that matches the change, not the whole map.

## Baseline preconditions

- `pnpm -C web verify doctor` prints `"ok": true`, with `api-types` passing.
- The store holds the weekly runs up to 24 Sep 2026; Run 2 is the run of 24 Sep against 17 Sep.
- One store serves everyone. Take `verify store save <label>` before a drive that mutates, or undo with the app's Undo.
- Browser: `ab` in these files means `agent-browser --session im-verify` (or `--session $VERIFY_SESSION`), after `verify open ...`. Handles are ARIA roles and names as `ab snapshot -i` prints them.

## Driving conventions

- Reach the starting page with `verify open`, then act through visible controls and shortcuts.
- The evidence drawer and developments filters live in the URL (`?evidence=<id>`, `?answer=<subject>:<question>`, `?q=`, facets). A reload must keep them.
- Wait on visible end states (`agent-browser wait --text ...` or `wait --load networkidle`), not fixed sleeps.
- Read side effects back through `verify api <path>` after the UI action.

## Proof and skip reporting

- Capture the action and the end state: `verify shot` before and after, or `verify record`.
- A mutation is proven by a second view: the API, a reload, or another page showing the same state.
- Name every entry point you skipped and why. Paths that call Claude (Generate, custom question answers) or recompute the run (Run now) are skipped unless the task is about them.

## Feature entry contract

Each file has an H1, one paragraph of user-visible behavior, then exactly these H2s in order:

1. `Sub-features`: short IDs, one line each.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with verify`: `Preconditions:`, then bullets pairing each user action with the exact commands and the observable result.
4. `Gotchas`: traps that waste or invalidate a run.

Keep implementation details out. Name only user paths, stable handles, required state, commands and observable proof.

## Full sweep

Walk top to bottom for a broad regression, or run `pnpm -C web e2e`, which covers most of this map in 26 steps.

## Shell

- [sidebar](sidebar.md): Dashboards list, reorder, options menu, Topics / Groups / Entities trees, profile menu.
- [top-bar](top-bar.md): ⌘K search, run status and Runs popover, alerts bell.
- [help-and-tour](help-and-tour.md): `?` help, coach-mark tour, feedback.

## Dashboards

- [dashboard](dashboard.md): A dashboard's widget grid, Since your last review, edit mode, Add widget, widget settings.
- [new-dashboard](new-dashboard.md): New dashboard by Build (pick subjects) or Generate (describe it).

## Monitors

- [monitor-page](monitor-page.md): A subject's page and its tabs: Overview (summary, focus areas, key data, notes), Developments (what changed, subject or peers), Connections; mark reviewed, follow.
- [data](data.md): Data tab for subjects with series: indicators, per-run notes, the series chart, question states per run.
- [graph](graph.md): Graph view, embedded in the Connections tab and full page: hops, filters, node click.
- [custom-questions](custom-questions.md): Ask a custom question, its answer and citations, the widget it makes.

## Developments and evidence

- [developments](developments.md): Developments list: facets, sort, search, What changed, triage row actions.
- [evidence-drawer](evidence-drawer.md): Evidence for a development or an answer: sources, highlighted quote, series as a source, Correct the AI.

## Pipeline

- [pipeline-checks](pipeline-checks.md): Scripted `im check` runs for series, past-date runs and the depeg detector; Run now.
