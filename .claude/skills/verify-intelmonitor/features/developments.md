# Development feeds

A scope's developments in the latest run as a feed: High and adverse first, then other High, then Medium adverse, then other Medium, then the rest, newest first within each group.
Priority and adverse are for the subjects in view, so a development adverse to OCBC only ranks as adverse on OCBC's page.
A source gate (`api/intelmonitor/pipeline/corroboration.py`) decides which developments are shown: 2 or more distinct news outlets (counted by parent domain, so `markets.ft.com` and `ft.com` are one), or 1 reputable outlet (`REPUTABLE_DOMAINS` in `ingest/sources/search.py`), or any official, research or data source (the entity's own site counts as official), or 4 or more social posts (X and HardwareZone).
The rest are unconfirmed and left out of every list, count and total by default: feeds, facet and period counts, `See all <n>`, alerts, dashboard widgets, the sidebar, the Related tab and its impacts, the graph, search, answer evidence, and the briefs written from the next run on.
The developments page (`/developments?dashboard=<id>`) shows a dashboard's feed with a words filter; the dashboard shows its first 15 rows; a monitor page's Developments tab (`/monitors/<id>/developments`, section `Developments about <name>`) shows one subject's feed, and its Overview the top 5 rows without headings.
Rows sit in one list under a column header, `Priority`, `Finding`, `Date` (hidden from the accessibility tree and below 640 px), in that order; each row's priority badge is in the Priority column.
Each row has a status column (priority badge High, Medium or Low for the subjects in view, then New or Updated), the full wrapping title, one line on who it impacts (`Impacts DBS · By MAS · About Banking regulation · Could also affect UOB`), a facts line (`Unconfirmed` when it is, `High for OCBC` when the subjects in view disagree, `Adverse event` when it applies, the tone, the source counts, the category), and at the right the date and a visible `View sources ›` cue.
The source counts read `3 outlets · 12 posts · 1 official source · 2 research papers · 1 data source`, each part left out when zero; outlets are distinct parent domains, not articles.
The whole row opens the development's popup over the list (see [development-page](development-page.md)).
Above the rows: the period control (Today, This week, This month, All time; This month is the default), the facet buttons Priority, Adverse event, Tone, Category and Source type, each a popover with All first and the values with counts, and the checkbox `Show unconfirmed <n>` while some unconfirmed developments match.
The period, facets, words and `unconfirmed=true` live in the URL, so a reload and closing a development popup keep them.
Dismissed rows are left out; `Show dismissed (N)` at the end brings them back, marked `Dismissed`.

## Sub-features

- `feed-open`: the dashboard shows the first 15 rows and `Show all <n>` opens the developments page with the same filters; the monitor page's Developments tab shows the subject's feed.
- `feed-rows`: one ordered list under the `.frow-head` column header, High adverse rows first, then High, Medium adverse, Medium and the rest, newest first in each; a priority filter leaves only its rows.
- `feed-gate`: unconfirmed developments are not listed or counted by default; `Show unconfirmed <n>` (`unconfirmed=true`) lists them among the others, each marked `Unconfirmed`, and adds them to the period and facet counts. The checkbox shows only while `n` is above 0 or it is on.
- `feed-row`: priority badge, New badge or Updated word, full title, impact line, facts line, date and `View sources ›`.
- `feed-period`: the period segments with counts; This month by default, `days=1|7|any` otherwise.
- `feed-facets`: Priority, Adverse event (single choice), Tone, Category and Source type narrow the list; the button reads `Priority`, `Priority: High` or `Priority: 2 selected`; zero-count values are hidden.
- `feed-words`: `Filter by words` on the developments page narrows after a 250 ms pause and writes `q=`.
- `feed-open-row`: a row adds `development=<id>&scope=dashboard:<id>` (or `scope=subject:<id>` on a monitor page) to the list's URL.
- `feed-back`: closing the popup (close, Esc, backdrop or browser Back) returns to the feed with the same URL and scroll.
- `feed-empty`: `No developments in this period. Show this month` (the next wider period that has developments), `No developments yet.` when no period has any, and `No developments match these filters. Clear filters`, or `No developments match these filters in this period. Show this week · Clear filters` when a wider period has matches (the period counts follow the filters).
- `feed-dismissed`: `Show dismissed (N)` and `Hide dismissed`.
- `feed-new`: the foot line `New: first reported after <date>. Updated: new reports since then.` names the date New and Updated count from (the previous run's date by default).
- `feed-bad-params`: hand-edited facet values the list cannot apply are ignored.

## How to get to it (user POV)

- Dashboard: the `Latest developments` feed, and its `Show all <n>` opening `/developments?dashboard=<id>` with its period and facets.
- Monitor page: the `Developments` tab, or the Overview's `See all ... developments`.
- No sidebar or ⌘K entry opens the developments page.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok and no run is computing (`run` check), since counts change while one runs.
- `ab` below means `agent-browser --session im-verify` (or `--session $VERIFY_SESSION`). `@ref` is the ref `ab snapshot -i` prints for the named control; snapshot again before each click.
- Read current counts with `pnpm -C web verify api "/developments?dashboard_id=<id>&days=30&dismissed=false"` (`matching`, `dismissed`, `since`, `facets`).

- **Open.** `pnpm -C web verify open developments <dashboard>`. Heading `Developments` level 1; group `Period` with `This month <n>` pressed; buttons `Priority`, `Adverse event`, `Tone`, `Category`, `Source type`; the rows are one ordered list under the Priority, Finding and Date header, their badges in the API's order.
- **Period.** `ab click @ref` for button `This week <n>`. URL gains `days=7`; rows equal the API's `matching` for `days=7&dismissed=false`. `This month` drops `days`.
- **Facet.** `ab click @ref` for button `Priority`, then checkbox `High <n>`. URL gains `priority=High`, the button reads `Priority: High`, every row's badge is High. Check another value: the button reads `Priority: 2 selected`. Checkbox `All` clears it. `ab press Escape` closes the popover and focus returns to the button.
- **Adverse event.** Button `Adverse event`, radio `Yes <n>` (or `No <n>`): URL gains `adverse=true` and the button reads `Adverse event: Yes`; every row's facts line shows `Adverse event`.
- **Open a row and come back.** With filters set and the list scrolled, `ab click @ref` on a row's title link. The URL is the feed's URL plus `development=<id>&scope=dashboard%3A<id>`. Click `Close development`: the URL is the feed's URL exactly, filters, rows and scroll unchanged.
- **Reload keeps it.** `ab reload`: URL, button names and rows unchanged.
- **Unconfirmed.** Read `unconfirmed` from `verify api "/developments?subject_id=dbs&days=30&dismissed=false"`, then `verify open monitor-developments dbs`. With `n` above 0, `ab click @ref` on checkbox `Show unconfirmed <n>`: URL gains `unconfirmed=true`, `n` more rows appear in order, each with `Unconfirmed` in its facts line, and the `This month` count grows by `n`. Open one: the popup's labels read `Unconfirmed` and its sources start with `Unconfirmed: not enough independent sources yet.` Uncheck: the URL drops the parameter and the rows go.
- **Words.** `ab fill @ref "<word>"` on searchbox `Filter by words`, wait 1 s: URL gains `q=`, rows match the API with `q=`.
- **Empty.** Fill `zzzqqq`: `No developments match these filters. Clear filters`; the button clears facets and `q`, keeping the period. On `Today` with nothing that day: `No developments in this period. Show this week`. With `Adverse event: Yes` on `Today` when only the week has matches: `No developments match these filters in this period. Show this week · Clear filters`; `Show this week` keeps the filters.
- **Monitor page.** `pnpm -C web verify open monitor-developments dbs [query]`. Section `Developments about DBS` with the same controls and headings, every row shown; rows open the popup with `scope=subject%3Adbs`. The Overview (`verify open monitor dbs`) shows `Top DBS developments`: the first 5 confirmed rows in the same order, with badges and no headings.
- **Bad parameters.** `pnpm -C web verify open developments <dashboard> "priority=Bogus&tone=x&adverse=maybe&category=bogus&source=foo&days=abc"`: buttons read plain `Priority` and so on, and `This month` is pressed.
- **Proof.** `pnpm -C web verify shot phase1-U1/<step>`; the `.aria.txt` holds the button names and counts.

## Gotchas

- The developments page belongs to a dashboard: without `dashboard=<id>` it shows `Open developments from a dashboard.`
- Filters replace the history entry, so Back leaves the page instead of undoing a filter. Opening a development pushes an entry, so Back from it returns to the feed.
- The popover dialog does not appear in `snapshot -i`; its checkboxes and radios do, listed right after the expanded button.
- New and Updated count by published dates from the `since` date in the API response, not from the review; a read row drops its New or Updated mark.
- Opening a row marks it read in the live store. Mark it unread afterwards with `pnpm -C web verify api PATCH /developments/<id>/triage '{"read": false}'` when the drive must leave no trace.
