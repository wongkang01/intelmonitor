# Iteration plan: after the POC review

This plan follows the critical review of 2026-09-26 and three gaps the user raised: weak trends, no onboarding, and no way to reorder dashboards.
It extends `poc-plan.md`; where they disagree, this plan wins for the items it lists.

## Decisions

- The POC stays single-user.
  There is no login, no roles, no teams and no dashboard sharing.
  Auth and roles come after end users confirm the app is useful.
- Per-user state from the review (review watermark, triage, alert reads, onboarding seen, sidebar order) is stored as global single-user state.
  No `user_id` columns and no auth seams are added now.
- No audit log and no access logging in this iteration.
- Non-trivial UI gets static mocks first.
  Implementation of mocked features waits for the user's pick.
- Leftover test dashboards in `data/intelmonitor.db` stay until the user says otherwise.

## Work items

### A. Independent fixes (no design input needed)

1. **Sidebar reorder.**
   Drag dashboard rows in the sidebar.
   The row's options menu gets Move up and Move down for keyboard users.
   `PUT /dashboards/order` takes the full list of ids and rewrites `dashboards.position`; a list that is not every dashboard once gets a 409.
   The dashboard color stays fixed when the order changes: each dashboard now stores its color.
   Existing dashboards kept the color their position gave them, a new one gets the least used color, and a save without a color keeps the stored one.
   Picking a color in the options menu now persists; before, the web client left it out of the save.
   Drag works with a mouse or pen; touch scrolls the sidebar, so touch users use Move up and Move down.
2. **44 px hit targets.**
   Sidebar rows, nav items and list rows are 32 to 35 px tall; `PRODUCT.md` asks for 44 px targets.
   Pad the hit areas without making the layout visibly looser.
   Built: the 44 px touch sizes never applied, because each area's stylesheet came later in the cascade and reset the height.
   They now live in `web/styles/touch.css`, imported last, and apply on any device with a touch screen (`any-pointer: coarse`).
   The sidebar options button has a 44 px wide hit area as tall as its row.
   In the dashboard options popover, Move up, Move down and Delete are 44 px tall on touch, and the color swatches are 44 px circles in two rows of four.
   The Since widget shows one row fewer on touch, so its 44 px rows stay clear of its footer.
   With a mouse, rows stay 32 and 34 px: stacked rows touch, so a row's hit area cannot be taller than the row without covering its neighbours, and 44 px rows would loosen the layout.
3. **Dashboard-scoped "Show all".**
   On Singapore banks, the Since widget says 79 new, but "Show all" opens `/monitors/singapore-banks`, which says 34 new.
   The Banking regulation items drop out.
   "Show all" on a dashboard widget opens a view scoped to that dashboard's subjects.
   Built: a Since or Developments widget that follows every subject on a dashboard links to `/developments?dashboard=<id>`, with `&changed=1` for Since.
   The page lists the dashboard's developments with the monitor page's What changed rows, and its counts match the widget's ("79 new, 1 updated, 9 need attention").
   It reads `GET /developments?dashboard_id=<id>&changed=true`, which now returns every match unless `limit` is set.
   Answer changes are not listed there, since they are not developments.
   B6 replaces this page at the same route, adding facets as further parameters.
   The evidence drawer now keeps a page's own query parameters when it opens and closes.
4. **Search placeholder.**
   The placeholder reads "Search or ask about a topic, group or entity", but there is no ask.
   Reword it to what search does.
   Built: "Search monitors, developments and documents"; the field's accessible name is "Search".
5. **Full-text search.**
   `GET /search?q=basel` returns `[]` because search only matches subject names.
   Add SQLite FTS5 over development titles and summaries and document titles and text.
   The ⌘K panel groups results: subjects, developments, documents.
   A development opens the evidence drawer; a document opens its development's evidence.
   Built: `documents_fts` indexes document titles and text, kept in sync by triggers on `source_documents`.
   `developments_fts` indexes each run's development titles with, as summary, the statements of the development's other findings; developments have no summary column, and the title is the lead finding's statement.
   The pipeline reindexes a run when it stores its developments, and the store builds both tables from existing data when they are first created.
   `GET /search` returns `{subjects, developments, documents}`; the full-text groups cover the latest run, up to `limit` (5) each, best first by BM25 with titles weighted 4 to 1.
   Only documents that are a source of a latest-run development are listed, since a result opens that development's evidence; a document cited by several opens the first in display order.
   Every word must match and the last also matches as a prefix, so results follow typing; there is no stemming, which keeps prefixes predictable.
   The panel shows at most 5 rows per group; arrows and Enter move through all groups in order.
