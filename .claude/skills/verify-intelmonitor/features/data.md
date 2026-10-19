# Data tab

A monitor page's Data tab shows the subject's measured series and explains why they moved each week.
It opens with the Indicators section (rows a detector flagged first, under `Notable changes`), then `Why it moved`.
`Why it moved` opens on the latest week's note: a headline and a body whose `[n]` citations are numbered links.
Below the note, a chart of one series covers the 12 months to the latest update, with the selected week banded, High and Medium developments as ticks along the bottom, and the note's cited developments as numbered markers on the line.
The rail lists the facts behind the note for the charted series, with its source.
`Before 27 Jul` shows the series where no document or note exists.
Series carry no Watch or Stable status, and no focus areas appear on the tab.

## Sub-features

- `tabs` `link "Data"` in the monitor head's `navigation "Monitor views"`, only for subjects with listed series (see monitor-page.md).
- `indicators` `region "Indicators"`: one row per listed series with latest value and period, change and window, and a 12-month line whose hover shows a `tooltip`. `No data` or `Stale` is the only badge. Flagged rows come first and link to the development that carries the detection, with an accent `View the development` cue under the name.
- `weeks` `region "Why it moved"`, `group "Week"`: one button per weekly update, newest first (`8 Oct` ... `30 Jul`), then `Before 27 Jul`. The section meta reads `Week to 8 Oct` or `Before 27 Jul`.
- `note` headline (`.tr-lead`), body with cite links `link "1"`, `link "2"`, ... that open the development's popup; `No note for this week.` when a week has none.
- `series` 1 series: its name in bold; 2 or 3: `group "Series"` of buttons by short name; more: `combobox "Series"`. Defaults to the note's series.
- `period` `group "Period"`: `12 months`, `3 months`, `1 month` for daily series; monthly series drop `1 month`; quarterly series show no group.
- `chart` `.tr-chart svg` labelled `<series>, <from> to <to>, latest <v> on <date>`; legend `High`, `Medium`; ticks `link "<date>: <n> developments, High, Medium"`; markers `link "Cited <n>: <title>"`.
- `facts` `region "Facts"`, meta `Behind the note` (a week) or `Computed` (Before): `Latest, <date>`, change, largest day, record, and `Flagged at` for a peg rule; `link "Open source table"`.
- `cited` `region "Cited"` lists the note's developments numbered as in the body, each with its priority badge for this subject (the same as on its Developments tab).

## How to get to it (user POV)

- A monitor page's `link "Data"` in `navigation "Monitor views"`.
- The Overview summary band's `link "Open Data"`.
- Direct URL `/monitors/<id>/data`. The old `/monitors/<id>/trend` redirects there, keeping its query and hash.
- A subject without series has no Data tab; its `/data` URL shows `<Subject> has no measured series.`

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- Check a subject has series with `verify api /subjects/<id>/trend` (`series` not empty). On 8 Oct: `ocbc` and `dbs` (1 series each, 2 cites in the latest note), `mas` (2 series, a `Series` button group), `singapore` (16 series, a `Series` select). `aws` has none.
- Read only: nothing here writes to the store, except that opening a cited development marks it read.

- **Open from the tab.** `pnpm -C web verify open monitor ocbc`, `ab snapshot -i`, click `link "Data"`. The URL ends `/monitors/ocbc/data`; `link "Data"` is `aria-current="page"`.
- **Indicators.** `ab snapshot -s 'section[aria-labelledby="indicators"]' -c`: rows under `Notable changes` first (for OCBC on 8 Oct, the share price), no `Watch` or `Stable` text. Hover `.ind-line`; a `tooltip` shows a value, a date and the series name.
- **Latest note.** `ab get text 'section[aria-labelledby="why"] .mon-sec-head .meta'` reads `Week to 8 Oct`. `ab get text .tr-lead` equals `runs[-1].note.headline` from `verify api /subjects/ocbc/trend`; `ab get count .tr-mk` equals the note's developments.
- **Facts.** `ab get text 'section[aria-labelledby="facts"]'` starts `Facts Behind the note` and lists `Latest, <date>` and the change.
- **Earlier week.** Click `button "1 Oct"` in `group "Week"`. The meta reads `Week to 1 Oct` and the headline changes to that week's note.
- **Before collection.** Click `button "Before 27 Jul"`. The meta reads `Before 27 Jul`, the lead `No news before 27 Jul`, the Facts meta `Computed`, and `ab get count .tr-mk` is 0.
- **Cite opens the development.** Click `link "1"` in the note. The URL gains `development=<id>&scope=subject%3Aocbc` and the popup's title is the cited title. Esc returns to the Data tab at the same scroll.
- **Many series.** `verify open data singapore`: `combobox "Series"`; selecting another series changes the chart label.

## Gotchas

- The series you pick stays picked when you change weeks; only a fresh load returns to each note's own series.
- The window you pick also persists, and a narrower window re-anchors on each selected week.
- `Before 27 Jul` exists only while the chart's start is before `documents_from`.
- Chart markers and ticks are links with long names; count them with `ab get count .tr-mk` and `ab get count .tr-tk`.
- `verify open data <name>` tries an exact id or name, then the first substring match in `/subjects` order; use ids.
- Indicator rows are not interactive unless a detector event backs them, so most rows appear only in the full snapshot, not in `snapshot -i`.
