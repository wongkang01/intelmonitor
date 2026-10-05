# Top bar

The top bar holds full text search over monitors, developments and documents, a run status chip that opens the Runs popover, and an alerts bell that opens the Alerts popover.
A monitor result opens its page; a development or document result opens the evidence drawer over the current page.
One popover is open at a time, and Esc or a click outside closes it and returns focus to its trigger.

## Sub-features

- `search-open` focuses the search field with ⌘K (Ctrl+K) from anywhere.
- `search-results` lists up to five hits per group: Monitors, Developments, Documents (title, snippet, domain).
- `search-go` opens the highlighted hit by click or Enter; arrows move the highlight; Esc clears, then blurs.
- `search-empty` shows `No monitor, development or document matches “<text>”.`
- `run-chip` shows `Monitoring · Last run <date>` or `Running now · N sources`.
- `runs-popover` lists every finished run, newest first, with result, when, how, duration and sources, and `Run now`.
- `alerts-bell` shows the unread count; the popover groups Needs attention and Watch alerts on followed subjects.
- `alerts-triage` marks one alert read or unread, Mark all read, and opening an alert reads it.
- `alerts-manage` opens the Following dialog with Unfollow per subject.

## How to get to it (user POV)

- Present on every page of the shell.
- ⌘K or a click in `Search monitors, developments and documents`.
- Click the run chip (`Monitoring. Last run <date>. Show runs`).
- Click the bell (`Alerts, N unread`, or `Alerts` when all are read).
- Manage in the Alerts popover foot opens Following.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok and its `run` check shows no run computing.
- `pnpm -C web verify open home`, then drive with `agent-browser --session <session>`.
- Note the alert state before triage: `pnpm -C web verify api /alerts` (`unread.total`, each alert's `read`).

- **Focus search.** Press ⌘K. Run `agent-browser press Meta+k`. `document.activeElement` is `combobox "Search"`.
- **List results.** Type a query. Run `agent-browser keyboard type "stablecoin"`, then `agent-browser snapshot -i`. `combobox "Search" [expanded=true]` and `listbox "Search results"` show options such as `option "Stablecoins Topic" [selected]`, development titles with a date, and documents with snippet and domain. Compare with `verify api "/search?q=stablecoin"`.
- **Open a document hit.** Click a document option. Run `agent-browser click @eN`. URL gains `?evidence=<development_id>` from that document, the drawer (`[data-testid=evidence-drawer]`) heading is the development title, a `.source a` in it carries the document title, and the field is cleared.
- **Open a development hit.** Click an option in the Developments group. URL gains `?evidence=<id>` and the drawer H3 equals that development's title.
- **Keyboard to a monitor.** Type `maybank`, press ArrowDown then ArrowUp, then Enter. Run `agent-browser press ArrowDown`, `press ArrowUp`, `press Enter`. The selected option (`[role=option][aria-selected=true]`) moves to the first development and back to `Maybank Entity`; Enter lands on `/monitors/maybank` with H1 `Maybank`.
- **Empty result.** Type `zzqxw`. The listbox holds only `No monitor, development or document matches “zzqxw”.`
- **Esc.** Press Esc once with text: the field clears and keeps focus. Press again: the field blurs.
- **Runs popover.** Click the chip. Run `agent-browser find role button click --name "Show runs"`. `#runs-popover` (`dialog "Runs"`) lists `Run of <as_of>` rows with `Completed`, `Completed with alerts` or `Failed` (`Did not finish`), the result line, then `<finished> · <how> · <duration> · N sources`. The foot reads `Runs are manual for now.` and `Run now`. Rows match `verify api /runs` minus running ones.
- **Close Runs.** Press Esc. The popover closes and focus returns to the chip.
- **Alerts popover.** Click the bell. Run `agent-browser find role button click --name "Alerts"`. `#alerts-popover` shows `N unread` (equal to `unread.total` from `verify api /alerts`), `Mark all read`, regions `Needs attention` and `Watch` with headings `<group> · N unread`, rows whose link starts with `Unread` when unread, and the foot `From N followed subjects` with `Manage`.
- **Mark one read, then unread.** Click the row's `Mark read`. Run `agent-browser click @eN` on the `button "Mark read"` after an `Unread` link. The bell becomes `Alerts, <N-1> unread` and `verify api /alerts` shows that alert `read: true`. Click the same row's `Mark unread` to restore; the bell and API return to the start.
- **Open an alert.** Click the alert's link. URL gains `?evidence=<alert id>`, the drawer heading is the alert title, the popover closes, and an unread alert becomes read in `verify api /alerts`. Restore with `Mark unread` from the bell. Use an already read alert to keep the drive read-only.
- **Manage.** Click `Manage`. Run `agent-browser find role button click --name "Manage"`. A `Following` modal lists each followed subject with a link and `Unfollow <name>`; its rows match `verify api /follows`. Esc closes it and focus returns to the bell.

## Gotchas

- Never click `Run now`: it recomputes the live run for everyone. It shows `Running…` with `aria-disabled` while a run is going.
- The chip shows when the last run finished (a clock time today, `yesterday`, else a date such as `28 Sep`), not the run's as-of date (`Run of 24 Sep`).
- The Runs popover lists every rerun, so the same `Run of 24 Sep` appears many times with different finish times; it is not a paging bug.
- A mouse pointer resting over where the results list opens hijacks the highlight on hover. After clicking a hit, move the mouse away (`agent-browser mouse move 700 850`) before keyboard assertions, or Enter opens the hovered hit.
- `agent-browser find role button --name "Alerts"` also matches `Alerts, 9 unread`; the count is in the accessible name, not a separate element.
- Opening an alert and Mark all read change the store; Mark all read has no Undo, so skip it unless the task is about it, or `verify store save` first.
- `snapshot -i` omits the `group` roles of search results and the `dialog` roles of popovers; query `#search-results`, `#runs-popover`, `#alerts-popover` or use a full `snapshot` to see them.
- Opening a hit moves focus to the drawer heading, so the next Esc closes the drawer, not the search.
