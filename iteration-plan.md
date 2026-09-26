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
8. **Soft delete.**
   Deleting a note or a dashboard sets `deleted_at` instead of removing the row.
   The existing toast offers Undo.
   A restore endpoint exists for each; the Trash view waits for mocks.
   Built: `dashboards` and `analyst_actions` gained a `deleted_at` column; the store adds missing columns in place when it opens, keeping every row.
   Every read skips deleted rows, and editing or reordering treats a deleted dashboard as gone.
   `POST /dashboards/{id}/restore` and `POST /notes/{id}/restore` undo a delete; restoring something not deleted changes nothing.
   A restored dashboard returns to its sidebar position, and Undo reopens it if it was open when deleted.
   Deleting a custom question also drops its widgets from deleted dashboards, so a restored one never shows a question that is gone.
   Deleted rows are kept with no purge, so the walkthrough's cleanup leaves soft-deleted "E2E" dashboards and notes behind; the Trash work should decide how they are purged.

### B. Mocked first, built after the pick

1. **Trend section on monitor pages.**
   Weekly bars by category, stage movement on topics, member contribution on groups, and a state strip per standing question.
   Clicking a week filters What changed to that week.
   The Direction widget links to `/monitors/{id}#trend`.
2. **Onboarding and help.**
   A first-run tour of 4 or 5 anchored steps: sidebar (dashboards and monitors), the Since widget, the evidence drawer, Mark reviewed, Generate.
   A Help item in the profile menu with a glossary of states (New, Updated, Watch, Needs attention, Stable) and materiality levels, plus the shortcuts.
   "Tour seen" lives in the profile.
3. **Review and triage.**
   Mark reviewed sets a watermark per subject; "new" counts developments changed in runs after the watermark and not individually read.
   Per-development states: read, flagged, dismissed, shown as filters in What changed.
   Alerts cover followed subjects only (subjects on any dashboard, plus a Follow toggle on monitor pages), with per-item read and open-marks-read.
4. **Correct the AI.**
   Mark an answer or a subject tag as wrong, with a reason, from the evidence drawer and question rows.
   The next run respects tag overrides.
5. **Notes.**
   Notes can be edited and show "edited".
   A Trash view restores deleted notes and dashboards.
6. **Developments list.**
   A route listing developments with facets: category, materiality, jurisdiction, date, source.
   It also serves as the dashboard-scoped view from A3.
7. **Document reader and source labels.**
   A reader panel for `GET /documents/{id}` with every quote highlighted in context.
   The drawer shows a source tier and a classification badge.
   "No sources" answers explain what was checked ("checked 14 documents, 30 days").
8. **Tablet layout.**
   Below 1200 px the sidebar collapses and the grid drops to 2 columns.

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
