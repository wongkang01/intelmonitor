# Evidence drawer

Parked for the testing sessions: answers came from focus areas, and with the dashboard's widgets gone no screen links to `?answer=` any more. The drawer still opens from a typed URL; the recipes below are kept until the sessions decide (D3).

A side drawer over the current page that shows why a standing question's answer says what it does.
`?answer=<subject id>:<question id>` shows the answer's summary, question and state, the series and developments it is based on, and Mark wrong.
A measured series appears as a source with a chart over its span and the cited period highlighted.
Each development it relies on shows its priority badge, category and date (an unconfirmed development the answer cited is left out, as everywhere outside the Developments tab's `Show unconfirmed`), its title as a link that opens the development's popup over the drawer (see [development-page](development-page.md)), and its sources with the quoted passage highlighted.
Esc or `Close evidence` drops the parameter and returns focus to what opened it.
Developments no longer open in the drawer: an old `?evidence=<id>` link opens the development popup on the same page.

## Sub-features

- `ev-open`: every `See evidence` link opens the drawer over the current page, keeping the page's parameters.
- `ev-answer`: `Based on N developments and M series`, the series charts, then one block per development.
- `ev-series`: a data source shows the series link, `Data, <source>` meta, and an image with the cited period and a highlight band; hovering gives a readout.
- `ev-wrong`: `Mark wrong` form (State, Summary, Cited developments, Reason), Send, then `You marked this wrong today: ... Undo`.
- `ev-dev-link`: a development's title opens its popup; closing it leaves the drawer open.
- `ev-close`: Esc and `Close evidence` close; focus returns to the opener.
- `ev-empty`: an unknown answer shows `Could not load this evidence.`; an answer with nothing cited shows `No developments in the last N days bear on this focus area.`

## How to get to it (user POV)

- Dashboard: answer links in `Monitor summary`, named like `Exposure: Watch → Needs attention. See evidence`.
- Monitor page: none since U2 removed focus areas and the Connections tab; answer URLs (`?answer=`) still open the drawer.

## Driving it with verify

Preconditions:

- `ab` means `agent-browser --session im-verify` (or `$VERIFY_SESSION`); `@ref` is the ref `ab snapshot -i` prints for the named control.
- Answers that exist in the store of 30 Sep 2026: `ocbc:bank.financial` (2 developments, 2 series), `ocbc:bank.regulatory` (nothing cited), `ocbc:custom-121cf28fb9` (custom). Find others with `pnpm -C web verify api /subjects/<id>/page` (`questions[]`).
- Mark wrong writes a feedback row. Undo it at once and read it back.

- **Answer from the monitor page.** `pnpm -C web verify open monitor ocbc`, `ab focus "[data-question-id='bank.financial'] a[href*='answer=']"`, `ab press Enter`. URL is `/monitors/ocbc?answer=ocbc%3Abank.financial`; heading level 4 `Based on 2 developments and 2 series`; regions for each series hold an image with `cited: ...`; then one region per development with a level 5 title link.
- **Development link.** `ab click "[data-testid=evidence-drawer] .ev-title a"`: the URL gains `development=<id>&scope=subject%3Aocbc` and the popup opens over the drawer; Esc closes only the popup.
- **Mark answer wrong, cancel.** `ab click @ref` for button `Mark wrong` in the drawer. Form `Mark answer wrong` opens with checkbox `State` focused and `Send` disabled. `ab press Escape`: the form closes, the drawer stays, focus is back on `Mark wrong`.
- **Mark answer wrong, send.** Reopen, `ab check @ref` on `State`, `ab select @ref stable` on combobox `What the state should be`, `ab fill @ref "<reason>"` on textbox `Reason`, click `Send`. Toast `Feedback saved. The next run takes it into account.`; `.fb-line` reads `You marked this wrong today: state should be Stable. Undo`. Read back: `pnpm -C web verify api /subjects/ocbc/answers/bank.financial/evidence` has `answer.feedback.state` `stable`.
- **Undo the answer correction.** `ab press Enter` on the focused `Undo`. The line goes, and the same API call shows `answer.feedback: null`.
- **Close.** `ab click @ref` for button `Close evidence`, or `ab press Escape`. The parameter goes, other parameters stay, and focus returns to the opener if it is still on the page.
- **Empty and error.** `pnpm -C web verify open answer ocbc:bank.regulatory` shows `Sources` and `No developments in the last 30 days bear on this focus area.` `?answer=ocbc:custom-121cf28fb9` shows a `Custom` badge and no `Mark wrong`.
- **Proof.** `pnpm -C web verify shot drawer/<step>`; read the quote with `ab get text "[data-testid=evidence-drawer] .source blockquote mark"`.

## Gotchas

- Focus returns to the opener only when a focused element opened the drawer. A scripted `element.click()` via `ab eval` leaves no opener; use `ab focus` plus Enter or `ab click @ref`.
- Esc does nothing while focus is in a textbox or a modal dialog is open; inside the Mark wrong form, Esc cancels only the form.
- `Mark wrong` and `See evidence` repeat once per question on monitor pages; scope by `[data-question-id='<question id>']`.
- Custom answers never get `Mark wrong`; pick a built-in question.
- Standing answers stop running in Phase 1 (item P); the drawer stays until the sessions confirm nobody misses it.
