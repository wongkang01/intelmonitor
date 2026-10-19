# Onboarding and roles

There is no sign-in: a profile is a role with its own dashboards, and the active profile stands in for identity.
The first visit, before any role is picked, lands on `/setup`, a page without the sidebar.
Step 1 asks only for the role (Regulatory supervisor, Technology and cyber risk supervisor, Development staff, Other) and lists the department profiles preloaded for the sessions, TCRD and FMD, which open their dashboard at once.
Step 2 (`/setup?role=<role>`) starts from the role's suggested picks to trim, with a preview of the week's developments for them; `Create dashboard` makes the user's own profile for that role with the new dashboard as its default, and opens it.
The profile menu switches between profiles in one click and reopens onboarding with `Add a role`.
Each app load and each switch logs a visit with the role.

## Sub-features

- `first-visit` `/` with no active profile goes to `/setup`.
- `role-step` four role rows (links with a chevron) and `Preloaded for your department` with `TCRD` and `FMD` (buttons).
- `preset-open` a department row activates that profile and opens its dashboard.
- `pick-step` the picker: `Find an entity or topic`, open groups in the role's order with `n of m` and `Add all` / `Remove all`, rows with the 30-day count `15 (3 High)`, provider rows with `Used by DBS and UOB, for cloud services` (evidence grade on hover), and `More to add` groups that open on click.
- `preview` `What this dashboard shows`, `This week`: `N developments, n High` and the top three feed rows, refetched 300 ms after the picks change. The rows are not links, so the picks are never lost to a development popup.
- `other-own` for Other, `Pick my own instead` unticks everything and opens every group.
- `name` `Dashboard name` starts with the role's name for the dashboard (`Technology and cyber risk`, `Markets`, `Bank supervision`, `MAS supervised entities`; not `Singapore banks`, which the starter dashboard already uses), becomes a group's name when the picks are exactly that group, falls back to `My dashboard` after `Pick my own instead`, and keeps what the user types.
- `add-role` with a role already active, the bar shows `Cancel` (back to the default dashboard) and step 2's H1 reads `Your new dashboard` instead of `Your first dashboard`.
- `create` `Create dashboard` makes the profile, makes it active, follows the picks and opens `/dashboards/<id>`.
- `switch` the profile menu's `Switch role` lists every profile (`menuitemradio`, the active one checked); choosing one opens its default dashboard, and the sidebar lists its dashboards plus those no profile made.
- `visits` one `visits` row (date, role, path) per app load and per switch, logged once the page settles.
- `since` New and Updated count from the role's latest visit before today when there is one (`GET /profile` shows it as `last_visit`), else from the previous run.

## How to get to it (user POV)

- Open the app with no active profile: `/` goes to `/setup`.
- Profile button at the sidebar bottom, then `Add a role`.
- Profile button, then a profile under `Switch role`.
- `IntelMonitor` at the top of `/setup` goes home; so does `Cancel` when a role is already active.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok. Read `verify api /profile`, `verify api /profiles`, `verify api /follows` and `sqlite3 data/intelmonitor.db "select * from visits"` first.
- Save the store (`verify store save u3`) before creating a profile; onboarding writes a profile, a dashboard, follows and visits.

- **First visit.** With no active profile (`verify api /profile` shows `"role": null`), run `pnpm -C web verify open home`. The URL becomes `/setup`, the H1 reads `What is your role?`, and `snapshot -i` lists four role links and buttons `TCRD ...` and `FMD ...`.
- **Pick a role.** Click `link "Technology and cyber risk supervisor ..."`. The URL becomes `/setup?role=tech_cyber_supervisor`, the H1 reads `Your first dashboard`, the footer reads `19 entities, 3 topics`, and the preview reads `N developments, n High` with three rows. Compare the ticks with `verify api "/onboarding/suggestions?role=tech_cyber_supervisor"` (`picks`).
- **Trim and search.** Untick a checkbox such as `Singtel ...`; the footer count drops by one and the preview count refetches. Fill `Find an entity or topic` with `visa`; only matching rows show, in any group.
- **More to add.** Click `button "Central banks and regulators 5"`; the group opens with its rows.
- **Create.** Click `Create dashboard`. The URL becomes `/dashboards/<id>`; `verify api /profile` shows `id` and `role` `tech_cyber_supervisor` and that `default_dashboard_id`; the profile button reads the role name.
- **Switch.** Click the profile button, then `menuitemradio "TCRD ..."`. The URL becomes TCRD's dashboard (`verify api /profiles`, `default_dashboard_id`), the profile button reads `TCRD`, and `verify api /dashboards` lists TCRD's dashboard and not the user's own.
- **Preset from step 1.** Profile button, `Add a role`, then `button "FMD ..."`. The FMD dashboard opens and `verify api /profile` shows `fmd`.
- **Visits.** After a reload and a switch, `select * from visits` shows one row each, with the role and the page that opened.
- **Other.** Open `/setup?role=other`; one group `Entities MAS supervises` with DBS, OCBC and UOB ticked. Click `Pick my own instead`: nothing is ticked, every group is open, the preview reads `Pick at least one entity or topic.` and `Create dashboard` is disabled.

## Gotchas

- Clean up a created profile by hand: `delete from profiles where id = '<role>'`, delete its dashboards (`profile_id`), the visits rows, and the follows it added (diff `verify api /follows`); `delete from meta where key = 'active_profile'` brings back the first visit.
- The TCRD and FMD profiles are seeded once (`meta profiles_seeded`); deleting one keeps it deleted.
- The user's own profile for a role has the role as its id, so onboarding twice with one role adds a dashboard to that profile and makes it the default.
- Visits before today move the New marker: a visit row dated yesterday makes everything published before it lose New. Delete test rows.
- `/setup` has no sidebar or profile menu, so it logs no visit itself; the dashboard it opens does.