6. **Honest run history.**
   Repeated manual reruns of the same as-of date each say "No new developments", because each compares with the previous execution.
   Word each row against the previous as-of date instead.
   Runs 1 and 2 are labelled Scheduled and the popover promises "Next scheduled run", but there is no scheduler (`/runs/schedule` returns `nominal: true`).
   Label runs by how they actually ran and say plainly that runs are manual for now.
   Built: every execution's counts compare with the previous as-of date, like the run's stored changes, and the result line names it: "303 new, 15 updated, 34 need attention since 17 Sep".
   `im run` is logged as `cli` and shown as "Command line"; Run now shows "Run now, Analyst".
   At startup the API relabels old "scheduled" rows and gives each old rerun that changed nothing the counts of the execution before it.
   `GET /runs/schedule` is gone; the popover foot reads "Runs are manual for now."
7. **Trend data.**
   `GET /subjects/{id}/trend` returns, over 12 weeks ending on the run date:
   material developments per week split by category;
   for topics, developments per week split by stage;
   for groups, developments per week split by member;
   and each standing question's state per run.
   The corpus spans 27 Jul to 23 Sep and there are 2 runs, so weekly series come from publication dates and the per-run series is short.
   Built: `GET /subjects/{id}/trend` returns `SubjectTrend`; the web hook is `useTrend`.
   Weekly series count the latest run's developments by first publication, bucketed by the same helper as the Direction widget (`week_spans` and `weekly_counts` in `queries.py`).
   Replaced by F6 in `structured-data-plan.md`: the endpoint now feeds the Trend tab with the subject's series, marked developments, each run's note and its questions' states and answers per run; the weekly counts, which nothing read, are gone.
   Each week carries its development and material counts; material means materiality Notable or above, as in the Direction widget.
   `categories` lists every category in a fixed order, with material developments only; `stages` (topics) and `members` (groups) count every development.
   Developments without a stage are left out of `stages`; a development tagged to several members counts for each, and one tagged only to the group counts for none.
   `runs` lists the complete runs dated within the 12 weeks, and each question's `states` aligns with it, null where the question has no answer; built-in questions come first, then kept custom ones.
8. **Soft delete.**
   Deleting a note or a dashboard sets `deleted_at` instead of removing the row.
   The existing toast offers Undo.
   A restore endpoint exists for each; the Trash view waits for mocks.
   Built: `dashboards` and `analyst_actions` gained a `deleted_at` column; the store adds missing columns in place when it opens, keeping every row.
   Every read skips deleted rows, and editing or reordering treats a deleted dashboard as gone.
   `POST /dashboards/{id}/restore` and `POST /notes/{id}/restore` undo a delete; restoring something not deleted changes nothing.
   A restored dashboard returns to its sidebar position, and Undo reopens it if it was open when deleted.
   Deleting a custom question also drops its widgets from deleted dashboards, so a restored one never shows a question that is gone.
   Deleted rows are kept with no purge, so the walkthrough's cleanup leaves soft-deleted "E2E" dashboards and notes behind; B5 purges them.

### B. Mocked first, built after the pick

Mocks: `mocks/*.html`. Picks from the user on 2026-09-27 are noted per item.

1. **Trend section on monitor pages.** Picked A (`mocks/trend.html`), but on hold.
   The mocks chart counts of developments; the user wants trends to show how the analysis of a topic, group or entity moves over time.
   Deferred until pilot feedback on the current POC and a larger ingest make trend analysis possible.
   `mocks/trend-future.html` shows three directions for a trend widget and a Trend section or tab on the assumption that a year of weekly runs exists: A Ledger (question state history), B Brief (a written trajectory with turning points), C Drivers (themes by month and peer comparison).
   The `GET /subjects/{id}/trend` endpoint from A7 stays as groundwork.
   Structured data is now in scope, and `structured-data-plan.md` (F6) replaces this item with a trend view on real series.
