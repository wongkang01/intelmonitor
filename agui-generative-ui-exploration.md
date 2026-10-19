# Generative UI with AG-UI: exploration

14 October 2026.
Ideation only; nothing is built or decided.
Mock: https://claude.ai/artifact/BxkdgFyp3LJvUr8d3g6rH1

## The question

The Generate agent builds a dashboard from a prompt, but only by picking from 8 fixed widget types whose content the server fills (`agent/tools.py`, `server/widgets.py`).
Could AG-UI also generate the content, for example "compare UOB and DBS on loans" producing charts and a written answer?
Or is that a job for ChatGPT or claude.ai, where each question gets its own generated page?

## Answer in short

AG-UI can carry it; the limit is what the agent may do, not the protocol.
AG-UI only moves events between server and page: text, tool calls and state patches.

The design is structured output over read tools, with no sandbox:

```
question
  → agent reads with tools (exposures, series, developments, impacts)
  → agent returns a spec: components + data references + answer text with citations
  → server validates the spec, resolves references to stored numbers, checks the text
  → AG-UI streams the components to the page; the page renders them
```

The model chooses the chart and the data but never writes a chart value.
Charts can only show stored figures.

Example spec for the DBS and UOB question:

```json
{
  "components": [
    {"type": "bar", "title": "Share of loans by region",
     "data": {"source": "exposures", "subjects": ["dbs", "uob"],
              "measure": "gross_customer_loans", "dimension": "geography",
              "group": {"Greater China": ["hong-kong", "rest-of-greater-china", "greater-china"]}}},
    {"type": "bar", "title": "NPL ratio by region",
     "data": {"source": "exposures", "subjects": ["dbs", "uob"], "measure": "npl_ratio"}},
    {"type": "text", "body": "DBS leans to Greater China (25% against 14%) ... [r:dbs:exposed_to:hong-kong]"}
  ]
}
```

## Why not a chat app generating a page per question

Chat apps give the most freedom for one-off exploration.
They lose what IntelMonitor is for:

- The model writes the numbers, so nothing checks them against the store.
- The page is a snapshot; a component on IntelMonitor is redrawn on every run.
- Every page looks different instead of using the app's components.
- Analysts have to know what to ask.

For personal exploration, a read-only MCP server over the store, used from claude.ai, is the cheap route, outside the product.

## On monitor pages

Proposal: an "Ask about DBS" block on the Overview with 3 suggested questions and a text box.
An answer shows charts from stored data and a short written answer with citations, and can be pinned.

Suggested questions come from templates in code, offered only when the data to answer them exists:

- "How do DBS and UOB loans compare by geography?" when both have exposure figures.
- "How have DBS shares moved against the STI?" when the share-trails-STI detector fired.
- "What reached DBS through its India bank this week?" when there are indirect impacts on that route.
- "What is coming up for DBS in the next 90 days?" when there are upcoming dates.

Claude ranks and words the top 3 inside the existing brief call, so they follow the week's news at no extra calls.

| | Answer suggested questions during the run | Answer on click |
|---|---|---|
| Speed | Instant | About 10 to 20 s |
| Cost | About 3 × 53 calls per run, cached when nothing changed | Only what users click |
| Checks | As for briefs: numbers must appear in the inputs, cited ids must exist, one retry | Same, but a failure shows live |
| Railway demo | Works, answers are stored | Does not work, LLM features are off |

Preferred: answer suggested and pinned questions during the run; free text only where a model is configured.

Limits:

- Charts are limited to stored data: for banks, exposures at one date (30 June 2026), share prices and system-wide MAS series.
- UOB's US and Greater China figures were read off charts and must carry that mark.
- Most entities have far less data than the three banks; payment systems and technology providers would get mostly news questions.
- This brings back custom questions in a new form, which Phase 1 stopped (item P) because they were not in the PRD.

## The mock

Three variants on the DBS Overview, with real figures from the 8 Oct run:

- A, under the brief: suggestions and a box at the foot of the brief; the answer opens full width above Top developments.
- B, side panel and drawer: suggestions in the side column; the answer opens in a drawer like the evidence drawer.
- C, pinned answers: a "Your questions" section of pinned answers, redrawn each run, with a Changed mark.

Example answer content (30 June 2026):

- DBS lends 56% outside Singapore against 50% at UOB.
- Greater China: DBS 25%, UOB 14%. Southeast Asia excluding Singapore: DBS 9%, UOB 21%.
- UOB Greater China NPL ratio 4.8%, up from 2.7% a year earlier; DBS Hong Kong 2.2%.
- Since 1 July to 7 October: DBS shares +18.4%, STI +8.7%, UOB +7.0%.

DBS reports South and Southeast Asia as one region, so UOB's Malaysia, Thailand and Indonesia are summed to compare.

## Against the FMD session findings

See `fmd-session-findings.md`.

Where it fits:

- Task B had no comparison page; he used Ctrl+F across pages.
- He would paste every entity tab into Copilot for one summary.
- Per-sentence citations model the fix for the brief headline not matching its sources.
- Pinned answers move towards deliverables, as the team discussed.

