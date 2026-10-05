# Help and tour

Help is a modal with the state glossary, the materiality levels with this run's counts, and the keyboard shortcuts; `?` opens it from anywhere outside a text field.
Its `Replay tour` button starts the five-step coach-mark tour over the dimmed default dashboard, which also runs once on its own for a profile that has never seen it.
There is no general feedback entry in the shell; feedback on the AI is Mark wrong on answers and Wrong on tags, covered in [evidence-drawer](evidence-drawer.md) and [monitor-page](monitor-page.md).

## Sub-features

- `help-open` opens Help with `?` or the profile menu's `Help ?` item.
- `help-content` shows regions `States` (New, Updated, Watch, Needs attention, Stable), `Materiality` (one row per level with `N this run`) and `Keyboard shortcuts`, and `Tour seen on <date>` in the foot.
- `tour-steps` walks `Dashboards and monitors`, `Since your last review`, `Evidence`, `Mark reviewed`, `Generate a dashboard`, each ringing its target with `N of 5`.
- `tour-evidence` opens the evidence drawer on the dashboard's first development at step 3 and puts the URL back when the step ends.
- `tour-end` ends with Done, Skip tour, Close tour or Esc, returning focus to the profile button.
- `tour-auto` starts the tour on the first dashboard shown while `tour_seen_at` is null, and every start records `tour_seen_at`.

## How to get to it (user POV)

- Press `?` on any page, with focus outside a text field and no modal open.
- Profile button (bottom of the sidebar), then `Help ?`.
- In Help, `Replay tour`; from a non-dashboard page it first goes to `/`, the default dashboard.
- First visit to a dashboard with a profile whose `tour_seen_at` is null.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- Read the profile first: `pnpm -C web verify api /profile`. Replay overwrites `tour_seen_at` with now.
- `pnpm -C web verify open home`, then drive with `agent-browser --session <session>`.

- **Open Help by key.** Press `?`. Run `agent-browser press "?"`. A modal with `heading "Help"` opens; `snapshot -i` shows only its content: `button "Close"`, regions `States`, `Materiality`, `Keyboard shortcuts`, and `button "Replay tour"`. The Materiality rows match `verify api /materiality-levels` (name and `developments` as `N this run`).
- **Open Help from the menu.** Click the profile button, then `Help ?`. Run `agent-browser find role button click --name "Analyst"`, then `agent-browser find role menuitem click --name "Help"`. The same modal opens.
- **Close Help.** Press Esc or click `Close`. Run `agent-browser press Escape`. No `dialog[open]` remains and focus is on the profile button (`button.profile`).
- **`?` while typing.** Focus search and type `?`. Run `agent-browser press Meta+k` and `agent-browser keyboard type "?"`. The field holds `?` and Help does not open.
- **Replay tour.** Click `Replay tour`. Run `agent-browser find role button click --name "Replay tour"`. A `dialog "Tour"` shows a card `1 of 5` titled `Dashboards and monitors`, a ring (`.tour-ring`) on the sidebar, and focus on `Next`.
- **Step through.** Press Enter on each primary button. Run `agent-browser press Enter` and read `document.querySelector("dialog.tour #tour-title").textContent` each time. Titles go in order; at step 3 the URL gains `?evidence=<id>` and the drawer is open; step 5's primary is `Done`.
- **Back from the evidence step.** At step 3 click `Back`. Run `agent-browser find role button click --name "Back"`. The card returns to `Since your last review` and `?evidence=` leaves the URL.
- **End early.** Press Esc at step 3, or click `Skip tour` or `Close tour` at any step. Run `agent-browser press Escape`. The tour and the drawer close, the URL is the bare dashboard, and focus is on the profile button.
- **Replay from elsewhere.** On a monitor page press `?` and click `Replay tour`. Run `pnpm -C web verify open monitor dbs`, then the same commands. The URL becomes the default dashboard (`/dashboards/singapore-banks`) with step 1 showing.
- **Seen is recorded.** After any replay, `verify api /profile` shows `tour_seen_at` at the replay time, and Help's foot reads `Tour seen today`. Restore the prior value with `curl -X PUT https://intelmonitor.api.localhost/profile -H 'content-type: application/json' -d '<profile JSON read before>'`.
- **Auto start.** Only with a profile whose `tour_seen_at` is null (set it with the same PUT): open any dashboard and the tour starts by itself, focus on `Next`; `verify api /profile` then shows `tour_seen_at` set. Restore afterwards.

## Gotchas

- Replay has no undo in the app; it rewrites `tour_seen_at`, which the auto start and Help's `Tour seen` line read. Restore it through `PUT /profile`.
- The evidence step opens the drawer through the URL only; it does not mark the development read (`verify api /alerts` is unchanged).
- The tour is a modal `<dialog>`, so the page behind is inert: `snapshot -i` lists only the card, and clicks on the page do nothing until the tour ends.
- `?` does nothing while any `dialog[open]` is showing, including the tour and Settings.
- The profile menu item is named `Help ?` because of its key hint; match with `--name "Help"`.
- `agent-browser eval` shares one global scope across calls, so a second `const t = ...` throws `Identifier 't' has already been declared`. Wrap each expression in `(() => { ... })()`.
- The harness browser sometimes stops answering (`Resource temporarily unavailable (os error 35)`, one renderer at 100% CPU) or reports `relaunched browser` and lands on `about:blank`, most often right after `press Escape` on a modal or popover. Run `verify cleanup` and `verify open` again, then redo the step; it did not reproduce on retry.