2. **Onboarding and help.** Picked A (`mocks/onboarding.html`): coach marks.
   A first-run tour of 5 steps shown one at a time over the dimmed dashboard: sidebar (dashboards and monitors), the Since widget, the evidence drawer, Mark all reviewed, New dashboard and Generate. Back, Next and Skip.
   Help is a profile-menu dialog with a glossary of states (New, Updated, Watch, Needs attention, Stable) and materiality levels, the shortcuts, and Replay tour. It replaces the Keyboard shortcuts item, and `?` opens it.
   "Tour seen" lives in the profile.
   Built: `Profile.tour_seen_at` records when the tour last started; the tour starts once, on the first dashboard opened while it is null, and marks it when it shows.
   The tour is a transparent modal `<dialog>` (`components/shell/Tour.tsx`), so the page is inert behind it; a ring's spread shadow dims all but its target, and a target missing from the dashboard (no Since widget) leaves the card centred over a plain scrim.
   The evidence step opens the drawer on the first Since row, or the first development or answer on the dashboard, and puts the URL back when the step ends.
   Esc, Skip tour or the close button end it; focus goes to each step's primary button and returns to the profile button after a replay.
   Help replaces Keyboard shortcuts in the profile menu, after a rule, and `?` opens it; Replay tour opens the default dashboard first when elsewhere.
   Its materiality rows come from `GET /materiality-levels`: the names, the rubric Jev scores against (moved to `MATERIALITY_RUBRIC` in `pipeline/params.py`), whether each level is material or needs attention, and its count in the latest run.
   The walkthrough marks the tour seen before it starts and restores the profile after.
3. **Review and triage.** Picked A (`mocks/triage.html`): hover actions.
   Read, flag and dismiss replace the date on the hovered or focused row; filters are a segmented control (All, Unread, Flagged, Dismissed), and All hides dismissed items.
   Mark reviewed sets a watermark per subject; "new" counts developments changed in runs after the watermark and not individually read. It keeps flags and dismissals.
   Follows are an explicit list, seeded from the subjects on dashboards and extended when a dashboard is created; the page-head Follow button can unfollow any subject.
   Alerts cover followed subjects only, with per-item read, and opening an item marks it read. The bell counts every unread alert.
   Built: a subject's watermark is the run its latest review covered, else the previous run; a development is new when a run after the watermark added or updated it.
   Where a development shows under several subjects of one scope (a dashboard), the latest of their watermarks applies.
   `WhatChanged` now carries `reviewed_at` and, per development, `unreviewed`, `read`, `flagged` and `dismissed`; it still lists the latest run's changes after a review, for the fold.
   Its counts, the Since widget, the sidebar and watchlist counts all count unreviewed developments that are not read or dismissed, so Mark reviewed now clears them.
   `development_triage` holds read (as the run it was read in, so a later change unreads it), flagged and dismissed; `PATCH /developments/{id}/triage` sets them, and the old per-run `alert_reads` were folded into it.
   `POST /reviews` returns review ids and `DELETE /reviews/{id}` is the toast's Undo; Mark reviewed is disabled when nothing is new.
   `follows` was seeded once from the subjects on dashboards, and creating a dashboard follows its subjects; `GET`, `PUT` and `DELETE /follows/{subject_id}` back the page-head button and the Manage dialog in the alerts foot.
   Alerts leave out dismissed developments.
   The dashboard's What changed page (`/developments?...&changed=1`) now reads `GET /what-changed` and uses the monitor page's section, so it matches the Since widget after a review too.
   Row actions show on focus as well as hover; after an action takes a row out of its filter, focus moves to the same action on the next row.
   On a touch screen the actions always show as 44 px squares.
   The leftover test reviews of OCBC, DBS, UOB, Malaysia and Paxos now count, so those pages open on "Nothing new since your review".
4. **Correct the AI.** Picked A (`mocks/feedback.html`): inline per claim.
   "Mark wrong" under an answer in the drawer and in question-row meta opens an inline form (what is wrong, what it should be, reason).
   Each subject tag has a "Wrong" link with a reason and Remove tag.
   The row then shows "You marked this wrong today: ... Undo".
   Tag corrections are respected by the next run; answer corrections are recorded and shown, and the next run's answer prompt sees them.
   Built: corrections are rows in a `feedback` table; `POST /feedback/tags` and `POST /feedback/answers` add one and `DELETE /feedback/{id}` is Undo.
   The pipeline leaves a removed tag off its development in every later run (`removed_tags` in `pipeline/feedback.py`), which also keeps it out of that run's answer prompts, the graph and custom question matching.
   An answer correction goes into the answer prompt of the run that recomputes the corrected run and of the run after it, with the answer as it was, what was wrong and the reason; later runs no longer see it.
   Checked with Run now: a removed SEA countries tag stayed off its OCBC Malaysia development, and OCBC's Adverse answer came back as Watch citing only the outage, as the correction asked; after Undo, a rerun restored both from cached calls.
   `QuestionAnswerView.feedback` is the correction given since the latest run finished, which the row and drawer show with Undo; once a run has taken it in, Mark wrong shows again.
   `DevelopmentDetail.tag_feedback` lists removed tags, so the drawer keeps showing one the run dropped, with Undo.
   Mark wrong shows on every built-in answer, including ones with no sources (the mock showed it only on answers with evidence), and never on custom answers, which runs do not recompute.
   The State option uses a native select, and when an answer cites several developments, checking Cited developments lists them, all checked, to uncheck the sound ones.
