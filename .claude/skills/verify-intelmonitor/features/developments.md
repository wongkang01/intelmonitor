# Developments list

A dashboard's developments in the latest run, across all its subjects, as a sortable table at `/developments?dashboard=<id>` with Status, the full wrapped title, Category and Date.
A filter bar narrows it by words and five facets, each a popover of values with counts, and switches between every development (`All N`) and What changed since the review (`New since review N`).
Filters and the sort live in the URL, so a reload and the evidence drawer keep them.
What changed adds the monitor page's triage: a filter (All, Unread, Flagged, Dismissed) and per-row Mark read, Flag and Dismiss.

## Sub-features

- `dev-open`: the list opens from a dashboard's widgets, scoped to that dashboard.
- `dev-facets`: Category, Materiality, Jurisdiction (with a find field), Date (single choice) and Source popovers narrow the list; the button names the pick.
- `dev-words`: `Filter by words` narrows the list after a 250 ms pause and writes `q=`.
- `dev-sort`: each column head sorts; a second click reverses it.
- `dev-persist`: reload and a drawer round trip keep facets, words and sort.
- `dev-empty`: no match shows `No developments match the filters. Clear filters`.
- `dev-changed`: `New since review` lists What changed with the triage filter and row actions.
- `dev-triage-keys`: row actions show once focus is in the row and work by keyboard; focus moves on when a row leaves the filter.
- `dev-popover-keys`: popovers take focus, close on Esc, click outside or tabbing out.
- `dev-bad-params`: hand-edited facet values the list cannot apply are ignored.
- `dev-narrow`: at 1024 px the bar wraps, nothing scrolls sideways, heads stick under the bar.

## How to get to it (user POV)

- Dashboard `Singapore banks`: the `Developments` widget's link `241 in scope` opens `/developments?dashboard=singapore-banks`.
- The `Since your last review` widget's title link and its `Show all` link open the same list with `&changed=1`.
- Any other dashboard-wide Since or Developments widget does the same for its dashboard. Widgets set to one subject open that monitor page instead.
- No sidebar or ⌘K entry opens the list.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; the store holds Run 2 (24 Sep against 17 Sep).
- `ab` below means `agent-browser --session im-verify` (or `--session $VERIFY_SESSION`). `@ref` is the ref `ab snapshot -i` prints for the named control; refs change after every re-render, so snapshot again before each click.
- Counts below are from the store of 30 Sep 2026; read current ones with `pnpm -C web verify api "/developments?dashboard_id=singapore-banks"` (`in_scope`, `matching`, `facets`).
- Triage writes to the live store. Toggle each action back at once (Mark unread, Flag again, Dismiss again) and read it back.

