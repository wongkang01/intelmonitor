# Pipeline evaluation plan

This plan answers action item 6 from the 2026-09-30 team review: is the current pipeline worth its complexity, or can a simpler one do the job?
It also covers item 7 (compare with plain Claude and GPT), in two parts: the V0 standing-question variants, scored like the others, and a dashboard head to head judged by analysts.
It also asks whether Jev can be replaced by a local model.
User testing of the current local build runs in parallel and decides which features matter; this plan measures answer quality and cost.

## Decision it informs

For each quality stage: keep it, cut it, or replace it.
For the pipeline as a whole: keep it, or rebuild on a simpler baseline and bring back only the features users need.
For Jev: keep it, or swap in a local model or Claude.

## What already exists

- 547 documents (368 news, 107 official, 70 DMS, 2 detector) and nine weekly runs from 2026-07-30 to 2026-09-24.
- 30 subjects and 46 standing questions, about 200 answers per run.
- Answers cite developments, developments cite findings, findings cite verified quotes in documents.
- `inference_records` logs every Jev and Claude call with stage, tokens, cost and duration, so cost per stage comes for free.
  Jev calls have no cost recorded; take Jev cost from OpenRouter billing.
- Model calls are cached by stage and input hash.
  A variant that changes one stage reuses cached calls for everything upstream, and only that stage and what follows it is recomputed.
- Jev is used in four stages: screen, same_event (development merge), materiality, and custom_match (custom questions).

## Frozen setup

- Freeze a copy of `data/intelmonitor.db` as the eval corpus.
  Every variant runs in its own copy of that file, so no variant touches the working database.
- Two run dates: 2026-09-17 (base) and 2026-09-24 (scored).
  The pair makes change detection testable.
- 15 standing questions, picked to cover:
  - topic, group and entity scopes
  - news-flow questions (7 day lookback) and state questions (30 day lookback)
  - an upcoming-dates question
  - a series-driven question with numbers (for example geopolitics financial channels)
  - an incident question on a bank, since incidents are a likely next feature
- Custom questions are out of scope; they use a separate path.

## Gold set (human work)

The person does not read or tag every document.
A question's lookback window holds 184 documents (7 days) to 417 (30 days), far too many to read per question.
Instead the person judges a pool of candidates per question, the standard pooling method from search evaluation.
Documents that no method finds are missed by every variant alike, so the comparison stays fair.

### Answer gold, per question on 2026-09-24

