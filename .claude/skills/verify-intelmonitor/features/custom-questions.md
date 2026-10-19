# Custom focus areas

Parked for the testing sessions (phase1-plan.md section 5): no screen offers a custom question any more, since the dashboard has no widgets and the monitor page no focus areas. The API and the stored questions remain; the recipes below need the parked UI back and are kept until the sessions decide (D3).

An analyst writes their own standing question about a subject, optionally picks up to three of the subject's series, and `Draft focus area` asks Claude to word it and answer it for every run.
The preview shows the drafted question, label, subject, lookback and series, one answer per run with state changes, and what the latest answer cites; `Keep` adds it, `Discard` drops it.
A kept question sits in the subject's Focus areas with a `Custom` badge, opens its evidence like any answer, can be edited or deleted, and can be shown as a Focus area widget, which at Medium draws its first series' line beside the answer.
At most 10 custom questions can be kept.

## Sub-features

- `compose` textarea `New focus area for <subject>`, `Series` picker, `Draft focus area` enabled from 5 characters, `<n> custom focus areas left`.
- `series-picker` `combobox "Series"` defaults to `Named in the question`; `Add series` adds rows up to 3 or the subject's listed count; each series once.
- `preview` config list, answers per run (latest first), `Cites <n> developments and <m> series` rows, `Keep` / `Discard`.
- `kept-row` the monitor row with `Custom` badge, `See evidence`, `button "Edit <label>"`.
- `edit` `Edit custom focus area` dialog: Question, Label, Lookback in days (1 to 60), Series (`None` to drop), Save re-answers when wording, lookback or series change; `Delete question` then `Delete` removes it and every widget showing it.
- `widget` a Focus area widget set to the question: `Custom` badge, answer, `See evidence`; at Medium the series line.
- `limit` with no slots left the composer says `You have 10 custom focus areas, the most allowed. Delete one to add another.`

## How to get to it (user POV)

- Monitor page: none since U2 removed focus areas from the Overview.
- Add widget sheet or New dashboard Build gallery, last offer `region "Custom focus area"`; Keep there adds the widget at the picked size.
- `button "Edit <label>"` on a kept question's monitor row.
- Dashboard edit mode, a Focus area widget's settings: pick a `(custom)` option in `combobox "Focus area"`, then `button "Edit custom focus area"`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok; `verify api /custom-questions/slots` shows `left` above 0.
- The store has kept questions to read without drafting: `SGD vs ringgit` on Malaysia (series `fx.sgd.myr`) and `Tariff exposure` on OCBC (`verify api /custom-questions`).
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).

- **Open the composer.** `pnpm -C web verify open monitor malaysia`, `S find role button click --name "Add a focus area"`, wait about 1 s, `S snapshot -i`. `textbox "New focus area for Malaysia"`, `combobox "Series": Named in the question` with option `SGD per Malaysian ringgit`, `button "Cancel"`, `button "Draft focus area" [disabled]`; the full snapshot shows `7 custom focus areas left` (with 3 kept).
- **Length gate.** `S fill @<textbox> "abcd"` keeps `Draft focus area` disabled; `S fill @<textbox> "abcde"` enables it.
- **Cancel.** `S click @<Cancel>`. The composer closes and `button "Add a focus area"` returns; `verify api /custom-questions` is unchanged.
- **Series picker.** Malaysia lists one series, so there is no `Add series`. A subject with several listed series (Singapore banks, OCBC) shows `button "Add series"` once a series is picked, and later rows are `combobox "Series 2"` with `None`.
- **Kept row and evidence.** On `/monitors/malaysia` the row for `SGD vs ringgit` has `button "Edit SGD vs ringgit"` followed by its `link "See evidence"`. Click that link. URL gains `?answer=malaysia%3Acustom-bb2d31643a`; the drawer shows `heading "Evidence"`, the answer as the H3, and `heading "Based on 1 series" [level=4]`.
- **Edit dialog, read only.** `S find role button click --name "Edit SGD vs ringgit"`. `heading "Edit custom focus area"`, `textbox "Question"`, `textbox "Label"`, `spinbutton "Lookback in days"`, `combobox "Series"` (first option `None`), `Delete question`, `Cancel`, `Save`. `S click @<Cancel>` closes it with nothing written.
- **From a widget.** On a dashboard you own, Edit, click a Focus area widget, `S select @<combobox "Focus area"> "Tariff exposure (custom)"`. `button "Edit custom focus area"` appears and opens the same dialog; `verify api /dashboards/<id>` shows `settings.question_id: "custom-121cf28fb9"`.
- **Draft and Keep (not driven, calls Claude).** Fill the textarea, optionally `S select @<Series> "SGD per Malaysian ringgit"`, click `Draft focus area`. The status reads `Drafting the focus area and answering it for every run. This can take a minute.`; `POST /custom-questions` gets `{text, subject_id, series_ids}` (series omitted when none picked). Then `group "Custom focus area preview"` shows the config (`Series` row when any), one row per run (`Run of <date>`), and `Cites ...` or `No sources in the latest run.`. `Keep` toasts `<label> added to <subject>`, the row appears with the `Custom` badge, and `verify api /custom-questions/<id>` has `status: "kept"`. `Discard` deletes the draft. E2E steps 8 (`Custom focus area with answer and citations`) and 26 (`Custom focus area with a series`) cover this.
- **Save and Delete (not driven).** Save toasts `<label> saved`; a change to wording, lookback or series shows `Answering again for every run.` and calls Claude. `Delete question` swaps the footer to `Delete this question and every widget that shows it?` with `Keep it` and `Delete`; Delete toasts `<label> deleted`. There is no Undo.
- **Widget at Medium.** A Focus area widget on `custom-bb2d31643a` at Medium shows the answer beside the `SGD per Malaysian ringgit` line; Small has no line. `verify api /dashboards/<id>/data` returns the widget's `indicator.series.id: "fx.sgd.myr"`.

## Gotchas

- `Draft focus area`, and Save after a wording, lookback or series change, call Claude and can take minutes; the e2e allows 6 minutes.
- A draft exists server side as soon as it is drafted. Leaving the page without Keep or Discard leaves it as `status: "draft"`; the store holds two such orphans (`custom-d80390c0ed`, `custom-0490a2c065`). Drafts do not use slots.
- `verify api /custom-questions` lists drafts and kept questions together; filter on `status`.
- The Series picker renders only after the subject's series load and is absent for subjects with none listed; wait before asserting it is missing.
- Monitor pages have many `See evidence` links; target the one after `Edit <label>` or query `.qrow[data-question-id="<id>"]`.
- Delete removes every widget that shows the question, on every dashboard, and has no Undo. Use `verify store save` first.
- Kept questions belong to the shared store; do not edit or delete ones you did not create.
