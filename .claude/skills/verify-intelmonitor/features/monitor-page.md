# Monitor page

A monitor page is one subject's view as of the latest run (Run 2, 24 Sep against 17 Sep).
The head shows the logo or icon, the name, a summary line (an entity's groups, a group's members, a topic's scope), `Overview` / `Trend` tabs when the subject has measured series, and `Follow`.
The main panel runs What changed since last review, Indicators (where series are mapped), Standing questions, then Common issues and Outliers for groups, or Stage and Upcoming dates for topics.
The rail holds Links (linked subjects and `Open graph view`) and Actions (`Mark reviewed` with Undo, and notes with delete and Undo).

## Sub-features

- `head` `heading [level=1]` with the subject name, summary links, `navigation "View"` with `link "Overview"` / `link "Trend"` (series subjects only), `button "Follow"` / `button "Following"`.
- `what-changed` `region "What changed since last review"`: lead counts (`3 new, 1 needs attention`), `group "Filter developments"` (`All n`, `Unread n`, `Flagged n`, `Dismissed n`), the first 6 rows then `Show all <n>`, then `<n> answers changed` with `See evidence` per answer.
- `folded` after a review with nothing new since, the lead reads `Nothing new since your review` and the rows sit behind `button "Run of 24 Sep · <n> developments, <m> answers changed"` (`expanded=false`).
- `mark-reviewed` `region "Actions"` `button "Mark reviewed"`, disabled when nothing is unreviewed; the toast `<Subject> marked reviewed. <n> new cleared.` carries `Undo`; the meta reads `Reviewed today at HH:MM` or `Not reviewed yet`.
- `follow` the head toggle; decides whether the subject raises alerts. No toast, no Undo.
- `notes` `textbox "Note"`, `button "Add note"` (disabled while empty; Cmd+Enter also submits), one `button "Delete note"` per note; delete toasts `Deleted note` with `Undo` for 8 s.
- `indicators` `region "Indicators"`: one row per listed series with status, latest value and period, change and window, and a 12-month line (`image "<series>, 12 months to 24 Sep: <lo> to <hi>, latest <v>"`) whose hover shows a `tooltip`. A row whose status comes from a detector event is a link that opens its development in the evidence drawer.
- `questions` `region "Standing questions"`: state badge, label, question, answer, `Last <n> days`, `See evidence` or `No sources`, `Mark wrong`; custom ones add `button "Edit <label>"`; `button "Add a question"` (see custom-questions.md).
- `stage-track` topics only: `region "Stage"`, `group "Regulatory stage"` with `button "<Stage>, <n> developments"` (disabled at 0), opens on the furthest stage with any; the H3 reads `<Stage>: <n> developments, top 3`.
- `upcoming` topics only: `region "Upcoming dates"`, rows link to their development.
- `group-insights` groups only: `region "Common issues"` and `region "Outliers"`.
- `rail` `region "Links"` (subject links by type, `link "Open graph view"`) and `region "Actions"`.

## How to get to it (user POV)

- Sidebar `Monitors` trees (Topics, Groups, Entities): `link "<Subject>"` or `link "<Subject> <n> new"`.
- ⌘K search, type the name, Enter (e2e step 6).
- Any subject link: a development row's subject chips, a monitor's summary line or Links, a dashboard widget.
- A node or `In view` row on a graph view.
- The Trend tab's `link "Overview"`.
- Hash links such as `/monitors/tether#indicators` scroll to that section once it renders.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).
- Pick the subject from the API first: `verify api /subjects/<id>/page` gives `what_changed.reviewed_at` and whether any development is `unreviewed`, and `verify api /follows` lists followed subjects.
  On 30 Sep, Maybank was unreviewed and not followed (good for review and follow); OCBC, DBS, UOB, Paxos and Malaysia were already reviewed, so `Mark reviewed` is disabled there.

