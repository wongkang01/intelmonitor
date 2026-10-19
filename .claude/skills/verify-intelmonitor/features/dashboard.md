# Dashboard

A dashboard page has one fixed layout: its name, the subjects it covers as links and `Edit dashboard`; then the Watchlist table, the busiest entities first (groups count as their members): up to 3 entities with a development this month (4 when that is all), each with its new High developments since the last visit and its top development this month in full, then `Show all <n> entities`; then `Latest developments`, the feed of the dashboard's developments under High, Medium and Low headings with New and Updated marked, beside `Upcoming dates` with full labels as links to their developments, each with its development's title.
The feed head says how many are new since the last visit (or since the previous update on a first visit).
There is no widget grid, Add widget, edit mode or widget sizes; they are parked until the testing sessions decide.

## Sub-features

- `watchlist` meta `Most new High first`. Rows sort by new High count, then the top development's priority, then its date; entities with nothing this month come last. Collapsed, it shows up to 3 entities with a development this month, or 4 when exactly 4 have one; `button "Show all <n> entities"` (`aria-expanded`) lists every entity and `Show fewer` collapses it; no button when nothing is hidden; `Nothing this month for these entities.` when none has one. Each row: name (opens its page), `1 new High` or `None`, the top development this month with its priority badge (opens its popup in the entity's priority), date; `Nothing this month. Latest: <title>` or `No developments yet.` otherwise. Hidden when the dashboard has no entities.
- `feed` `Latest developments`: the period control, the facet filters and the rows of [developments](developments.md) under the column header, 15 rows, then `Show all <n>` to the dashboard's developments list with the same filters.
- `new-count` the feed head's `<n> new since your last visit on <date>`, `<n> new since <date>`, or `Nothing new ...`.
- `upcoming` `Upcoming dates`: date, the full label as a link to its development, then the development's title in full (no `From:`), since labels such as `Applications close` mean nothing alone; `No upcoming dates in this dashboard's news.` when empty.
- `edit` `Edit dashboard` opens the picker with the current picks, the name and `Save` ([new-dashboard](new-dashboard.md)).

## How to get to it (user POV)

- Sidebar `Dashboards` list: click a dashboard name (`link "<name>"` in `navigation "Main"`).
- Home (`/`) opens the active profile's default dashboard, or the first in the sidebar.
- After onboarding's `Create dashboard` or New dashboard's `Create dashboard`, the new dashboard opens.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; `Singapore banks` exists (`verify api /dashboards`).
- Opening a development from the dashboard marks it read; note `verify api "/developments?dashboard_id=<id>"` read states first, or delete the triage row afterwards.

- **Open.** `pnpm -C web verify open dashboard singapore-banks`, then `ab snapshot -i`. `heading "Singapore banks" [level=1]`, the subject links, `button "Edit dashboard"`, `region "Watchlist"`, `region "Latest developments"` and `region "Upcoming dates"`. No `Add widget`, `Edit`, `Mark all reviewed` or widget groups.
- **Watchlist matches the API.** `verify api /dashboards/<id>/overview`: the `watchlist` entries with a `top`, sorted as above, are the first 3 rows (4 when exactly 4 have one); `new_high` is the count (`None` at 0), `top.title` is the row's link and `top.priority` its badge. TCRD (19 entities, 15 with news this month) shows 3 rows and `Show all 19 entities`; Singapore banks shows its 4 and no button.
- **Top development opens.** Click a watchlist title. The URL gains `development=<top.id>&scope=subject%3A<entity>`; the popup shows that entity's priority. Esc returns to the dashboard.
- **New count.** The feed head's number equals `new_count` from the overview, and the date is `since`; `verify api /profile` `last_visit` decides between `since your last visit on` and `since`.
- **Feed.** Rows come in the order of `verify api "/developments?dashboard_id=<id>&days=30&dismissed=false"`. At most 15 show; `link "Show all <n>"` opens `/developments?dashboard=<id>` with the feed's period and facets in the query.
- **Upcoming dates.** Rows match the overview's `upcoming` (date, label, `development_title`). A label link opens the popup, `?development=<development_id>&scope=dashboard%3A<id>`.
- **Edit dashboard.** `ab find role button click --name "Edit dashboard"`. A modal `Edit dashboard` opens with the current picks ticked and the name filled; `Save` writes `subject_ids` and name (`verify api /dashboards/<id>`), and the watchlist and feed refetch. Esc closes without writing.
- **1024 px.** `ab set viewport 1024 800`: the upcoming column drops below the feed and `document.documentElement.scrollWidth` stays 1024.

## Gotchas

- The watchlist table is laid out by entity; topics only appear in the feed. A dashboard of topics alone has no Watchlist.
- `New High` counts developments first published after the last visit that are High for that entity, not read and not dismissed; opening one from anywhere drops it from the count.
- The feed's filters write to the dashboard URL (`?days=7&priority=High`); a reload keeps them and `Show all` carries them.
- `Singapore banks` is shared with other agents and test runs; its subjects and the test dashboards beside it are not fixed fixtures.
- The widget code (Since your last review, Developments, Direction, Focus area, Indicator, custom questions, Add widget) is parked, not deleted; `verify api /dashboards/<id>/data` still answers for old widgets, but nothing shows them.
