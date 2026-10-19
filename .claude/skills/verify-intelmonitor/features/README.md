# IntelMonitor feature map

Behavior-level inventory of what an analyst can do in IntelMonitor.
Agents use it to decide what to drive and what counts as proof; humans use it as the regression checklist.
Open the one file that matches the change, not the whole map.

## Baseline preconditions

- `pnpm -C web verify doctor` prints `"ok": true`, with `api-types` passing.
- The store holds the weekly runs up to 8 Oct 2026 (`verify api /runs/latest`).
- Home opens onboarding (`/setup`) while no profile is active (`verify api /profile` has `"role": null`), and the sidebar lists only the active profile's dashboards plus those no profile made. To reach a dashboard without onboarding, `verify api POST /profiles/tcrd/activate` (or `fmd`), and afterwards `sqlite3 data/intelmonitor.db "delete from meta where key = 'active_profile'"` if it was unset before.
- One store serves everyone. Take `verify store save <label>` before a drive that mutates, or undo with the app's Undo.
- Browser: `ab` in these files means `agent-browser --session im-verify` (or `--session $VERIFY_SESSION`), after `verify open ...`. Handles are ARIA roles and names as `ab snapshot -i` prints them.

## Driving conventions

- Reach the starting page with `verify open`, then act through visible controls and shortcuts.
- The development popup, the answer drawer and feed filters live in the URL (`?development=<id>&scope=dashboard:<id>`, `?answer=<subject>:<question>`, `?days=`, `?q=`, facets). A reload must keep them.
- Wait on visible end states (`agent-browser wait --text ...` or `wait --load networkidle`), not fixed sleeps.
- Read side effects back through `verify api <path>` after the UI action.

## Proof and skip reporting

- Capture the action and the end state: `verify shot` before and after, or `verify record`.
- A mutation is proven by a second view: the API, a reload, or another page showing the same state.
- Name every entry point you skipped and why. Parked controls (Run now, custom questions, the widget grid, the tour) have no entry point in the app and are skipped.

## Feature entry contract

Each file has an H1, one paragraph of user-visible behavior, then exactly these H2s in order:

1. `Sub-features`: short IDs, one line each.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with verify`: `Preconditions:`, then bullets pairing each user action with the exact commands and the observable result.
4. `Gotchas`: traps that waste or invalidate a run.

Keep implementation details out. Name only user paths, stable handles, required state, commands and observable proof.

## Full sweep

Walk top to bottom for a broad regression, or run `pnpm -C web e2e`, which covers the main paths of this map in 14 steps.

## Shell

- [sidebar](sidebar.md): Ask, Dashboards list, reorder, options menu, Entities with groups as headings, Topics, profile menu.
- [onboarding](onboarding.md): First visit at `/setup`: the role, the suggested picks and preview, the TCRD and FMD profiles, switching role, visits.
- [ask](ask.md): The Ask preview at `/ask`: the centred query bar, @ mentions, suggested questions and mocked answers.
- [top-bar](top-bar.md): ⌘K search and `Updated <date>`; the run chip and alerts bell are parked.
- [help-and-tour](help-and-tour.md): `?` help with the labels and shortcuts; the coach-mark tour is off.

## Dashboards

- [dashboard](dashboard.md): The fixed dashboard: watchlist table, the feed with the new count and Show all, upcoming dates, Edit dashboard.
- [new-dashboard](new-dashboard.md): New dashboard by picking entities and topics, then a name.

## Monitors

- [monitor-page](monitor-page.md): A topic's or entity's page: Overview (the summary band with the brief, Key data figures and the next date, the top 5, the Related card), Developments, Related (Could affect, linked institutions, Shared with) and Data; groups list their members.
- [data](data.md): Data tab for subjects with series: indicators, weekly notes, the series chart, the facts behind each note.
- [graph](graph.md): Graph view, reachable by URL only: hops, filters, node click.
- [custom-questions](custom-questions.md): Parked: custom questions, no entry point in the app.

## Developments and evidence

- [developments](developments.md): Development feeds on the developments page, the dashboard and a monitor page's Developments tab: column header, period, facets, words, rows.
- [development-page](development-page.md): The development popup over any page: who it impacts, connections, News and Social source tabs, Not relevant and Dismiss, close.
- [evidence-drawer](evidence-drawer.md): Evidence for a standing question's answer: series and developments it relies on, Mark wrong.

## Pipeline

- [pipeline-checks](pipeline-checks.md): Scripted `im check` runs for series, past-date runs and the loan-to-deposit detector.