5. **Notes and deletes.** No mock picked: no Trash and no note editing.
   Deleting a note or dashboard shows the Undo toast for longer (8 s, paused on hover or focus); that is the only restore.
   Soft-deleted rows are purged when the API starts if they were deleted more than a day ago.
   Built: the toast takes a duration, and a note or dashboard delete passes 8 s (`DELETE_UNDO_MS`); every toast's timer pauses while the pointer is over it or focus is in it, and resumes with the time left.
   `purge_deleted` in `store/db.py` runs first in the API's startup and removes dashboards and notes whose `deleted_at` is more than a day old.
   Two bugs found while mocking are fixed with it.
   The monitor rail stuck at 80 px, so a rail taller than the window hid its foot (the note field) until the page end; one that tall now scrolls until its foot is 24 px above the window's bottom and sticks there, using a `--rail-h` that `trackRailHeight` keeps current.
   ⌘K document snippets came from FTS5 over the raw text, so they often restated the title or began with markdown; the API now builds them from the body: markdown stripped, lines restating the title, level-1 headings and a first line that is not a sentence skipped, then the line with the most typed words, starting at its sentence or two words before the first match.
6. **Developments list.** Picked B (`mocks/developments.html`): filter bar and sortable table.
   It stays a drill-in for dashboards only: `/developments?dashboard=<id>`, reached from a dashboard widget's "Show all" and the Developments widget's "in scope" count. No sidebar entry, no monitor-page or ⌘K entry.
   Built: `GET /developments` returns a `DevelopmentList`: the developments matching `category`, `materiality` (levels), `jurisdiction` (codes), `days`, `source` (collections) and `q` (title words), each facet's values with counts, and counts for the view switch.
   A facet's counts apply every other filter, over the developments listed.
   Developments now carry `jurisdictions` (the names of those their sources score at least 0.5 in `document_tags.jurisdictions`) and `collections`, and every row carries its What changed and triage state.
   `changed=review` lists What changed since the review with the Since widget's counts (the counting is shared with `/what-changed`); `changed=run` lists the latest run's changes, for the fold after Mark reviewed.
   The page has the mock's filter bar: Filter by words, then Category, Materiality, Jurisdiction (with a find field), Date (last 7, 30 or 90 days of the run, or any time) and Source, each a popover of values with counts, and All or New since review on the right.
   The table sorts by Status (the display order), Subjects, Category, Materiality, Jurisdiction, Sources and Date; filters and the sort are URL parameters, so a reload and the evidence drawer keep them.
   New since review (`changed=1`, which Show all opens) keeps B3: the counts line, All, Unread, Flagged and Dismissed, row actions in place of the date, and the fold behind "Run of 24 Sep" once reviewed.
   Its answer changes list under the table while nothing is filtered, since facets do not apply to answers.
   The filter bar and the column heads stick under the top bar; the page has no rail.
   The "in scope" count on a dashboard-wide Developments widget links to the page, and the sidebar marks the dashboard while it is open.
   Built after verification: the filter bar wraps when it does not fit, and the column heads stick under its height (`--fbar-h`).
   A narrower table drops Sources (from about 1280 px), then Jurisdiction, then Category, so titles keep about 260 px down to the 1024 px minimum.
   New since review counts developments new or updated since the review and unread, as the counts line and the Since widget do; `DevelopmentList.unreviewed` is gone.
   Values a hand-edited URL gets wrong are ignored and the buttons do not name them; `jurisdiction` is now an enum of codes in the API.
   The Date popover focuses its checked option, and tabbing out of a popover closes it.
7. **Document reader and source labels.** Dropped: the evidence drawer is enough.
8. **Tablet layout.** Dropped: the app is desktop web only.

### C. Later

Immutable run snapshots with view-as-of and compare, follow-ups with ICS export, a handover page, alert rules and email digests, subject editing, export and weekly briefs, keyboard triage (j/k/o/r), answer history per question, saved searches.

## Sequence

1. Mocks for section B, in parallel with the fixes in section A.
   Work stops after this step until the user picks mock directions.
2. Build the picked designs.
3. Update `poc-plan.md` and `ui-ux.md`, and extend `web/e2e/walkthrough.spec.ts` to cover the new flows, keeping its artifact.

## Checks

Every change keeps these green: `pnpm lint`, `pnpm typecheck`, `pnpm e2e` in `web/`; `uv run ruff check .`, `uv run pyright` in `api/`.
API changes regenerate web types with `pnpm gen:api`.
