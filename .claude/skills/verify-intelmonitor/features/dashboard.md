# Dashboard

A dashboard page shows its name, the subjects it covers as links, `Add widget`, `Edit`, and a grid of widgets packed from the top left.
Each widget shows live data for one subject or for every subject on the dashboard, and a click on a widget's empty space opens that subject's monitor page (or the dashboard's developments list for dashboard-wide widgets).
Edit mode reorders widgets by drag or arrow keys, removes them with Undo, and flips a widget to its settings; every change saves at once and survives a reload.
`Add widget` opens a gallery of live previews for any subject.

## Sub-features

- `since` Since your last review: counts, Needs attention and New rows, `Show all`, `Mark all reviewed` (Large only).
- `widget-types` Monitor summary, Direction of travel, Upcoming, Indicator, Watchlist, Developments, Focus area.
- `widget-tap` a click on a widget's body opens its monitor page or the dashboard's developments list.
- `edit-drag` Edit mode: drag or arrow keys reorder; the order saves and a reload keeps it.
- `edit-remove` the minus button or Delete removes a widget, with a 5 second Undo toast.
- `settings` click a widget in edit mode (or Enter): Subject, Focus area or Series, Size, `Edit custom focus area`.
- `add-widget` the Add widget sheet: subject list with search, Suggested and More widgets offers, sizes, Add.
- `watchlist-edit` add and remove entities inside a Watchlist widget without edit mode.

## How to get to it (user POV)

- Sidebar `Dashboards` list: click a dashboard name (`link "<name>"` in `navigation "Main"`).
- Home (`/`) opens the profile's default dashboard, or the first in the sidebar.
- `Edit` button in the page head; a long press (500 ms) on a widget also enters edit mode.
- `Add widget` button in the page head.
- In edit mode: click a widget, or focus it and press Enter, for settings; Esc closes settings, then leaves edit mode.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; `Singapore banks` exists (`verify api /dashboards`).
- Every edit-mode, settings or Add widget change writes the dashboard. Drive those on a dashboard you created (see [new-dashboard](new-dashboard.md)) or run `verify store save <label>` first; delete yours afterwards.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).

