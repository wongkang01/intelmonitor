# Monitor page

A monitor page is one subject's view as of the latest run (Run 2, 24 Sep against 17 Sep).
The head shows the logo or icon, the name and a summary line (an entity's groups, a group's members, a topic's scope), with `Mark reviewed` and `Follow` at its right.
Under the head, underlined tabs: Overview, Developments, Data (subjects with listed series) and Connections (groups and entities, not topics).
The Overview has two columns: Summary, Focus areas and, for topics, Stage and Upcoming dates on the left; Key data, Needs attention, a small Connections graph and Notes on the right.
Under 900px the columns stack.
The Developments tab holds What changed since last review with its triage, then the subject's developments with a subject or peers scope.
The Data tab is in [data.md](data.md); the full graph view is in [graph.md](graph.md).

## Sub-features

- `head` `heading [level=1]` with the subject name, summary links, `Reviewed <when>` or `Not reviewed yet`, `button "Mark reviewed"`, `button "Follow"` / `button "Following"`.
- `tabs` `navigation "Monitor views"` with `link "Overview"`, `link "Developments"`, `link "Data"` (subjects with listed series), `link "Connections"` (groups and entities); the open tab has `aria-current="page"`.
- `mark-reviewed` `button "Mark reviewed"` in the head, disabled when nothing is unreviewed; the toast `<Subject> marked reviewed. <n> new cleared.` carries `Undo`; the head then reads `Reviewed today at HH:MM`.
- `follow` the head toggle; decides whether the subject raises alerts. No toast, no Undo.
- `summary` `region "Summary"`, only when the run has one for the subject: the run's paragraph, `<n> developments in scope`, `<n> need attention`, `<n> adverse`, then `More adverse`, `Less adverse` or `Unchanged` with what it was measured on. Meta `Run of 24 Sep against 17 Sep`.
- `questions` `region "Focus areas"`: state badge, label, question, answer, `Last <n> days`, `See evidence` or `No sources`, `Mark wrong`; custom ones add `button "Edit <label>"`; `button "Add a focus area"` opens the composer (see custom-questions.md), whose `Cancel` returns focus to `Add a focus area`.
- `stage-track` topics only: `region "Stage"`, `group "Regulatory stage"` with `button "<Stage>, <n> developments"` (disabled at 0), opens on the furthest stage with any; the H3 reads `<Stage>: <n> developments, top 3`.
- `upcoming` topics only: `region "Upcoming dates"`, rows link to their development.
- `key-data` `region "Key data"`: indicators a detector flagged first, each with its event statement; then up to 3 of the subject's own series and up to 3 context series, each with latest value, weekly or last-release change and a 12-month line; `link "Open Data"`.
- `needs-attention` `region "Needs attention"`: up to 3 developments needing attention, or `Nothing needs attention.`; `link "All <n> developments"` opens the Developments tab.
- `connections-card` `region "Connections"`: a small graph of the subject, its groups, peers or members and topics; each node is a link to that monitor; `link "Open"` opens the Connections tab (`Open graph` to the graph view on topics).
- `notes` `region "Notes"`: `textbox "Note"`, `button "Add note"` (disabled while empty; Cmd+Enter also submits), one `button "Delete note"` per note; delete toasts `Deleted note` with `Undo` for 8 s.
- `what-changed` Developments tab, `region "What changed since last review"`: lead counts (`3 new, 1 needs attention`), filter buttons `All n`, `Unread n`, `Flagged n`, `Dismissed n`, the first 6 rows then `Show all <n>`, then `<n> answers changed` with `See evidence` per answer.
- `folded` after a review with nothing new since, the lead reads `Nothing new since your review` and the rows sit behind `button "Run of 24 Sep · <n> developments, <m> answers changed"` (`expanded=false`).
- `subject-developments` Developments tab, `region "Developments"`: lead `<n> developments, <k> need attention`; for entities in a group with other members, buttons `<Subject> <n>` and `Peers <n>` switch the scope (`?scope=peers`); peer rows name their bank; after 30 rows, `Show all <n>`.
- `connections-tab` `/monitors/<id>/connections`: the graph view without its page head (filters, canvas, In view), then `region "Peers"` (entities: a table of focus area states, the subject's column first, `Not asked` where a bank has none, each state with sources links to that answer's evidence) or `region "Common issues"` and `region "Outliers"` (groups), and `region "Related"` with linked topics, groups and members and `link "Open full graph"`.

## How to get to it (user POV)

- Sidebar `Monitors` trees (Topics, Groups, Entities): `link "<Subject>"` or `link "<Subject> <n> new"`.
- ⌘K search, type the name, Enter (e2e step 6).
- Any subject link: a development row's subject chips, a monitor's summary line, Related or Connections card nodes, a dashboard widget.
- A node or `In view` row on a graph view.
- The tabs in `navigation "Monitor views"`; Key data's `Open Data`, Needs attention's `All <n> developments`, the Connections card's `Open`.
- Direct URLs `/monitors/<id>`, `/monitors/<id>/developments[?scope=peers]`, `/monitors/<id>/data`, `/monitors/<id>/connections`. A topic's `/connections` URL replaces itself with the Overview.
- Hash links such as `/monitors/tether/data#indicators` scroll to that section once it renders.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `S` below means `agent-browser --session $VERIFY_SESSION` (default `im-verify`).
- Pick the subject from the API first: `verify api /subjects/<id>/page` gives `what_changed.reviewed_at`, `what_changed.new_count` and `summary`, and `verify api /follows` lists followed subjects.
  On 5 Oct, Maybank was unreviewed (1 new) and not followed (good for review and follow); UOB was reviewed on 24 Sep, so `Mark reviewed` is disabled there.
- Every subject has listed series on 5 Oct, so every page shows the Data tab.
- Harness targets: `verify open monitor <subject>`, `monitor-developments <subject> [peers]`, `data <subject>`, `connections <subject>`.

- **Open the page.** `pnpm -C web verify open monitor uob`, `S snapshot -i`. `heading "UOB" [level=1]`, `link "Singapore banks"`, `button "Mark reviewed" [disabled]`, `button "Following"`, the four tab links, then `region "Summary"`, `region "Focus areas"`, `region "Key data"`, `region "Needs attention"` (`link "All 26 developments"`), `region "Connections"`, `region "Notes"`.
- **Summary.** UOB's reads `26 developments in scope`, `2 need attention`, `13 adverse` and `Less adverse: 2 focus areas on Watch or Needs attention ...`; `verify api /subjects/uob/page` has the same `summary`. A run without a summary shows no Summary region.
- **Tabs.** Click each tab link: the URL becomes `/monitors/uob/developments`, `/data`, `/connections` and back to `/monitors/uob`, and that link carries `aria-current="page"`. On `banking-regulation` the navigation has no `Connections`.
- **Mark reviewed, then Undo.** On Maybank, click Undo inside the 5 s toast, so chain both clicks: `S click @<Mark reviewed> && S click @<Undo>` with the Undo ref from a snapshot taken in the same command. To see the reviewed state, click only `Mark reviewed`: the toast reads `Maybank marked reviewed. 1 new cleared.`, the head shows `Reviewed today at HH:MM` with `Mark reviewed [disabled]`, the Developments tab's `.mon-lead` reads `Nothing new since your review`, the sidebar row loses its count, and `verify api /subjects/maybank/page` has `what_changed.reviewed_at` set. After Undo, `Not reviewed yet`, the count and `reviewed_at: null` come back.
- **Follow, then unfollow.** On Maybank, click `button "Follow"`. It becomes `Following` and `verify api /follows` includes `"maybank"`. Click `Following` to put it back; `/follows` no longer lists it.
- **Add a focus area, then cancel.** Click `button "Add a focus area"`: `textbox "New focus area for UOB"`, `button "Cancel"`, `button "Draft focus area" [disabled]` appear in Focus areas. Click Cancel: the composer closes and `document.activeElement` is `Add a focus area`. Drafting calls Claude (see custom-questions.md).
- **Evidence from a focus area.** Click a row's `See evidence`: the URL gains `?answer=uob%3Abank.adverse` and the drawer opens on that answer. `S press Escape` closes it and removes the parameter.
- **Add a note.** In `region "Notes"`, `S fill @<textbox "Note"> "verify probe"`, `S click @<Add note>`. The note shows with `button "Delete note"`; the textbox clears. `verify api "/notes?subject_id=<id>"` returns it.
- **Delete a note, then Undo.** Click `Delete note`. A `Deleted note` toast with `Undo` shows and `/notes?subject_id=...` returns `[]`. Click `Undo` within 8 s: the note returns.
- **Developments scope.** `verify open monitor-developments uob`. The lead reads `26 developments, 2 need attention` and the switch reads `UOB 26` and `Peers 19`. Click `Peers 19`: the URL gains `?scope=peers`, the lead reads `19 developments, 3 need attention`, and each row's meta starts with `DBS` or `OCBC`. `verify api "/developments?peers_of=uob"` lists the same 19. Opening a peer row's evidence and pressing Escape keeps `?scope=peers`. Groups and topics show no switch.
- **Expand a folded run.** On a reviewed subject (UOB), click `button "Run of 24 Sep · 16 developments, 2 answers changed"` on the Developments tab. It turns `expanded=true` and shows the filters, rows and answers changed. Read only.
- **Connections tab.** `verify open connections uob`, `S wait '[data-testid=graph-canvas][data-layout=settled]'`. The graph view's filters and In view list show without its page head, at 1 hop with every node type (`button "Nodes: All"`), developments under their themes; `region "Peers"` has columns `Focus area`, `UOB`, `DBS`, `OCBC`; `region "Related"` lists `Topics` and `Groups`. A state with sources (DBS `Geographic exposure`) opens `?answer=dbs:bank.geographic-exposure`. `link "Open full graph"` goes to `/monitors/uob/graph`. On `singapore-banks`, Common issues and Outliers replace Peers.
- **Stage track.** `verify open monitor banking-regulation`. `region "Stage"` opens on the furthest stage with any developments (pressed); clicking another stage button makes it pressed and changes the H3. `region "Upcoming dates"` follows.
- **Proof.** `pnpm -C web verify shot <run>/<step>` before and after each mutation, plus the `verify api` readback.

## Gotchas

- Snapshot refs change after every mutation re-renders a section. Snapshot again before the next click.
- The Mark reviewed toast lasts 5 s. A snapshot and a grep between the click and Undo can outlast it. If it lapses, the store keeps the review; restore it with `DELETE /reviews/<id>` (what Undo calls), taking the id from the `POST /reviews` response.
- `Mark reviewed` is disabled on any subject with nothing unreviewed, which includes subjects someone already reviewed this run. Check `what_changed.reviewed_at` before choosing a subject.
- The What changed lead counts unread new and updated rows only, yet `Mark reviewed` stays enabled while any row is unreviewed.
- `agent-browser snapshot` does not print `aria-pressed` or `aria-current`. Read them with `S get attr @<ref> aria-pressed`, or rely on the Follow button's label swapping.
- `find role <role> <action> --name` fails for links, textboxes and checkboxes in this agent-browser version. Use snapshot refs.
- Follow has no Undo and no toast. Reverse it with a second click and confirm with `/follows`.
- The Needs attention link counts every development in scope, not only those needing attention.
- The page scrolls inside `main.main`, not the window: `S eval '(() => document.querySelector("main.main").scrollTo(0, 800))()'`.
- The app shell keeps a 1024px minimum width, so at 400px the whole app scrolls sideways; the monitor columns stack inside it.
- On the Connections tab a plain wheel over the graph scrolls the page; Ctrl+wheel or pinch zooms.
- The e2e picks the entity with the most new developments at run time, not a fixed subject.
