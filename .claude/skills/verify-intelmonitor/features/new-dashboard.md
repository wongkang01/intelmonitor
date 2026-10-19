# New dashboard

`New dashboard` in the sidebar opens a large popup with the subject picker that onboarding uses ([onboarding](onboarding.md)), every group open and nothing ticked.
The footer holds `Dashboard name`, the count of picks and `Create dashboard`.
Creating saves the picks under the name, follows them, adds the dashboard to the active profile's sidebar and opens it.
The dashboard page's `Edit dashboard` opens the same popup with the dashboard's picks and name, and `Save`.

## Sub-features

- `pick` `Find an entity or topic` filters rows across groups; each group has `n of m` and `Add all` / `Remove all`; rows show the 30-day count `15 (3 High)` and, for technology providers, who uses them.
- `name` `Dashboard name` reads `My dashboard`, becomes a group's name when the picks are exactly that group (`Exchanges`), and keeps what the user types.
- `count` the footer status reads `2 entities`, `19 entities, 3 topics`, or `Nothing picked` with `Create dashboard` disabled.
- `create` `Create dashboard` opens `/dashboards/<id>` and toasts `Created <name>`; the dashboard belongs to the active profile.
- `close` Esc, the close button or a backdrop click closes the popup and drops the picks.
- `edit` `Edit dashboard` on a dashboard page: heading `Edit dashboard`, its picks ticked, its name, `Save` writes both and the page's watchlist and feed follow.

## How to get to it (user POV)

- Sidebar `button "New dashboard"` (in `navigation "Main"`).
- Dashboard page head `button "Edit dashboard"` for the edit form.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok and a profile is active (`verify api /profile` has an `id`). Note `verify api /dashboards` and `verify api /follows` before creating anything.
- Creating a dashboard writes the store and follows every subject it picks; unfollow afterwards and delete the dashboard at the end.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).

- **Open.** `S find role button click --name "New dashboard"`. A dialog with `heading "New dashboard" [level=2]`, the search field, groups `Topics`, `Singapore banks`, `Central banks and regulators` and onward, `textbox "Dashboard name": My dashboard`, status `Nothing picked` and `button "Create dashboard" [disabled]`.
- **Pick a group.** `S find role button click --name "Add all Exchanges"`. The name becomes `Exchanges` and the status `2 entities`.
- **Create.** `S find role button click --name "Create dashboard"`, `S wait --load networkidle`. URL is `/dashboards/<new id>` and the H1 is the name. `verify api /dashboards/<id>` returns the picks as `subject_ids`, and `sqlite3 data/intelmonitor.db "select profile_id from dashboards where id = '<id>'"` is the active profile.
- **Edit.** On the new dashboard, `S find role button click --name "Edit dashboard"`, tick one more row, `Save`. `verify api /dashboards/<id>` has the extra id, and the watchlist gains a row when it is an entity (under `Show all <n> entities` when it is not among the first rows).
- **Clean up.** Delete it from `Options for <name>` (see [sidebar](sidebar.md)) and remove the follows it added.

## Gotchas

- Creating a dashboard follows its subjects server side, and deleting it does not unfollow them. Compare `verify api /follows` before and after.
- A dashboard made here still stores starter widgets (Since your last review, and a watchlist of its entities); the fixed layout ignores them.
- The sidebar lists only the active profile's dashboards and those no profile made, so a dashboard made under TCRD disappears after switching to FMD; `GET /dashboards/<id>` still returns it.
- Names repeat (the store had `OCBC` twice). Find your dashboard by id in `[data-dashboard-id]` or `verify api /dashboards`, never by name alone.
- Other runs leave dashboards behind (`Verify P6 Build OCBC`, `test`, `main test`); do not delete what you did not create.
