# New dashboard

`New dashboard` in the sidebar opens a large popup with two tabs over one shared draft.
Build adds widgets from the same gallery as Add widget and shows them in an editable preview; Generate takes a description, asks Claude, and fills the draft with widgets to Keep or Undo.
`Create dashboard` saves the draft under the typed or default name, follows its subjects, adds it to the sidebar and opens it.
Closing the popup keeps the draft until it is created or discarded.

## Sub-features

- `build-gallery` an empty draft opens on the gallery; each Add returns to the preview; `Add widget` reopens the gallery on the last subject.
- `build-preview` the preview is always in edit mode: drag, remove with Undo, click for settings.
- `generate` describe a dashboard or pick an example; Claude builds or changes the draft; `Undo` / `Keep`; follow-up prompts edit it.
- `name` the `Name` field defaults to the subjects' names (`OCBC`, `Singapore banks and 2 more`).
- `create` `Create dashboard` saves in preview order, follows the dashboard's subjects, opens `/dashboards/<id>`, toasts `Created <name>`.
- `close-keep` Esc or `Close` keeps the draft; a backdrop click with widgets asks `Close with <n> widgets in the draft?`.

## How to get to it (user POV)

- Sidebar `button "New dashboard"` (in `navigation "Main"`).
- Tabs `tab "Build"` and `tab "Generate"`; Left and Right arrows switch them.
- The tour's last coach mark, `Generate a dashboard`, points at it (see [help-and-tour](help-and-tour.md)).

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok. Note the counts from `verify api /dashboards` and `verify api /follows` before creating anything.
- Creating a dashboard writes the store and follows every subject it uses. Build from subjects already followed, or unfollow afterwards; delete the dashboard at the end.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).

- **Open.** `S find role button click --name "New dashboard"`, `S snapshot -i`. `heading "New dashboard" [level=2]`, `tab "Build" [selected]`, `tab "Generate"`, `button "Close"`, the gallery (`searchbox "Filter subjects"`, subject buttons, `region` offers), `textbox "Name": New dashboard` and `button "Create dashboard" [disabled]`.
- **Pick a subject.** `S fill @<Filter subjects> "OCBC"`, then `S click @<button "OCBC">`. `heading "OCBC" [level=3]` and the offers for an entity: Monitor summary, Standing question, Since your last review, Developments, Watchlist, Direction of travel, Upcoming, then Indicator (after its series load) and Custom question.
- **Add widgets.** `S find role button click --name "Add Monitor summary"`. The gallery closes; the preview shows `group "Monitor summary"` with `button "Remove Monitor summary"`, `button "Add widget"` above it, `textbox "Name": OCBC`, and `Create dashboard` enabled. Repeat with `S find role button click --name "Add widget" --exact` and another `Add <widget>`; the gallery reopens on the last subject, with `button "Back to preview"`.
- **Reorder the draft.** Boxes via `S eval 'JSON.stringify([...document.querySelectorAll(".nd-body [data-widget-id]")].map(e=>{const r=e.getBoundingClientRect();return [e.dataset.widgetType,r.x|0,r.y|0,r.width|0]}))'`, then the mouse down / move / up drag from [dashboard](dashboard.md). The eval's order changes.
- **Backdrop close asks.** `S mouse move 10 450`, `S mouse down`, `S mouse up`. `heading "Close with 3 widgets in the draft?"` with `Discard draft`, `Keep editing`, `Close`. `Close` hides the popup; reopening `New dashboard` shows the same widgets in the same order.
- **Tabs share the draft.** `S find role tab click --name "Generate"`. The same widgets appear, with `textbox "Describe your dashboard"` and `button "Send" [disabled]`. With an empty draft Generate instead shows `heading "What do you want to track?"` and three example buttons: `Stablecoin risk for Singapore banks`, `Geopolitics across SEA countries`, `Central banks on banking regulation`.
- **Name.** `S fill @<textbox "Name"> "<name>"`. The field holds it.
- **Create.** `S find role button click --name "Create dashboard"`, `S wait --load networkidle`, `S get url`. URL is `/dashboards/<new id>`, the H1 is the name, the sidebar has a new `link "<name>"` and `button "Options for <name>"`. `verify api /dashboards/<id>` returns `subject_ids` from the widgets and `widgets` in the preview's order; `verify api /follows` now includes those subjects.
- **Clean up.** `S click @<Options for <name>>` (the last one when names repeat), `S click @<Delete dashboard>`, `S click @<button "Delete">`. `verify api /dashboards` no longer lists the id. Delete is soft; `POST /dashboards/<id>/restore` or the toast's Undo brings it back.
- **Generate (not driven, calls Claude).** `tab "Generate"`, `S fill @<Describe your dashboard> "<prompt>"`, `S press Enter`. A `status` card reads `Generating your dashboard` over blurred placeholder shapes; within minutes the footer shows `<n> widgets pending` with `button "Undo"` and `button "Keep"`, and the thread shows the prompt and `Added <n> widgets` with a `Details` disclosure. `Undo` empties the change and reads `Undone.`; `Keep` reads `Kept <n> widgets` with its own Undo. A failure reads `Could not generate: <reason>`. The page posts to `/agent/generate` (SSE) and retries a request dropped before the run starts, up to three times. E2E step 5 (`New dashboard, Generate`) covers this path.

## Gotchas

- Creating a dashboard follows its subjects server side, and deleting it does not unfollow them. Compare `verify api /follows` before and after.
- The draft, tab and typed name survive closing the popup; only Create or `Discard draft` resets them. A later run in the same browser starts from the leftover draft.
- Esc and `Close` never ask; only a backdrop click with widgets opens the confirm. Esc while the Build gallery is open over a non-empty draft goes back to the preview first.
- `S find role textbox fill "<text>" --name "Name"` failed with `Element not found`, and `find label "Name" fill` reported success without changing the value. Fill the Name field by ref.
- `Create dashboard` stays disabled while a Generate run or a pending change is open; Keep or Undo first.
- An Add button low in the gallery can miss silently; `S scrollintoview @<ref>` before clicking and check the widget count.
- Names repeat (the store had `OCBC` twice). Find your dashboard by id in `[data-dashboard-id]` or `verify api /dashboards`, never by name alone.
- Other runs leave dashboards behind (`Verify P6 Build OCBC`, `test`, `main test`); do not delete what you did not create.
