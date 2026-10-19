# Ask

The Ask page (`/ask`) is a preview: nothing is sent to the API or a model, and answers are mocked.
Empty, it shows a heading (`Ask about any entity, group or topic`, or `Ask about <name>` when opened about a subject), a small plain `Preview` label, the query bar in the middle of the page and four suggested questions under it.
Typing `@` at the start or after a space opens a list of entities, groups and topics filtered by what follows the `@`; picking one inserts `@<Name> ` into the question, drawn in accent colour.
Submitting moves the bar to the bottom and shows the question, its mentions as links to their monitor pages, then the answer.
A question naming DBS and UOB with loans or regions gets the sample answer: a title, a paragraph, a grouped bar chart of share of loans by region (DBS 56, 25, 9; UOB 50, 14, 21) and a caveat line.
Any other question gets `Answers are not built yet. Ask how DBS and UOB loans compare by region to see a sample.`
Opened about a subject (`/ask?about=<id>`), the bar starts with that subject's mention and the suggestions are written for it.

## Sub-features

- `bar` `combobox "Question"` (`#ask-q`) with `aria-expanded`, `aria-activedescendant`, and `button "Ask"`, disabled while the bar is blank.
- `mentions` `listbox "Mention"` (`#ask-mentions`) grouped `Entities`, `Groups`, `Topics`, each option with its icon and a group's member count; Up and Down move, Enter or Tab inserts, Escape closes, a click inserts; focus stays in the bar.
- `suggestions` `list "Suggested questions"`, four buttons; a click fills the bar.
- `about` `/ask?about=<id>` prefills `@<Name> ` and writes the suggestions for that subject; DBS and UOB lead with the loans question.
- `thread` `list "Questions and answers"`: each question right-aligned with linked mentions, then `region "Answer"` or the sample answer's region named by its title.
- `sample` `region "DBS and UOB loans by region, 30 Jun 2026"` with `img "Share of loans by region. ..."` and the caveat.
- `preview` the plain `Preview` label, beside the heading when empty and under the bar once a question is asked.

## How to get to it (user POV)

- `link "Ask"` at the top of the sidebar ([sidebar](sidebar.md)).
- `link "Ask about <name>"` in a monitor page's head ([monitor-page](monitor-page.md)) opens `/ask?about=<id>`.

## Driving it with verify

Preconditions:

- `pnpm -C web verify doctor` is ok.
- `verify open` has no Ask target: run `pnpm -C web verify open home`, then `S open https://intelmonitor.web.localhost/ask` (or click `link "Ask"`).
- Read only: nothing here writes to the store.

- **Open from the sidebar.** `S snapshot -i -s nav`, click `link "Ask"`. The URL is `/ask`, `heading "Ask about any entity, group or topic"` shows with `Preview`, and `list "Suggested questions"` has four buttons, the first `How do @DBS and @UOB loans compare by region?`.
- **Open about a subject.** On `/monitors/dbs` click `link "Ask about DBS"`. The URL is `/ask?about=dbs`, the heading reads `Ask about DBS`, and `S eval 'document.querySelector("#ask-q").value'` is `"@DBS "`.
- **Mention list.** Click the bar, `S type "#ask-q" "@uo"`. The combobox reads `expanded=true` and `listbox "Mention"` lists `UOB` under `Entities`. `S press ArrowDown` moves `aria-activedescendant`; `S press Enter` inserts `@UOB ` and the list closes. `S press Escape` with the list open closes it until a new `@` is typed.
- **Still typing a name.** Type `@Singapore` at the end of the bar: the list stays open and offers `Singapore banks` under `Groups` as well as `Singapore`.
- **Finished mentions stay closed.** On `/ask?about=dbs`, `S press Home`, then `S press ArrowRight` twice (caret inside `@DBS`): the combobox stays `expanded=false`, and Enter submits the question instead of inserting a mention.
- **Sample answer.** Click the first suggestion, then `button "Ask"`. The bar moves to the bottom, the thread shows the question with `link "@DBS"` (`/monitors/dbs`) and `link "@UOB"`, and `region "DBS and UOB loans by region, 30 Jun 2026"` holds the chart and the caveat starting `Stored exposures at 30 Jun 2026.`
- **Other questions.** Ask `What changed for @OCBC this week?`. The new answer reads `Answers are not built yet. ...` and the page scrolls to it.
- **Proof.** `pnpm -C web verify shot ask/<step>` for the empty page, the open list and the answered thread.

## Gotchas

- Mentions match subject names exactly, case included: a typed `@dbs` stays plain text until DBS is picked from the list.
- The question is one line (an input, not a textarea); long questions scroll sideways inside the bar.
- The thread lives only in page state; a reload or leaving the page clears it.
- The shell keeps a 1024px minimum width, so phone widths cannot be checked through the app; the page itself collapses to one column below about 640px of main width.