- **Open from the widget.** `pnpm -C web verify open dashboard singapore-banks`, `ab snapshot -i`, `ab click @ref` for link `241 in scope`. URL is `/developments?dashboard=singapore-banks`, heading `Developments` level 1, filter bar buttons `All 241` and `New since review 28`, column head `241 developments`.
- **Pick a facet value.** `ab click @ref` for button `Materiality` (the one with `[expanded=false]` in the bar, not the column head), then `ab click @ref` for checkbox `Significant 46`. URL gains `materiality=3`, the bar button reads `All 46`, rows count 46. `ab press Escape` closes the popover and the button reads `Materiality: Significant`.
- **Find inside a facet.** `ab click @ref` for button `Jurisdiction`. Focus lands on searchbox `Find a jurisdiction` (`ab eval 'document.activeElement.getAttribute("aria-label")'`). `ab keyboard type "Sing"` leaves only checkbox `Singapore 25`; click it, then `ab press Escape`. URL gains `jurisdiction=sg`, button reads `Jurisdiction: Singapore`, `All 25`. Check the API agrees: `pnpm -C web verify api "/developments?dashboard_id=singapore-banks&materiality=3&jurisdiction=sg"` gives `matching` 25.
- **Sort.** `ab click @ref` for button `Date` inside columnheader `Date`. URL gains `sort=date`; `ab eval '[...document.querySelectorAll(".dtable th")].map(t=>t.getAttribute("aria-sort")).join()'` shows `descending` on the last head, first row's date is the newest. Click again: `order=asc`, `ascending`, first row the oldest (`28 Jul`).
- **Reload keeps it.** `ab reload`, `ab wait --load networkidle`. URL, both facet button names, row count and `aria-sort` are unchanged.
- **Drawer keeps it.** `ab focus @ref` on the first row's title link, `ab press Enter`. URL gains `&evidence=<id>` after the list's parameters and focus is on heading `Evidence` (`document.activeElement.id` is `evidence-title`). `ab press Escape`: URL is back to the list's parameters exactly, and focus is back on that row's title link. See [evidence-drawer](evidence-drawer.md).
- **Words.** `ab fill @ref "teaming"` on searchbox `Filter by words`, wait 1 s. URL gains `q=teaming`, one row. Compare `pnpm -C web verify api "/developments?dashboard_id=singapore-banks&q=teaming"` `matching`.
- **Empty and Clear filters.** Fill `zzzqqq`. The table reads `No developments match the filters. Clear filters`. `ab click @ref` for button `Clear filters`: facet and `q` parameters go (sort stays), the searchbox is empty, `All 241` again.
- **Popovers by keyboard.** `ab focus @ref` on button `Date`, `ab press Enter`: focus is on radio `Any time 241`. `ab press ArrowUp`: URL gains `days=90`, button reads `Date: Last 90 days`. `ab press Escape`: popover closes, focus returns to the button. Reopen and click `Clear` to drop `days` (the popover stays open). Focus button `Category`, `ab press Enter`: focus on the first checkbox (`Regulatory 145`). Press Tab once per value (7): focus reaches button `Materiality` and the Category popover is closed.
- **Bad parameters.** `pnpm -C web verify open developments singapore-banks "category=bogus&materiality=9&jurisdiction=xx&days=abc&source=foo"`. All 241 rows show and the five facet buttons read plain `Category`, `Materiality`, `Jurisdiction`, `Date`, `Source`.
- **What changed.** `ab click @ref` for button `New since review 28`. URL gains `changed=1`; the lead reads `28 new, 9 need attention` (`ab get text .mon-lead`); a group `Filter developments` has `All 80`, `Unread 28`, `Flagged 1`, `Dismissed 0`. Counts match `pnpm -C web verify api "/what-changed?dashboard_id=singapore-banks"`: 80 `unreviewed`, 28 of them unread and not dismissed.
- **Triage by keyboard.** Click `Unread 28`. `ab focus @ref` on the first row's title link, then `ab press Tab` once: focus is on button `Mark read`. `ab press Enter`: the row leaves the Unread list, focus moves to `Mark read` on the row now in its place, and `Unread 27`, `New since review 27` update. Read back with `pnpm -C web verify api "/developments?dashboard_id=singapore-banks&q=<words from the title>"`: `read: true`.
- **Undo triage.** Click the group's `All 80`, focus the same row's title link, Tab once to button `Mark unread`, Enter. Counts return to 28 and the API shows `read: false`. Flag and Dismiss are toggles (`aria-pressed`) undone the same way.
- **1024 px.** `pnpm -C web verify open developments singapore-banks "days=30&category=regulatory&materiality=3&jurisdiction=sg&source=news"`, then `ab set viewport 1024 800` (`verify open` resets the viewport to 1440x900, so set it after). `ab eval` shows `main.scrollWidth - main.clientWidth` is 0 and group `Developments to list` ends at or before x 1024. With `changed=1`, the title head is at least 200 px, and after `document.querySelector("main").scrollBy(0,1200)` the heads' top equals `.fbar`'s bottom. Set the viewport back to 1440 900.
- **Proof.** `pnpm -C web verify shot devs/<step>` before and after each action; the `.aria.txt` holds the facet button names and counts.

## Gotchas

- The list belongs to a dashboard: a URL without `dashboard=<id>` shows `Open developments from a dashboard.` `verify open developments <dashboard>` always sets it.
- Names repeat: `Category` and `Date` are both facet buttons and column sort buttons, and `All N` is both the bar's switch and the triage filter's first button. Pick by ref from `snapshot -i`; the facet button carries `[expanded=...]`.
- `ab find role button --name "New since review 28"` fails while `--name "New since review"` works, and `find role checkbox --name "Significant"` did not match the facet checkbox. Prefer refs.
- Titles that start with "All" match a naive `grep 'All '` on the snapshot.
- The popover dialog does not appear in `snapshot -i`; its checkboxes do, listed right after the expanded button.
- Filters use `history.replaceState`, so Back leaves the page instead of undoing a filter. Opening the drawer pushes a history entry; closing it replaces.
- Words apply after 250 ms; wait about 1 s before reading the URL or rows.
- A read row drops its New or Updated badge but keeps `Needs attention`.
- Triage changes the same rows the monitor page, the Since widget and the alerts bell read, and marking read also marks the alert read. There is no Undo toast; toggle back.
- The `New since review` count is the unread new or updated developments; the triage `All` count includes read ones. They differ on purpose.
- Once the dashboard is marked reviewed with nothing new, What changed folds behind a `Run of 24 Sep ...` disclosure button; expand it before looking for rows.