Where it misses:

- His main point was overload; the mock adds a block, charts and citations to the Overview.
- DBS against UOB loans is a supervisor's question; FMD asked for country and asset-class comparisons, and FPS covers SGX, FX and markets.
- A closer example is "How do SGX and HKEX compare on IPO funds and turnover this year?" (SGX monthly ends 31 Aug, HKEX 30 Sep, HKEX IPO funds are year to date in HKD).
- It sits on an entity page; his asks were group and cross-country views.
- AUM, asset manager counts, MNC presence and headcount are not stored.
- He wanted at least three sources per item; answers built on single-source developments have the same problem.
- The findings put comparison under "wait for FPS".

Recommendation: use a revised mock as a probe in the FPS interview, on the Singapore equities page, with an SGX against HKEX question, collapsed to one line by default.

## Groups

Groups are predefined in `api/seed/subjects.yaml` (8 groups); dashboards are the user-defined sets.

Decision S3 removed groups as monitored subjects: no screening question, no developments tagged to a group, no group page.
It notes group pages may return for peer comparison.
What the participant asked for is a view across members, which needs no group-level monitoring.

Two homes:

1. A roll-up group page for peer sets with matching data: Singapore banks and Exchanges (SGX, HKEX) first.
2. A summary across the subjects on a dashboard, where a quick visitor lands (S11 already resolves groups to members).

Recommendation: both, each for its own job, taken to FPS as mocks before building.
Canadian pension funds and sovereign wealth funds are not in the seed.

## How chat apps do it

Claude ([help article](https://support.claude.com/en/articles/13641943-visual-and-interactive-content)) has three kinds:
data display widgets (fixed cards such as weather and recipes from a real data source),
custom visuals (Claude "generates the layout, logic, and interactivity for each question"),
and interactive inputs.

ChatGPT's Intelligent UI (GPT-6) uses "a library of native, streamable components, along with a compiler that processes the interface as the model generates it", with the model trained to compose them.

| | ChatGPT Intelligent UI | Claude custom visuals | IntelMonitor proposal |
|---|---|---|---|
| Built from | Native component library | From scratch | The app's own components |
| Model decides | How pieces fit together | Everything | Components, data references, answer text |
| Content from | Model knowledge and web search | Model or uploaded file | The store, by id |
| Rendering | Streamed through a compiler | In chat | Streamed over AG-UI as STATE_DELTA patches |
| Checks | Training, none stated | None stated | Numbers and citations checked, one retry |
| Afterwards | Stays in the conversation | Stays in the conversation | Pinned and answered again each run |

The proposal matches ChatGPT's architecture: a component library the model composes, streamed in.
A nicer interface is now standard in chat apps, so IntelMonitor's case rests on stored data chat apps lack, checked numbers, weekly updates without asking, and the same answer for everyone.

ChatGPT almost certainly uses its own in-house system, not AG-UI.
AG-UI (from CopilotKit) is a wire format for teams connecting their own agent to their own UI.
OpenAI's related public pieces are the Apps SDK (on MCP), ChatKit widgets, and the proposed MCP Apps extension; none is confirmed as what powers Intelligent UI.
For IntelMonitor the value is in the component library and the schema; AG-UI is a reasonable transport since the Generate agent already uses it.

## Requirements if built

1. Component schema: a typed union like `server/widgets.py` but finer grained: bar, line, table with data references, text with citation ids, sources.
2. Data references with fixed server-side transforms: rebase to 100, sum segments, share of total, year-on-year change, latest value.
3. Read tools wrapping existing code: `get_exposures(subject, measure, dimension)`, `get_series(ids, from, to)`, `search_developments(subject, days, text)`, `get_impacts(subject, days)` over `server/impacts.py`, and the existing `list_subjects`.
4. Checks: schema validation, references resolve with compatible units, numbers in the text appear in tool results, citations exist, one retry with the reason (as in `pipeline/custom.py`).
5. Runtime: Claude Agent SDK in-process tools streamed over AG-UI, already in `agent/generate.py` and `agent/tools.py`.
6. Storage and a pipeline stage: an answers table (question, spec, text, run) and a run stage for suggested and pinned questions, cached when inputs are unchanged.
7. Suggestions: templates in code, ranked and worded in the brief call.
8. Frontend: one renderer per component type, the question box, and the streaming steps state.

No sandbox.
Code execution only becomes worth it if real questions regularly need computation the transforms cannot express (regressions, ad hoc joins).
Its cost: numbers from model-written code cannot be traced to a source, it needs isolated infrastructure, and every answer is a new program to trust.
A read-only SQL tool is a milder version of the same trade.

## Status

- The Generate agent is parked in Phase 1; a customisable layout is a Could have in the PRD.
- Comparison and brief drafting wait for the FPS interview.
- Next step if pursued: rework the mock for FPS (Singapore equities, SGX against HKEX, collapsed by default).
