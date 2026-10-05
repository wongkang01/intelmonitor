# Evidence drawer

A side drawer over the current page that shows why the app says something.
`?evidence=<development id>` shows a development: its badge and facts, title, materiality confidence or the rule that set it, the subjects it is tagged to, each source with its quoted passage highlighted, and notes.
`?answer=<subject id>:<question id>` shows a standing question answer: its summary, question and state, the series and developments it is based on, and Mark wrong.
A measured series appears as a source with a chart over its span and the cited period highlighted.
Correct the AI lives here: mark an answer wrong, or remove a wrong subject tag, each with Undo.
Esc or `Close evidence` drops the parameter and returns focus to what opened it.

## Sub-features

- `ev-open`: every development link and `See evidence` link opens the drawer over the current page, keeping the page's parameters.
- `ev-quote`: each source shows date, kind, domain, `new this run`, and its passage with the quote in `<mark>`.
- `ev-series`: a data source shows the series link, `Data, <source>` meta, and an image with the cited period and a highlight band; hovering gives a readout.
- `ev-rule`: `Materiality set by rule: <detector>` replaces `Materiality: <high|medium|low> confidence` when a detector's rule set the level.
- `ev-answer`: answer view with `Based on N developments and M series`, nested developments linking to their own drawer.
- `ev-wrong`: `Mark wrong` form (State, Summary, Cited developments, Reason), Send, then `You marked this wrong today: ... Undo`.
- `ev-tag`: `<Subject> is wrong` opens a Reason and `Remove tag`; the row then says so with `Undo removing <Subject>`.
- `ev-close`: Esc and `Close evidence` close; focus returns to the opener.
- `ev-empty`: an unknown id shows `Could not load this evidence.`; an answer with nothing cited shows `No developments in the last N days bear on this question.`

## How to get to it (user POV)

- Developments list: a row's title link.
- Dashboard: a development row in `Since your last review` or `Developments`; answer links in `Monitor summary`, named like `Exposure: Watch → Needs attention. See evidence`.
- Monitor page: `See evidence` on a standing question row; a What changed row; an indicator row that opens its development.
- Top bar: an alert in the `Alerts` popover; a development or document result in ⌘K search.
- Inside an answer's drawer: a nested development's title link opens that development's drawer (Back returns to the answer).

## Driving it with verify

Preconditions:

- `ab` means `agent-browser --session im-verify` (or `$VERIFY_SESSION`); `@ref` is the ref `ab snapshot -i` prints for the named control.
- Ids that exist in the store of 30 Sep 2026: `1c5f03888832ab30-0` (OCBC outage, news source with a quote), `116e8efc051ac710-0` (Fed funds rise, series source first, 19 sources), `59640f754b691044-0` (ECB deposit rate, rule-set Notable), answer `ocbc:bank.financial` (2 developments, 2 series), `ocbc:bank.regulatory` (nothing cited), `ocbc:custom-121cf28fb9` (custom).
- Find others: `pnpm -C web verify api "/search?q=<words>"` (`documents[].development_id`), `pnpm -C web verify api /subjects/<id>/page` (`questions[]`).
- Mark wrong and Remove tag write feedback rows. Undo each at once and read it back.