- **Open the page.** `pnpm -C web verify open monitor maybank`, `S snapshot -i`. `heading "Maybank" [level=1]`, `link "SEA regional banks"`, `button "Follow"`, the What changed filters (`All 21`, `Unread 3`), `button "Mark reviewed"` enabled; `S get text '.mon-lead'` reads `3 new, 1 needs attention`.
- **Mark reviewed, then Undo.** Click Undo inside the 5 s toast, so chain both clicks: `S find role button click --name "Mark reviewed" && S find role button click --name "Undo" --exact`. To see the reviewed state first, click only `Mark reviewed`: the `status` toast reads `Maybank marked reviewed. 3 new cleared.`, `.mon-lead` reads `Nothing new since your review`, the rows fold behind `button "Run of 24 Sep · 21 developments, 3 answers changed"`, Actions shows `Reviewed today at HH:MM` with `Mark reviewed [disabled]`, the sidebar row loses its count (`S get count 'nav a.navitem[href="/monitors/maybank"] .count'` is 0), and `verify api /subjects/maybank/page` has `what_changed.reviewed_at` set. After Undo, the lead, the sidebar count (`3`) and `reviewed_at: null` come back.
- **Expand a folded run.** On a reviewed subject (`verify open monitor OCBC`), click `button "Run of 24 Sep · 12 developments, 2 answers changed"`. It turns `expanded=true` and shows the filters (`All 12`, `Unread 9`, `Flagged 1`, `Dismissed 0`), rows, `Show all 12` and `2 answers changed`. Read only.
- **Follow, then unfollow.** On Maybank, `S find role button click --name "Follow" --exact`. The button becomes `Following` (`S get attr @<ref> aria-pressed` is `true`) and `verify api /follows` includes `"maybank"`. `S find role button click --name "Following" --exact` puts it back; `/follows` no longer lists it.
- **Add a note.** `S fill @<textbox "Note"> "verify probe"`, `S click @<Add note>`, `S wait --text "verify probe"`. The note shows with a timestamp and `button "Delete note"`; the textbox clears. `verify api "/notes?subject_id=ocbc"` returns it with `run_id: "2026-09-24"`. `S find label Note fill "..."` then `S press Meta+Enter` also submits.
- **Delete a note, then Undo.** `S find role button click --name "Delete note"`. The note leaves, a `status` toast reads `Deleted note` with `button "Undo"`, and `/notes?subject_id=...` returns `[]`. Click `Undo` within 8 s: the note returns and `/notes` lists it again.
- **Clean up a note.** Delete it again and let the toast lapse (`S wait 9000`). `/notes?subject_id=...` stays `[]`.
- **Indicators.** `verify open monitor fed`, `S snapshot -s 'section[aria-labelledby="indicators"]' -c`. `link "Watch Fed funds effective rate 23 Sep · FRED DFF 3.88% +0.25 pt 1 month ..."`. Click it: the URL gains `?evidence=116e8efc051ac710-0` and the drawer's H3 reads `Fed funds effective rate up 0.25 points to 3.88% ...`. Close it (`S find role button click --name "Close evidence"`), then `S hover '.ind-line'`; a `tooltip` shows a value, a date and the series name. OCBC shows system-wide rows under `heading "Loan-to-deposit ratio"` and `heading "Non-performing loans"` [level=3].
- **Stage track.** `verify open monitor banking-regulation`. `region "Stage"` opens on `Enforced, 30 developments` (pressed) with `Enforced: 30 developments, top 3`. Click `button "Consultation, 15 developments"`: it becomes pressed and the H3 reads `Consultation: 15 developments, top 3`. `region "Upcoming dates"` sits below.
- **Group sections.** `verify open monitor singapore-banks` shows `region "Common issues"` and `region "Outliers"` between Standing questions and the rail.
- **Rail links.** `link "Open graph view"` in `region "Links"` goes to `/monitors/<id>/graph` (see graph.md).
- **Proof.** `pnpm -C web verify shot <run>/<step>` before and after each mutation, plus the `verify api` readback.

## Gotchas

- Snapshot refs change after every mutation re-renders the rail (`textbox "Note"` moved from e113 to e114 after one add). Snapshot again before the next click, or use `find role button click --name ...`.
- The Mark reviewed toast lasts 5 s. A snapshot and a grep between the click and Undo can outlast it. If it lapses, the store keeps the review; restore the prior state with `DELETE /reviews/<id>` (what Undo calls), taking the id from the `POST /reviews` response.
- `Mark reviewed` is disabled on any subject with nothing unreviewed, which includes subjects someone already reviewed this run. Check `what_changed.reviewed_at` before choosing a subject.
- The What changed lead counts unread new and updated rows only. Circle lists 5 developments with `Unread 0` and reads `3 need attention`, yet `Mark reviewed` stays enabled because the rows are unreviewed.
- `agent-browser snapshot` does not print `aria-pressed`. Read it with `S get attr @<ref> aria-pressed`, or rely on the Follow button's label swapping.
- In this agent-browser version, `find role <role> <action> --name` worked for buttons but failed for `link "Trend"`, `textbox "Note"` and checkboxes. Use `find label Note fill ...` or snapshot refs.
- Follow has no Undo and no toast. Reverse it with a second click and confirm with `/follows`.
- The Links section lists every linked subject, including ones the graph reaches only at 2 hops (OCBC's topics come through Singapore banks).
- Indicator rows are not interactive unless a detector event backs them, so most rows appear only in the full snapshot, not in `snapshot -i`.
- The e2e picks the entity with the most new developments at run time, not a fixed subject.
