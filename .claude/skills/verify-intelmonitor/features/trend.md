# Trend

The Trend tab explains why a subject's measured series moved in each weekly run.
It opens on the latest run's note: a headline, a body whose `[n]` citations are numbered links, and the questions whose state changed that run.
Below the note, a chart of one series covers the 12 months to the latest run, with the selected run's week banded, Watch and Needs attention developments as ticks along the bottom, and the note's cited developments as numbered markers on the line.
The rail lists the facts the note was given about the charted series, with its source.
Standing questions by run shows each question's state in every run from 30 Jul, plus the selected run's state and answer.
`Before 27 Jul` shows the series where no document, run or note exists.

## Sub-features

- `tabs` `navigation "View"` with `link "Overview"` and `link "Trend"`, only for subjects with measured series.
- `runs` `region "Why it moved"`, `group "Run"`: one button per run, newest first (`24 Sep` ... `30 Jul`), then `Before 27 Jul`. The section meta reads `Run of 24 Sep against 17 Sep`, `Run of 30 Jul, the first`, or `No run: before collection started`.
- `note` headline (`.tr-lead`), body with cite links `link "1"`, `link "2"`, ... that open the evidence drawer; `No note for this run.` when a run has none.
- `state-changes` one line under the note (`.tr-changes`): `Licensing New → Watch · ...`.
- `series` 1 series: its name in bold; 2 or 3: `group "Series"` of buttons by short name; more: `combobox "Series"`. Defaults to the note's series.
- `period` `group "Period"`: `12 months`, `3 months`, `1 month` for daily series; monthly series drop `1 month`; quarterly series show no group. Narrower windows end on the selected run.
- `chart` `.tr-chart svg` labelled `<series>, <from> to <to>, latest <v> on <date>`; ticks `link "<date>: <n> developments, Needs attention, Watch"`; markers `link "Cited <n>: <title>"`; hover snaps a crosshair and a `tooltip`.
- `facts` `region "Facts"`, meta `Given to the note` (a run) or `Computed` (Before): `Latest, <date>`, change, largest day, record, and the peg rule; `link "Open source table"`.
- `questions-by-run` `region "Standing questions by run"`: a table with `rowheader "<label>"`, a strip cell `30 Jul: Stable 6 Aug: Watch ...` (a week without a run reads `No run`), the state cell and the answer cell for the selected run.
- `cited` `region "Cited"` lists the note's developments numbered as in the body; absent when the selected run has no note.

## How to get to it (user POV)

- A monitor page's `link "Trend"` in `navigation "View"` (e2e step 25).
- Direct URL `/monitors/<id>/trend`.
- Subjects without series have no tabs. Their `/trend` URL shows `<Subject> has no measured series.`

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).
- Every subject has a Trend tab except `sea-regional-banks`, `maybank`, `cimb` and `bangkok-bank`. Check with `verify api /subjects/<id>/page` (`trend` true) or `verify api /subjects/<id>/trend` (`series` non-empty).
- All 9 runs from 30 Jul to 24 Sep have a note for each series subject; `documents_from` is 27 Jul.
- Good subjects: `circle` (2 series, so a `Series` button group, and 3 cited developments on 24 Sep), `fed` (1 series, 4 cites), `ocbc` (8 series, so a `Series` select). Tether and DBS have notes with no cites.
- Read only: nothing here writes to the store.

- **Open from the tab.** `pnpm -C web verify open monitor circle`, `S snapshot -i`, `S click @<link "Trend">`, `S wait --load networkidle`. The URL ends `/monitors/circle/trend`; `link "Trend"` is `aria-current="page"`.
- **Latest note.** `S get text 'section[aria-labelledby="why"] .mon-sec-head .meta'` reads `Run of 24 Sep against 17 Sep`. `S get text .tr-lead` equals `runs[-1].note.headline` from `verify api /subjects/circle/trend`. The snapshot shows `link "1"` to `link "3"` in the body and `link "Cited 1: Binance agreed to invest $100 million ..."` to `Cited 3` on the chart; `S get count .tr-mk` is 3.
- **Series default.** `button "USDC circulating supply"` is pressed (the note's series), and `S get attr '.tr-chart svg' aria-label` reads `USDC circulating supply, 24 Sep 2025 to 24 Sep 2026, latest $75.9B on 23 Sep 2026`.
- **Facts.** `S get text 'section[aria-labelledby="facts"]'` reads `Given to the note`, `Latest, 23 Sep $75.9B`, `Change since 16 Sep +$2.2B (+3.0%)`, `Largest day ...`, `Highest since ...`, `DefiLlama`, `Open source table`.
- **Earlier run.** Click `button "17 Sep"` in `group "Run"`. The meta reads `Run of 17 Sep against 10 Sep`, the headline changes to that run's note, and the table headers read `17 Sep` and `Answer, 17 Sep`.
- **Zoom.** Click `button "1 month"`. The chart label reads `... 17 Aug 2026 to 17 Sep 2026, latest ...`, a window that ends on the selected run.
- **Switch series.** Click `button "USDC off its USD peg"`. The chart label names the peg series, and the facts become `Latest`, `Widest gap` and `Needs attention at 0.5% off for 24 h`.
- **Before collection.** Click `button "Before 27 Jul"`. The meta reads `No run: before collection started`, the lead reads `No documents before 27 Jul`, the Facts meta reads `Computed`, `S get count .tr-mk` and `S get count 'section[aria-labelledby="cited"]'` are 0, and every state cell reads `No run`.
- **Cite opens evidence.** Back on `24 Sep`, click `link "1"`. The URL gains `?evidence=b7388cd9d23efb1d-0` and the drawer's H3 is the cited title. `S press Escape` closes it and removes the parameter.
- **Question states per run.** `S snapshot -i` in `region "Standing questions by run"`: headers `Question`, `30 Jul to 24 Sep`, `24 Sep`, `Answer, 24 Sep`; for Circle, `rowheader "Strategy"` has the strip `30 Jul: Stable ... 24 Sep: Needs attention` and the state cell `Needs attention`. Cross-check `questions[].states` in `/subjects/circle/trend`.
- **Many series.** `pnpm -C web verify open trend OCBC`: `combobox "Series": Loan-to-deposit ratio, all currencies` and a Period group with only `12 months` and `3 months` (monthly). `S select @<combobox "Series"> "NPL ratio, all sectors"`: the chart reads `NPL ratio, all sectors, Q3 2025 to Q3 2026, latest 0.96% for Q2 2026` and the Period group goes away (quarterly).
- **One series.** `verify open trend fed`: no Series control, `.tr-name` reads `Fed funds effective rate`, Period offers all three windows.
- **No series.** `verify open trend maybank`: `.page-message` reads `Maybank has no measured series.` and there is no `navigation "View"`.

## Gotchas

- The series you pick stays picked when you change runs; only a fresh load returns to each note's own series. Reset before asserting that a run's note and chart agree.
- The window you pick also persists across runs, and a narrower window re-anchors on each selected run.
- `Before 27 Jul` exists only while the chart's start is before `documents_from`.
- Chart markers and ticks are links with long names; count them with `S get count .tr-mk` and `S get count .tr-tk` rather than grepping the snapshot.
- The note's cite numbers index `note.developments`; a `[n]` with no matching development renders nothing.
- `verify open trend <name>` tries an exact id or name, then the first substring match in `/subjects` order: `trend singapore` opens the entity Singapore, and `trend banks` opens Singapore banks. Use ids.
- The Trend tab shares the monitor head and the rail's Actions, so `Mark reviewed` and notes here write to the store like on Overview.