- **Open from a list row.** On the developments list, `ab focus @ref` on a row's title link and `ab press Enter`. URL gains `evidence=<id>`, heading `Evidence` level 2 has focus (`document.activeElement.id` is `evidence-title`), heading level 3 is the development title.
- **Highlighted quote.** `pnpm -C web verify open evidence 1c5f03888832ab30-0`. `ab get text "[data-testid=evidence-drawer] .ev-conf"` reads `Materiality: high confidence`; `ab get text "[data-testid=evidence-drawer] .source .meta"` reads `23 Sep 2026 · News · theedgemalaysia.com · new this run`; `ab get text "[data-testid=evidence-drawer] .source blockquote mark"` equals the API's quote: `pnpm -C web verify api /developments/1c5f03888832ab30-0`, `sources[0].findings[0].passage.text[start:end]` of its first highlight.
- **Series as a source.** `pnpm -C web verify open evidence 116e8efc051ac710-0`. The first `article.source` has `data-series-id="fred.fed_funds"`; its link is `Fed funds effective rate`; meta reads `18 Sep 2026 · Data, FRED DFF · fred.stlouisfed.org · new this run`; no sentence paragraph (the title states it); `ab snapshot -c` shows `image "Fed funds effective rate, Sep 2025 to Sep 2026, latest 3.88%; cited: 17 Sep 2026"`; `ab get count "article.series-src .sc-band"` is 1. `ab scrollintoview "article.series-src"` then `ab hover "article.series-src svg"`: `ab get text "[role=tooltip]"` shows a value and date.
- **Rule text.** `pnpm -C web verify open evidence 59640f754b691044-0`. `.ev-conf` reads `Materiality set by rule: ECB deposit rate change`; the tag row reads `ECB 100%, tagged by detector`. The API's `materiality_rule` is `ECB deposit rate change`.
- **Answer from the monitor page.** `pnpm -C web verify open monitor ocbc`, `ab focus "[data-question-id='bank.financial'] a[href*='answer=']"`, `ab press Enter`. URL is `/monitors/ocbc?answer=ocbc%3Abank.financial`; heading level 4 `Based on 2 developments and 2 series`; regions `NPL ratio, all sectors` and `Loan-to-deposit ratio, all currencies` each hold an image with `cited: ...`; then one region per development with a level 5 title link.
- **Mark answer wrong, cancel.** `ab click @ref` for button `Mark wrong` in the drawer. Form `Mark answer wrong` opens with checkbox `State` focused and `Send` disabled. `ab press Escape`: the form closes, the drawer stays, focus is back on `Mark wrong`.
- **Mark answer wrong, send.** Reopen, `ab check @ref` on `State`, `ab select @ref stable` on combobox `What the state should be`, `ab fill @ref "<reason>"` on textbox `Reason`, click `Send`. Toast `Feedback saved. The next run takes it into account.`; `.fb-line` reads `You marked this wrong today: state should be Stable. Undo`; focus on `Undo`. Read back: `pnpm -C web verify api /subjects/ocbc/answers/bank.financial/evidence` has `answer.feedback.state` `stable`.
- **Undo the answer correction.** `ab press Enter` on the focused `Undo`. The line goes, focus returns to `Mark wrong`, and the same API call shows `answer.feedback: null`.
- **Remove a tag.** In the answer drawer, `ab click "[data-testid=evidence-drawer] .ev-title a"`. URL switches to `?evidence=<id>` (the `answer` parameter goes). `ab click @ref` for button `UOB is wrong`: textbox `Reason` is focused. `ab keyboard type "<reason>"`, `ab press Meta+Enter` (or click `Remove tag`). `ab get text "[data-testid=evidence-drawer] [data-tag=uob]"` reads `You marked this wrong today. Removed from the next run.` and focus is on `Undo removing UOB`. Read back: `pnpm -C web verify api /developments/<id>` has `tag_feedback` `[{subject: {id: "uob"}, applied: false}]`.
- **Undo the tag removal.** `ab press Enter`. Focus returns to `UOB is wrong`; the API shows `tag_feedback: []`. `ab back` returns to the answer drawer.
- **Close.** `ab click @ref` for button `Close evidence`, or `ab press Escape`. The parameter goes, other parameters stay, `ab get count "[data-testid=evidence-drawer]"` is 0, and focus returns to the opener if it is still on the page.
- **Empty and error.** `?answer=ocbc:bank.regulatory` shows `Sources` and `No developments in the last 30 days bear on this question.` `?evidence=does-not-exist` shows `Could not load this evidence.` `?answer=ocbc:custom-121cf28fb9` shows a `Custom` badge and no `Mark wrong`.
- **Proof.** `pnpm -C web verify shot drawer/<step>`; `snapshot -c` in the `.aria.txt` includes the chart's image name, but not the quote text, so keep an `ab get text ... mark` readout too.

## Gotchas

- `pnpm -C web verify open evidence <id> [dashboard]` opens the drawer over a dashboard (the first one unless named). That reaches the drawer, not its entry points: to test focus return or page parameters, open it by clicking a row or link.
- Focus returns to the opener only when a focused element opened the drawer. A scripted `element.click()` via `ab eval` leaves no opener; use `ab focus` plus Enter or `ab click @ref`.
- Esc does nothing while focus is in a textbox (the Note field, a Reason) or a modal dialog is open; inside the Mark wrong or Remove tag form, Esc cancels only the form.
- The passage and `<mark>` are not in `snapshot -i` or `-c` text; read them with `ab get text "[data-testid=evidence-drawer] .source blockquote mark"`.
- `Mark wrong` and `See evidence` repeat once per question on monitor pages; scope by `[data-question-id='<question id>']`.
- The detail API (`/developments/<id>`) has no `read` field; read triage state from the list API.
- A removed tag that the latest run already dropped (`applied: true`) disappears on Undo until the next run, with toast `The <Subject> tag comes back with the next run.`
- Custom answers never get `Mark wrong`; pick a built-in question.
- Other agents share the store; any feedback row left behind changes the monitor page's answer rows for everyone. Confirm `feedback: null` and `tag_feedback: []` before moving on.