- **Open.** Run `pnpm -C web verify open dashboard "Singapore banks"` (or a dashboard id), then `S snapshot -i`. `heading "Singapore banks" [level=1]`, `button "Add widget"`, `button "Edit"`, and one `group "<catalog name>"` per widget: `Since your last review`, `Monitor summary`, `Direction of travel`, `Upcoming`, `Developments`, `Focus area`, `Indicator`.
- **Since your last review.** Read the `group "Since your last review"`. It holds `link "Show all"`, one link per development row, and `button "Mark all reviewed"` at Large. The hero reads `<n> new, <m> need attention`, matching `verify api /dashboards/<id>/data` (the `since` entry's `what_changed.new_count` and `needs_attention_count`).
- **Show all.** `S click @<Show all>`, `S wait --load networkidle`, `S get url`. URL is `/developments?dashboard=<id>&changed=1`; the page shows `button "New since review <n>"` with the widget's new count. A Since widget set to one subject links to `/monitors/<subject>` instead.
- **Mark all reviewed (not driven).** It posts `/reviews` for every subject in the widget's scope and has no Undo toast. Proof would be the hero turning to `Nothing new since your review` and the footer to `Reviewed <when>`. Do not click it on the shared store; if you must, `verify store save` first and restore after.
- **Widget tap.** `S click @<group "Direction of travel">`, `S get url`. URL is `/monitors/<subject id>` (Singapore banks: `/monitors/banking-regulation`). `S back` returns.
- **Widget bodies.** Monitor summary: links named `<label>: <state>. See evidence` open `?answer=<subject>:<question>`. Upcoming: the next date is a link to `?evidence=<development>`. Developments: `link "<n> in scope"` opens `/developments?dashboard=<id>` for a dashboard-wide widget. Focus area and Indicator: `link "See evidence"` / the series name link. Direction of travel: an `img` named `Material developments per week since ...`.
- **Enter edit mode.** `S find role button click --name "Edit" --exact`. The button becomes `button "Done"`, the head reads `Drag to reorder. Click a widget for settings.`, and each widget gets `button "Remove <name>"` and becomes focusable.
- **Drag to reorder.** Read boxes with `S eval 'JSON.stringify([...document.querySelectorAll(".dash-grid [data-widget-id]")].map(e=>{const r=e.getBoundingClientRect();return [e.dataset.widgetType,r.x|0,r.y|0,r.width|0]}))'`. Then `S mouse move <x> <y>`, `S mouse down`, `S mouse move <x+12> <y+4>`, several `S mouse move` steps onto the right half of the target, `S mouse up`. `verify api /dashboards/<id>` lists `widgets` in the new order.
- **Keyboard reorder.** `S focus @<group>`, `S press ArrowLeft`. The widget swaps with its neighbour and the API order matches.
- **Remove and Undo.** `S find role button click --name "Remove Monitor summary"`, then in the same command line `S find role button click --name "Undo"`. The toast reads `Removed Monitor summary`; after Remove the API drops the widget, after Undo it is back at its old index.
- **Reload keeps layout.** `S reload`, `S wait --load networkidle`, re-run the eval above. Order equals the API order; the page is back in view mode (`button "Edit"`).
- **Settings.** In edit mode `S click @<group>` (or focus it and `S press Enter`). The group gains `button "Done"`, `combobox "Subject"` (with `Every subject on the dashboard` where allowed), `combobox "Focus area"` for Focus area, `combobox "Series"` for Indicator, and size buttons `Small` / `Medium` / `Large` as the type allows. `S click @<Large>` or `S select @<Subject> "Singapore banks"`; `verify api /dashboards/<id>` shows the new `size` and `settings.subject_id`.
- **Edit custom focus area.** Pick a `(custom)` option in `combobox "Focus area"`. `button "Edit custom focus area"` appears and opens `heading "Edit custom focus area"`; see [custom-questions](custom-questions.md).
- **Add widget.** `S find role button click --name "Add widget" --exact`. The sheet has `heading "Add widget" [level=2]`, `button "Close"`, `searchbox "Filter subjects"`, one `button "<subject>[ <n> new]"` per subject, `heading "<subject>" [level=3]`, and a `region "<widget name>"` per offer with size buttons and `button "Add <widget name>"`. The last region is `Custom focus area`.
- **Add from the sheet.** Click a subject button, wait about 2 s, pick a size, `S click @<Add Indicator>`. The sheet closes, the new widget is outlined at the end of the grid, and `verify api /dashboards/<id>` has it with the chosen `size` and `settings` (Indicator: `subject_id`, `series_id`).
- **Close the sheet.** `S click @<Close>` or `S press Escape`. Nothing is written.
- **Watchlist (source only).** A Watchlist has `textbox "Add an entity"` (Medium: behind `button "Add an entity"`), a `listbox "Matching entities"` of `option` buttons, and `button "Remove <entity>"` per row. Each add or remove saves the dashboard in view mode.

## Gotchas

- Watchlist widgets are not listed as a `group` in `snapshot -i` because they have no link target; use `S snapshot` (full) or the `Remove <entity>` buttons to find them.
- Group names are catalog names, not titles: a question widget is `group "Focus area"`, the summary is `group "Monitor summary"`. Two widgets of one type share a name, so address them by ref or `[data-widget-id]`.
- In settings there are two `button "Done"`: the page's and the widget's. `find role button --name "Done"` can hit the wrong one.
- The Undo toast lasts 5 seconds. Issue Remove and Undo in one shell command, or the Undo button is gone.
- Gallery offers load in two waves: the `Indicator` offer and the Custom focus area `combobox "Series"` appear only after the subject's series load. Wait about 2 s before asserting their absence.
- Clicking an offer's Add button that sits below the fold of the gallery's scroll pane can report success and add nothing. `S scrollintoview @<ref>` first and check the widget count.
- `S find role group click --name ...` hung for over 120 s in agent-browser 0.32.1 and left the session on `about:blank`. Click groups by ref.
- Refs renumber on every `snapshot`; take them from the latest one.
- Changing a widget's subject does not change the dashboard's `subject_ids`, so the head's subject links stay as they were at creation.
- `verify open dashboard <name>` takes the first exact name match; names repeat (two `OCBC` dashboards existed). Use the id.
- `Singapore banks` is edited by other runs and agents; its widget list is not a fixed fixture (it had 9 widgets, two of them added by someone).
- `Mark all reviewed` has no Undo in the widget, and `verify api` is GET only, so a stray click can only be undone by `verify store restore`.