1. Build the pool, by script, after the variants have run:
   - every document any variant cites for that question
   - documents an independent Claude pass over the raw window marks as about the subject (it reads the documents, not the pipeline's tags)
   - keyword hits on the subject's aliases
   The pool is shown without saying which variant cited what.
   Expect about 15 to 40 documents per question; the pipeline tags 13 per subject per week on average, up to 60 for the busiest subject.
2. The person reads each pooled document's title and opening, and marks it in or out for the question.
3. Claude groups the kept documents into events; the person merges, splits or renames the groups.
   The groups are the key developments.
4. The person sets the expected state (stable, watch, needs attention, new) and marks the developments an answer must mention.

Structured data needs no hand-made links.
The series facts are computed by code from the observations (`pipeline/facts.py`), not by a model, so the script lists each series-driven question's moves in the window and the person only marks which moves an answer must mention.
Whether an answer quotes the numbers right is checked automatically against the same facts.

### Change gold

Derived, no extra work.
A gold development whose earliest source is after the 2026-09-17 run is new; one with older sources and a new source since is updated.

### Jev swap labels

Labeled blind, with no model suggestions, because Claude is one of the swap candidates and suggestions would favor it.

- **Screening, 200 documents.**
  Relevant or not, and which of the 30 subjects each touches, from the title and opening.
  Stratified: a third Jev marked relevant, a third it marked irrelevant, a third from the uncertain band routed to Claude.
- **Merge, 100 document pairs.**
  Same event or not.
  Half from pairs Jev merged, half from candidate pairs it kept apart.
- **Materiality, 60 developments.**
  Level 0 (trivial) to 4 (critical).

### Effort

| Task | Size | Estimate |
|---|---|---|
| Answer gold | 15 questions, pools of 15 to 40 documents | 5 to 7 hours |
| Change gold | derived | none |
| Screening labels | 200 documents at about a minute each | 3 to 4 hours |
| Merge labels | 100 pairs | about 1 hour |
| Materiality labels | 60 developments | about 1 hour |
| Judge check | 20% of scored answers, about 30 | about 2 hours |
| **Total** | | **12 to 15 hours** |

The screening labels can start now; they do not depend on any run.
If time is short, drop the merge and materiality labels and swap Jev only in screening first.

## Variants

| Id | Variant | How it is built | Full runs |
|---|---|---|---|
| V0-C | Claude, plain | Sent by hand in claude.ai: one prompt per standing question "as of 2026-09-24", web search on | 15 prompts |
| V0-G | GPT, plain | The same prompts sent by hand in ChatGPT | 15 prompts |
| V1 | Simple baseline | Per subject, retrieve the documents in the question's lookback (FTS5 over the frozen corpus), then one Claude call per question that answers and cites documents | 2 dates |
| V2 | Current pipeline | As is | 2 dates |
| V2-screen | Without screening | Every document goes to extract; subjects come from the findings' own subject tags | 2 dates |
| V2-quotes | Without quote verification | Keep findings whose quotes do not match the document | 2 dates |
| V2-merge | Without development merge | Every finding is its own development | 2 dates |
| V2-materiality | Without materiality | Every development gets the same level; needs attention comes only from the answer step | 2 dates |
| V2-facts | Without the facts guardrail | Answers skip the number check and retry | 2 dates |
| V2-cut | Without every stage that lost little on its own | Built after the leave-one-out results | 2 dates |
| Jev swap | Jev vs 2 to 3 local models vs Claude | Offline on the labels in items 3 to 5 | none |
| Jev winner | Best swap candidate in the full pipeline | Only if it matches Jev at lower cost or beats it | 0 or 2 dates |

Notes:

- Detectors are not ablated.
  They added two documents to the corpus; check by hand whether either is cited in a scored answer.
- V0 prompts are generated by script from the standing question, the subject's description and the run date, and ask for a state and source links.
  Send each in a fresh chat with memory, custom instructions and projects off, and paste the reply into the file the script gives, one per question.
- V0 web search sees news after 2026-09-24.
  The judge flags claims dated after the run date and they are scored as unsupported.
- V0 can only be scored on correctness and coverage; it has no corpus, no change diff and no stable citations.
- Stability: run V1 and V2 three times each on 2026-09-24 with the model-call cache bypassed.
  With the cache on, a rerun returns the same answers and says nothing about stability.

## Code needed

- `im run --without <stage>` for screen, quotes, merge, materiality and facts, each with the fallback in the table.
- `im run --no-cache` for the stability reruns.
- An `ask_local` engine with the same signature as `ask_jev`, answering Jev's question types (Noul, Choice, Score) with a local model, so `Inference` can switch engines by setting.
  Calibrated probabilities matter because the pipeline routes on Jev's uncertainty band; the local engine takes probabilities from token logprobs where the model exposes them.
  Candidates, from Hugging Face:
  - an NLI zero-shot classifier (DeBERTa-v3 family) for relevance and subject tags
  - a 7 to 8B instruct model run with `transformers` or `llama.cpp`, for all four Jev stages
  - embedding similarity with `fastembed`, already a dependency, for subject tags and same-event pairs
- The V1 baseline as its own small module over the frozen corpus.
- An export step that turns any variant into one shared format:
  `{question_id, subject_id, run_id, summary, state, citations: [{document_id, quote?}], changes: [development or document id]}`.
  V2 citations resolve development to findings to quotes; V1 cites whole documents; V0 cites URLs.
- A judge step and a score step over the exported files.
- An evaluation report written to a file, so results are repeatable and can be diffed between rounds.

## Metrics

Answer level, per question, from the exported outputs:

| Metric | How it is measured |
|---|---|
| Correctness | Split the summary into claims; the judge checks each claim against the text of the sources it cites. Share of claims supported. |
| Coverage | Share of gold key developments the answer mentions. |
| State accuracy | Answer state matches the gold state. |
| Unsupported numbers | Numbers in the answer that match no cited source or fact. Reuses `unsupported_numbers` in `pipeline/answers.py`. |
| Change detection | Precision and recall of the new and updated flags against the change gold. Only for variants that produce changes. |
| Stability | Across three uncached reruns: how often the state changes, and how much of the key-development set changes. |

Component level, offline:

| Stage | Metric |
|---|---|
| Screening | Precision, recall and F1 for relevance; F1 for subject tags; cost and time per 1,000 documents. |
| Merge | Precision and recall on same-event pairs. |
| Materiality | Exact level match, and agreement within one level. |

Operating cost, per variant: model spend per run, wall-clock time per run, and lines of code the variant needs.

## Judge

Opus 5.5 (`claude-opus-5-5`) judges claim support and coverage with a fixed rubric.
It is a different and stronger model than the one writing the answers (`claude-sonnet-5`), and both judge tasks are checked against references: a claim against its cited text, an answer against the gold developments.
The judge sees answers without the variant name.
A person scores 20% of the items blind to the variant, with V0-G answers overrepresented, since GPT's answers are the ones a Claude judge is most likely to score unfairly.
If the person and the judge agree on fewer than 85% of those overall, or on V0-G alone, fix the rubric and rejudge before reading any results.

## Feature inventory

Filled in alongside the runs, one row per user-facing feature: the pipeline stages it needs, and its state in V1 and in V2-cut (present, weaker, missing).
For each missing feature, note whether it could be rebuilt cheaply on the simpler pipeline.
User testing marks which features testers used or asked for.

## Dashboard head to head (item 7)

A product comparison, separate from the scored variants.
V0 asks whether a plain LLM answers the standing questions as well as the pipeline; this asks whether an analyst is better served by IntelMonitor than by a monitor they set up themselves in ChatGPT or Claude.

### Setup

- One scope: Singapore banking sector, matching the Singapore banks starter dashboard (DBS, OCBC and UOB, with Banking regulation).
- Three contenders:
  - IntelMonitor's Singapore banks dashboard
  - a ChatGPT scheduled task, given the feature set of that dashboard and asked to update every 12 hours (already running)
  - Claude with the identical prompt, on the same 12-hour schedule
- Day 0 is the day the ChatGPT task started.
  Run `im ingest` and `im run` that day, or as close to it as possible, and start the Claude schedule the same day.
- Day 7: run `im ingest` and `im run` again.
  IntelMonitor keeps its weekly cadence; that is the product as it is, and the 12-hour updates are the product ChatGPT offers.
- Keep for each contender:
  - IntelMonitor: a screenshot of the dashboard on day 0 and day 7, and the run ids
  - ChatGPT and Claude: every scheduled update, copied into a dated file as it arrives, so the history survives edits to the task

### Prompt

The exact prompt given to the ChatGPT task, reused word for word for Claude:

```
<paste the ChatGPT scheduled task prompt here>
```

If it does not already say so, the Claude copy still gets the prompt unchanged; the two chatbots must get the same brief.

### Evaluators

- Two or three analysts, rating independently; no discussion until everyone has submitted.
- Each evaluator sees the three contenders in a different order.
- Evaluators rate day 0 first, then day 7.
- For the chatbots, day 0 is the first update and day 7 is the latest update on day 7.
  Evaluators may scroll back through earlier updates, but that counts toward the morning check time.
- Allow about an hour per evaluator.

### Rubric for evaluators

This section can be handed to evaluators as is.

You will review three monitoring dashboards for the same scope, A, B and C.
Rate each one on its own, then compare.
Work through the tasks in order; some scores depend on them.

**Task 1: morning check.**
Open the dashboard and start a timer.
Stop it when you can say, in your own words, what changed recently and what needs your attention.
Record the time, capped at 5 minutes.

**Task 2: key events.**
After seeing all three dashboards, list up to 8 events in this scope that you judge most important for the period, from any of the three dashboards or from your own knowledge.
For each dashboard, mark which of those events it shows.

**Task 3: claim check.**
Pick 5 specific claims from each dashboard, favoring ones with numbers, dates or named actions.
Open the source each claim links to.
Mark each claim: supported by the source, not supported, or no source given.

**Scores, 1 to 5.**

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| What changed | Cannot tell what is new | New items are there but mixed in with old | What changed and what needs attention are clear at a glance |
| Relevance | Mostly filler, stale or off-scope items | Some noise | Every item belongs and matters to a supervisor |
| Evidence | Claims have no sources, or sources are hard to find | Sources exist but take effort to match to claims | Each claim leads to its source in one step |
| Clarity | Needed explanation to understand the layout or labels | Understood with some effort | Understood straight away |
| Depth | Headlines only | Some context on why items matter | Explains why each item matters for Singapore and supervised institutions |
| Trust | Would re-check everything before acting | Would re-check the important items | Would act on it and check only the evidence that matters |

**Day 7 update, 1 to 5.**

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| Change accuracy | Presents old items as new, or misses new ones | Mostly right, some errors | Exactly what changed since day 0 |
| Update effort | Had to read several updates or re-prompt to know what changed since day 0 | Some scrolling or clicking needed | The latest view says what changed since day 0 with no effort |

**Overall.**
Rank A, B and C for your Monday morning check.
In two or three sentences: what made the top one better, and what would make you stop using it.

### Score sheet

One row per evaluator, scope, day and dashboard:

| Field | Values |
|---|---|
| Morning check time | seconds, capped at 300 |
| Key events shown | count out of the evaluator's list |
| Claims supported | count out of 5, plus count with no source |
| What changed, Relevance, Evidence, Clarity, Depth, Trust | 1 to 5 each |
| Change accuracy, Update effort | 1 to 5, day 7 only |
| Rank | 1 to 3 |
| Comment | free text |

### Reading the results

Report the median per criterion per contender, and the rank counts.
Where evaluators differ by 2 or more points on a criterion, report the spread, not only the median.
Task 2 and task 3 counts are the most objective; weigh them over the 1 to 5 scores when they disagree.

## Decision rules

Fixed before any results are read, so the results cannot move the goalposts.
The thresholds below are defaults; adjust them now if they look wrong.

- **A stage is cut** when removing it costs less than 3 points on correctness, coverage and state accuracy, adds no unsupported numbers, and no feature testers valued depends on it.
- **A stage is fixed, not cut** when removing it hurts, but the intermediate results show it hurts because of a fixable defect.
- **The pipeline is replaced by V1** when V1 is within 5 points of V2 on correctness and coverage, and every missing feature is either unused by testers or cheap to rebuild.
- **Jev is replaced** when a candidate is within 2 points of Jev's F1 on screening at a lower cost, or beats it outright, and holds up in its full run.

## Cost and time

- Claude spend for a full recompute of one late run was about $40 in the existing records, mostly the answer step.
  Leave-one-out variants reuse cached calls upstream of the removed stage, so most cost less.
  Budget $500 to $800 for all full runs, plus stability reruns.
- The gold set is 12 to 15 hours of analyst time; see Effort above.
- The dashboard head to head is about an hour per evaluator, plus a few minutes a day to copy the chatbot updates into files.

## Order of work

1. Freeze the corpus, pick the 15 questions, fix the decision rules.
2. Human: screening, merge and materiality labels.
   In parallel: build the `--without` flags, V1, the export, the pooling script and the judge.
3. Run the offline Jev swap on the labels.
4. Run V2 and V1, then the five leave-one-out variants; send the V0 prompts by hand.
5. Build the pools; human: answer gold.
6. Judge and score; check 20% by hand.
7. Build and run V2-cut from the leave-one-out results.
8. Stability reruns for V1 and V2.
9. Write up: scores, feature inventory with user-testing marks, and a recommendation per stage.

The dashboard head to head runs on its own clock: it started with the ChatGPT scheduled task, day 7 is a week later, then evaluator sessions.

## Settled

- Only the documents already retrieved are used; no internal documents.
  The dashboard head to head is the one exception: it adds a fresh ingest of the same public sources on day 0 and day 7.
- The dashboard head to head covers one scope, the Singapore banking sector.
- Jev swap candidates may be any Hugging Face model or Python library.
- Group-scope questions stay in the 15; the evaluation is against the current feature set.
