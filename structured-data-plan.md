# Structured data plan

This plan brings the MAS statistics APIs, FRED, CoinGecko and DefiLlama into the POC.
Today every number in the app is a count of documents or an LLM tag.
Measured series add numbers computed by code, years of history without backfilling pipeline runs, and signals that arrive before any article is written.
It extends `poc-plan.md` and `iteration-plan.md`; `ui-ux.md` already says numbers are computed by code and never typed by the LLM.

## What the sources give

Checked with the keys in `.env` on 2026-09-27.

| Source | Datasets | Frequency | History | Notes |
| --- | --- | --- | --- | --- |
| MAS I.18 | Non-bank loan-to-deposit ratio: overall, SGD, foreign currency | Monthly | Jul 2021 on (61 rows) | One call returns the whole table; latest rows carry `p_ind: "P"` (preliminary) and get revised |
| MAS I.12A | Non-performing loan ratio, overall and 20 sectors | Quarterly | 2021 Q3 on (20 rows) | Same shape; preliminary flag |
| MAS I.5B | Loans to non-residents, total and by industry, S$ million | Monthly | Jul 2021 on | Industry, not country |
| MAS exchange rates | SGD per unit of USD, EUR, GBP, CNY, HKD, MYR, THB, IDR, PHP, VND and 11 more | Daily | 1988 on, daily from 2003 | The unfiltered URL returns the whole table in one call (6,739 rows, 3.3 MB); `end_of_day=YYYY-MM-DD` returns one day; other filters are ignored; Asian currencies are quoted per 100 units |
| FRED | USD/SGD, USD/MYR, USD/THB daily; USD/IDR monthly; Fed funds (`DFF`), ECB deposit rate (`ECBDFR`), US 10-year (`DGS10`), US high-yield spread (`BAMLH0A0HYM2`), VIX (`VIXCLS`) | Daily or monthly | Decades; the high-yield spread only from Sep 2023 | No PHP or VND series, and MAS has all FX history, so FRED is used for rates only; FRED stalls requests that send a browser user agent |
| CoinGecko (demo key) | Price and market cap: USDT, USDC, PYUSD, USDP, XSGD | Daily beyond 90 days, hourly within | 365 days (a range starting earlier answers 401) | Rate-limited; XSGD is pegged to SGD, so its peg needs USD/SGD |
| DefiLlama (no key) | Circulating supply per stablecoin and per chain, 427 coins | Daily | Full | Total stablecoin market cap as well |

Everything is system-wide or market-wide.
There are no per-bank figures: bank pages show the Singapore banking system as context, labelled as such.

Gaps: no BNM, PBoC or HKMA policy rate and no SORA in these APIs.
SORA is in the MAS API catalogue under a separate subscription; the HKMA open API (already a document source, no key) may carry HKMA rates.
Both are follow-ups, not part of this plan.

## Data model

New tables in `api/intelmonitor/store/db.py`:

| Table | Columns | Purpose |
| --- | --- | --- |
| `series` | `id` (e.g. `mas.ltd.overall`), `source`, `name`, `unit`, `frequency`, `decimals`, `bad_direction` (up, down or none), `source_url`, `derived_from` (JSON, null for raw series) | The catalogue, loaded from a seed file |
| `series_subjects` | `series_id`, `subject_id`, `role` (primary or context) | Which subjects a series belongs to |
| `observations` | `series_id`, `period` (period end, YYYY-MM-DD), `value`, `preliminary`, `available_at`, `fetched_at`; key (`series_id`, `period`) | The latest value per period |
| `observation_revisions` | `series_id`, `period`, `old_value`, `new_value`, `revised_at` | Written only when a fetched value differs from the stored one |
| `run_indicators` | `run_id`, `series_id`, `period`, `value`, `change` (JSON by window), `state`, `detail` | What each run saw, so runs diff and "since your last review" covers indicators too |

Rules:

- `available_at` is when the value could have been known: the source's own publish or create date where it gives one (MAS rows carry `create_date`), otherwise period end plus the source's usual lag.
  MAS reloads whole tables (every row said 31 Aug 2026 when probed), so a create date more than twice the usual lag after period end is a reload, and the value falls back to period end plus the lag.
  A run as of date D only reads observations with `available_at` on or before D, so backfilled runs never see the future.
- Units are normalised on the way in: MAS "per 100 units" quotes become per unit, and every FX series is stored in one declared direction.
- Derived series are computed by code after a fetch and stored as observations with `source = derived`.
  They use a small fixed set of operations, declared in the seed: `deviation` (distance from a target, in percent of the target), `product` (for example XSGD in USD times USD/SGD gives XSGD in SGD) and `share` (a part over a total).
  There is no free-form expression language.
- Series ids, names, units and subject mappings live in `api/seed/series.yaml`, next to `subjects.yaml`, so adding a series needs no code change.

## Collection

- One adapter per source under `api/intelmonitor/ingest/series/`: `mas_stats.py`, `fred.py`, `coingecko.py`, `defillama.py`.
  Each returns typed observations through pydantic models, so schema drift fails loudly.
- Adapters use the existing `CachedHttp`, so every response lands in `data/raw/` and reruns make no network calls.
  Requests for recent data include the fetch date or an explicit end date in the request, so a new day is a new cache key and old days stay cached.
- `im series fetch` fetches every series up to today; `im series backfill --from 2021-07-01` fills history once.
  `im ingest` and Run now call the fetch first, so a run always has current data.
- Backfill cost is small: MAS tables and FRED return full history in one call per table or series, DefiLlama in one call per coin, and CoinGecko in one call per coin for 365 days.
  MAS exchange rates return their whole daily history in one call, so the backfill makes one call for every currency; a daily fetch asks for each weekday of the last 14 days instead (about ten small calls, mostly cached).
- Each fetch logs calls per namespace, the same way document ingest does, and the pipeline report gains a series section: series fetched, rows added, rows revised, failures.

### Failure modes to handle

Written before the code, per the project's testing rule.

1. A key is missing or rejected: skip that source's series, log once, and show the series as "No data" instead of failing the run.
2. The response is HTML or an error page instead of JSON (the MAS gateway does this for malformed queries): treat as a failed fetch, never parse.
3. A field is renamed or removed: pydantic validation fails for that dataset only.
4. A preliminary value is revised: update the observation, write a revision row, and let the next run's indicator note "revised".
5. Weekends, holidays and missing days: daily series have gaps; changes compare with the last available value, never with zero.
6. A stale price: if the latest CoinGecko point is older than a day, the peg state reads "Stale" and no detector fires on it.
7. Unit mistakes: the per-100 quote conversion and the FX direction are covered by an E2E check against a known value.
8. Rate limits (429): retried by `CachedHttp` and never cached.
9. Look-ahead in backfilled runs: `available_at` filtering, checked by an E2E step that runs as of a past date.

## Series catalogue v1

| Series | Source | Subjects (primary, then context) |
| --- | --- | --- |
| Loan-to-deposit ratio: overall, SGD, foreign currency | MAS I.18 | Singapore banks, Singapore; DBS, OCBC, UOB, MAS |
| NPL ratio: overall; construction, transport and storage, manufacturing, wholesale trade | MAS I.12A | Singapore banks, Singapore; DBS, OCBC, UOB, MAS, Banking regulation |
| Loans to non-residents: total and top industries | MAS I.5B | Singapore banks; Geopolitics |
| SGD against USD, MYR, THB, IDR, PHP, VND, CNY, HKD | MAS exchange rates | Each country; SEA countries, MAS, BNM, PBoC, HKMA; Geopolitics |
| Fed funds rate | FRED `DFF` | Fed; Central banks, Banking regulation |
| ECB deposit rate | FRED `ECBDFR` | ECB; Central banks |
| US 10-year yield, US high-yield spread, VIX | FRED | Geopolitics (risk sentiment); Central banks |
| Price and peg deviation: USDT, USDC, PYUSD, USDP; XSGD against SGD | CoinGecko, derived | Tether, Circle, Paxos, StraitsX; Stablecoin issuers, Stablecoins |
| Circulating supply per coin, and its share by chain | DefiLlama | Each issuer; Stablecoin issuers, Stablecoins |
| Total stablecoin supply | DefiLlama | Stablecoins |

## Features

### F1. Series store and API (no UI)

The tables, adapters, seed, CLI and backfill above.
API: `GET /series/{id}?from=&to=` returns observations and revisions; `GET /subjects/{id}/indicators` returns the subject's series with latest value, change over 1 week, 1 month, 3 months and 1 year, where the latest value sits in its history (percentile), and state.

Built, store and collection:

- The five tables are in `api/intelmonitor/store/db.py` and `connect()` creates them in existing stores.
  Every run writes `run_indicators` (see the endpoints below).
- `api/seed/series.yaml` holds 62 series: 22 MAS, 5 FRED, 5 CoinGecko, 15 DefiLlama and 15 derived.
  `load_series()` in `seed.py` checks that subjects exist, that derived inputs are declared above their use, and that every `fx.sgd.<ccy>` series is SGD per unit with a matching MAS field.
- Ids: `mas.ltd.*`, `mas.npl.*`, `mas.nrl.*` (loans to non-residents), `fx.sgd.<ccy>`, `fred.*`, `cg.<coin>.price`, `llama.<coin>.supply` and `llama.<coin>.supply.<chain>`, `llama.total.supply`, and `derived.<coin>.peg`, `derived.<coin>.share.<chain>`, `derived.xsgd.price_sgd`.
- Adapters in `api/intelmonitor/ingest/series/` share one interface, `fetch(http, settings, sources, window) -> Fetched`, and never raise for a bad source.
  `collect.py` runs them, saves, derives and logs calls per namespace; `store/series.py` saves observations and reads them.
- `read_observations(conn, id, as_of)` returns only what was available by the end of `as_of`, at the value it had before any later revision.
- `available_at`: MAS tables by the create-date rule above (31-day lag for monthly tables, 62 for I.12A); exchange rates the next day; FRED `lag_days` after the date (default 1); CoinGecko the point's own time; DefiLlama the end of the point's day.
- A fetched value counts as a revision only when it differs at the series' precision and by more than float noise; a preliminary flag that clears without a value change is updated without one.
- Derived values: `deviation` is percent off the target; `product` and `share` take, for each period of the first input, the latest second input already available at that time, so weekend coin prices use Friday's rate and a later rate never rewrites an earlier result.
- `im series fetch`, `im series backfill --from 2021-07-01`; `im ingest` fetches series before documents, and Run now fetches them before the run, logging a failure and going ahead.
  `im report` has a Series section: the latest fetch, and per source the series, observations, latest period and revisions.
- Differs from the plan: every FX series comes from MAS, whose unfiltered exchange-rate URL returns the whole daily history in one call, so FRED is not used for FX and nothing needs throttling.
  `CachedHttp` gained `vary` (keyed, not sent: the fetch date for URLs without a date parameter), `secret_params` (sent, never keyed or stored: FRED's key) and `cache_errors`.
  Data API requests send the user agent `intelmonitor/0.1`, because FRED stalls the browser user agent used for official pages.
- Failure modes: (1) a missing key fails that source's series with one log line per reason, and a rejected key (401 or 403, or FRED's 400) stops that source's further calls; error responses are never cached, so a fixed key works on the next fetch.
  (2) An HTML page is retried, then fails its series, and is never cached or parsed.
  (3) Validation fails one table or response; a missing MAS field fails only its series.
  (4) Revisions as above.
  (5) Gaps stay gaps (FRED's "." is skipped).
  (6) The fetch lists CoinGecko and DefiLlama series whose latest point is more than a day old as stale; the "Stale" state belongs to the indicators endpoint.
  (7) The per-100 conversion was checked against FRED cross rates: SGD per MYR on 18 Sep 2026 is 0.3128 from MAS and 0.3132 from `DEXSIUS / DEXMAUS`, SGD per THB 0.038342 and 0.038294; the walkthrough checks both values through `GET /series`.
  (8) `CachedHttp` already retries 429 and never caches it.
  (9) `read_observations` with `as_of`.
- `data/intelmonitor.db` holds the real backfill from 2021-07-01: 55,890 observations.

Indicator failure modes, written before the code:

1. No observation available as of the date (a skipped source, a date before the history): state "No data", no values, no error.
2. A window reaching back before the stored history: that change is empty, never a change from zero.
3. Gaps (weekends, holidays, a missing month): the change uses the last value on or before the window's start.
4. Month-end periods: one month before 30 Sep is 31 Aug, not 30 Aug, which would skip a month.
5. A window shorter than the series' frequency (1 week on a monthly series): empty, not a one-month change under a one-week label.
6. A reference value of zero: no percent change.
7. Look-ahead: a run as of D sees only observations available by the end of D, at their value before any later revision, and only revisions made by then.
8. A stale market price: a CoinGecko or DefiLlama series, or one derived from them, whose latest point is more than a day old reads "Stale".
9. A revision since the last run: the indicator reads "Revised" and lists it.

Built, endpoints and run indicators:

- `GET /series/{id}?from=&to=` returns `SeriesDetail`: the series' catalogue entry, its subjects with role, its observations with periods in the range (inclusive, both optional) at their current value, and the revisions of those periods.
- `GET /subjects/{id}/indicators?as_of=` returns `SubjectIndicators`: every series mapped to the subject, primary then context in catalogue order, from what was available by the end of `as_of` (default today).
  Each carries the latest observation, `changes` for 1w, 1m, 3m and 1y, `percentile`, `history_start` and `history_count`, `state`, and recent `revisions`.
- A change compares the latest value with the last observation on or before the window's start (7 days, or 1, 3 or 12 calendar months, month end to month end).
  Series in "%" change in percentage points, others in percent (`change_basis`).
  A change is null when the window is shorter than the frequency (1w on monthly, 1w and 1m on quarterly), reaches before the stored history (CoinGecko's 364 days have no 1y change), or starts from zero.
- `percentile` is the percent of the stored history, from the backfill floor to the latest value, below the latest value, ties counting half.
- States, worst first: `no_data` (nothing available by the date), `stale` (a CoinGecko or DefiLlama series, or one derived from them, whose latest point was available more than a day before the end of the date, or before now if that is earlier), `revised` (a revision made since the previous run, or in the 31 days to the date for the endpoint), `preliminary` (the latest value is flagged preliminary), `current`.
  Labels for them wait for the F4 mock.
- The computation is `pipeline/indicators.py`, shared by the endpoint and the pipeline: `compute_run` writes every series' indicator as of the run date to `run_indicators` before answering questions, counting revisions from the previous run's date.
  A series with no data by then gets no row, since `period` and `value` are required.
- `im ingest` and Run now already fetched series first (above); `im report`'s Series section now says how many series the latest fetch got, and lists each run's indicator states with a look-ahead check: no run indicator may use an observation available after its run date.
- Web: `useIndicators(id, asOf?)` and `useSeries(id, range)` in `web/lib/api/queries.ts`; no UI yet.
- The walkthrough's series step checks the per-100 units, that indicators as of Run 1 see nothing later while today's do, that changes never start from zero or from the latest period, and that a date before the history gives "No data"; it writes `indicators.json` to the run's artifacts.
- Checked against the store on 28 Sep: the loan-to-deposit ratio, all currencies, is 70.3 for Jul 2026 (preliminary), up 0.3, 2.7 and 4.5 points on 70.0, 67.6 and 65.8, at the 55th percentile of 61 months; Fed funds is 3.88 on 24 Sep, unchanged on the week, up 0.25 on the month and three months (3.63) and down 0.21 on the year (4.09); USDC is 0.99988 on 27 Sep, 0.0118% below its peg, up 0.0182 points on the week from 0.030% below.

### F2. Facts in standing answers

A new pipeline step computes a facts block per subject from its series as of the run date, for example "USDC stayed within 0.2% of its peg all week; its lowest was 0.9981 on 12 Sep".
The answer prompt receives the block and may only quote numbers from it or from developments.
Question-to-series links are declared in `questions.yaml` (for example `issuer.peg` uses the peg series, `bank.financial` the loan-to-deposit and NPL series, `country.economic-policy` the FX series).
Some states follow fixed rules instead of model judgement, declared per question: a coin more than 0.5% off its peg for over 24 hours makes Peg "Needs attention".
Answers can cite a series; the evidence drawer shows it as a data source with a small chart, the latest value, and a link to the source table.

Failure modes, written before the code:

1. A linked series has no data by the run date (a skipped source, a date before its history): its fact says so and carries no numbers, and no rule fires on it.
2. A stale market price: the fact says the latest point's date and that it is stale, and no rule fires on it.
3. Look-ahead: a run as of D states only observations available by the end of D, at their value before any later revision.
4. Gaps: the window's low and high come from the points that exist; a window with no points states the latest value and its date.
5. Monthly and quarterly series: no low or high over a window shorter than their frequency; the fact states the latest release, its changes and whether it is preliminary or revised.
6. A question pattern that matches none of the subject's series (a bank with no system data): the question gets no facts and the prompt says so.
7. The model quotes a number that is in neither the facts nor the developments: the question is asked again once with the numbers named; an answer that still quotes one is kept, and the run log counts it.
8. The model cites a series not linked to the question, or an unknown id: the citation is dropped, like an ineligible development.
9. A rule on a single breaching point: a spell runs from its first to its last point in a row beyond the threshold, so one daily point is never 24 hours.
10. Several rules fire for one question: the worst state wins, and the answer keeps each rule's sentence.

Built:

- Links: a question in `api/seed/questions.yaml` lists `series`, patterns over series ids (`*` spans dots) matched against the series mapped to the subject in `series.yaml`, primary or context.
  `issuer.peg` uses `derived.*.peg` and `llama.*.supply`; `stablecoins.reserves-peg` the peg series and total supply; `issuer.strategy` the chain shares; `bank.financial` and `country.financial-sector` `mas.ltd.*` and `mas.npl.*`; `country.economic-policy` `fx.sgd.*`; `central-bank.policy-stance` Fed funds, the ECB deposit rate and `fx.sgd.*`; `geopolitics.financial-channels` `fx.sgd.*`, the US 10-year yield, the high-yield spread and VIX.
  A bank outside Singapore (Maybank, CIMB, Bangkok Bank) matches nothing, so its answers get no facts.
  The seed loader rejects a pattern that matches no series and a rule on a series the question does not link.
- Rules: `rules` on a question, of one kind, `deviation`: the series more than `beyond` from zero, either way, for at least `for_hours`, with a spell reaching into the lookback.
  `issuer.peg` and `stablecoins.reserves-peg` declare 0.5% for 24 hours, state `needs_attention`.
  With daily prices, 24 hours means two days in a row beyond 0.5% ("over 24 hours" in the brief is read as at least 24).
  Rules only escalate: the stored state is the worse of the model's and the rules'.
  In the stored history the rule fires for XSGD from 2 to 4 May 2026 (1.0069 SGD at its furthest) and 25 to 26 Jan 2026; USDP's single day 0.57% off on 11 Sep 2026 does not fire.
- `pipeline/facts.py`: `subject_facts(conn, subject_id, questions, as_of, revised_since)` returns one `SeriesFact` per linked series and the `FixedState`s of rules that fire.
  It reads observations and indicators as of the date (F1's `read_observations` and `compute_indicators`), so look-ahead is ruled out the same way.
  The sentence is written by code: for a peg, how far it strayed in the window with the lowest and highest price and the latest; for other daily series, the latest value, its 1w, 1m, 3m and 1y changes with the values they start from, the window's range, and its rank in the stored history as counts ("above 523 of the 1,904 values since 1 Jul 2021"); for monthly and quarterly series, the latest release with its preliminary flag and availability date, its changes and rank; revisions since the previous run; "no data available by" or "stale".
  Each FX change says which way the SGD went ("up 0.23% on the week (SGD weaker against the USD; from 1.2733 SGD per USD on 16 Sep 2026)"): without it, answers read a fall in SGD per USD as the SGD weakening.
  A daily series' window is the longest lookback of the subject's questions that use it.
- Answer step: the prompt lists the facts as `S:<series id> | <sentence>`, and under each question its `series` and any `fixed state` with the rule's sentence.
  Answers may quote numbers only from the facts and developments; the model returns `series_ids` next to `development_ids`.
  Code keeps only linked series ids, fixes the state, and re-asks once the questions whose summaries quote a decimal or percentage found in neither the facts nor the listed developments and upcoming dates; the run log prints how many answers still do.
- Store: `question_answers` gained `series_ids` and `state_rules` (JSON), and `run_facts` keeps each run's facts per subject and series, so a cited series shows what the answer saw.
- API: `QuestionAnswerView` has `series_ids` and `state_rules`; `AnswerEvidence.series` lists the cited series in citation order, each a `SeriesFactView` (the series' catalogue entry and the run's `SeriesFact`).
  `GET /subjects/{id}/facts?as_of=` returns `SubjectFacts`: what a run as of that date would give the subject's answers, with the rules that fire.
  The evidence drawer's data source item is not built; it waits for its mock.
- `im report`'s Series section lists each run's facts, answers citing series and states fixed by rules, with a look-ahead check on every stated observation.
- Runs: 17 Sep, 15 Aug (new, the past-date check) and 24 Sep were recomputed with facts; 25 or 26 of the 200 answers in each cite series, quoting their numbers ("USDC stayed near peg, 0.9996-0.9999 USD over 14 days; supply rose 2.98% weekly to $75.87bn"), and no rule fires on those dates.
  The 15 Aug run's latest stated observation was available on 15 Aug: its NPL facts stop at Q1 2026 and its loan-to-deposit facts at May 2026, while later runs state Q2 and July.
- The walkthrough's last step checks that linked answers cite series whose facts were known by the run date, that facts as of 15 Aug 2026 state nothing available later while today's do, that a date before the history states no data, and that the XSGD spell fixes Peg while USDP's single day does not; it writes `facts.json`.

### F3. Detectors: developments from data

`api/seed/detectors.yaml` declares rules over series, of four kinds:

- `threshold`: a level crosses a value (Fed funds changes; loan-to-deposit ratio above 90%).
- `deviation`: distance from a target beyond a value for a minimum time (peg off by more than 0.5% for 24 hours).
- `move`: change over a window beyond a value or beyond k standard deviations of its history (SGD/THB moves more than 2% in a week).
- `release`: a new MAS release with a notable change (a sector NPL ratio up more than 0.5 points quarter on quarter).

Each firing becomes a development through the existing path: the detector writes a source document with collection `data`, a sentence generated by code, the source table's URL and classification `public`, plus one finding with its subjects, category `market` or `financial`, and event date.
From there clustering, materiality, answers, triage, alerts, search and the evidence drawer work unchanged.
Same-event merging links a detected depeg with news about it, so one development carries both the measurement and the reporting.
Materiality for detector findings is set by the rule, not scored by Jev, so a threshold agreed with analysts maps to a known level.
Default thresholds are placeholders to agree with the pilot analysts.

Failure modes, written before the code:

1. No data, or a stale market series, as of the run date: no detector fires on it.
2. Gaps (weekends, holidays, a missing month): a move compares with the last observation on or before the window's start, a spell's hours run from its first to its last point, and a missing day never counts as zero.
3. A condition that holds for several observations in a row (a level staying above a threshold, a weekly move beyond 2% on three days running) is one event, keyed by its first observation, not one per day.
4. Reruns: the same event gives the same document id, so a rerun adds nothing and a later run finds the same document.
5. Look-ahead: a run as of D evaluates only observations available by the end of D, at their value then, and a detection's document is published when its last observation became known (a revised value when it was revised), so a run as of an earlier date never sees it.
6. Revisions: a preliminary value that fired and is later revised away keeps its document, as a news report stays after a correction; a revision that newly fires is known from the revision.
7. History: only events known inside the corpus window (T0 minus 60 days to the run date) become documents, so five years of history do not flood the developments.
8. A threshold needs a crossing: a series whose history starts beyond the level fires only when it comes back and crosses again.
9. A move in standard deviations needs history: fewer than 30 earlier changes, or none that differ, fires nothing.
10. A rule the data cannot answer (a weekly move on a monthly series, a release rule on a daily series, a deviation rule on a series that is not a distance from a target, a series with no primary subject to tag) is rejected when the seed loads.
11. A detector removed from the seed: its documents stay, but no longer become developments.
12. Materiality: a development made only of detections takes its rule's level without a Jev call; merged with news, it takes the higher of the rule's level and Jev's.

Built:

- `api/seed/detectors.yaml` holds 11 detectors over 35 series, typed by `load_detectors()` in `seed.py`: each has an id, a name, a `series` pattern (`*` spans dots), `category` (market or financial) and `materiality` (trivial to critical).
  `threshold` takes `above` or `below`; `deviation` takes `beyond` and `for_hours`; `move` takes `window` (previous, 1w, 1m, 3m or 1y), `beyond` or `sigmas`, and `direction` (up, down or either); `release` takes `beyond` and `direction`.
  Sizes are in points for series in % and in percent otherwise, as for indicator changes.
  The loader rejects the rules in failure mode 10.
- The rules: Fed funds and ECB deposit rate changes of more than 0.1 points from the previous value; loan-to-deposit ratio above 90%; VIX above 30; US high-yield spread above 5 points; any peg more than 0.5% off for 24 hours; SGD against any tracked currency moving more than 2% in a week; the US 10-year yield moving more than 3 standard deviations in a week; stablecoin supply moving more than 10% in a week; a sector NPL ratio up more than 0.5 points on the quarter; a loan-to-deposit ratio moving more than 2 points on the month.
  The depeg rule and the loan-to-deposit threshold are Significant (needs attention), the rest Notable.
- Differs from the plan: "Fed funds changes" is a `move` from the previous value, not a `threshold`, since a policy change is a step rather than a level crossed; `deviation` applies only to peg series (distances from a target), whose sentences state the price and side of the peg.
- `pipeline/detectors.py`: `detect(conn, as_of, since)` evaluates every rule over each matched series' observations known by the end of `as_of` (F1's `read_observations`), each value known from its availability or from its latest revision by then, and returns the events known from `since`.
  An event is a run of observations meeting the condition, keyed by its first; it fires at the first (a threshold's crossing needs a point before it inside the level), at the point completing a deviation's hours, or at each release.
  `store_detections(conn, as_of)` writes each event known from the corpus start (T0 minus 60 days) as a source document: source `detector`, collection `data`, doc type "Move detector" and so on, the series' source URL, classification public, published when its last value became known, and canonical URL `detector://<detector>/<series>/<first period>`, whose hash is the document id, so a rerun finds it already stored.
  The document text is the sentence, the rule in words, its materiality, and the series; its one finding is the sentence, quoted whole, tagged to the series' primary subjects, with the detector's category and the event date (the value's own date for daily series, the release date for monthly and quarterly ones).
  A `detections` table keeps the detector, series, first period, value, and the adverse flag and direction from the series' bad direction (pegs are always adverse).
- `compute_run` runs the detectors first, then screens and extracts only the other documents; `load_findings` takes detections without Jev tags and with their rule's level, from the seed as it is now (failure mode 11).
  Data sources rank after official and DMS documents and before news, in a development's lead and in the evidence drawer.
  `Collection` has `data` (label "Data") in the API and the web app, so the Source facet, the evidence drawer and Data sources list it.
- `im report`'s Series section lists each run's detections with their development, materiality and sources, and checks no detection is published before its value was available; the inference record check leaves out detections, which make no model calls.
- Formatting shared with facts moved to `pipeline/wording.py`; the facts text is unchanged, checked against the previous code for every subject.
- Real data, runs of 17 and 24 Sep recomputed (8 and 14 new Jev pair calls, 38 and 44 calls with the answers): in the corpus window only the two rate detectors fire.
  The ECB deposit rate rose 0.25 points to 2.50% on 16 Sep (known 17 Sep): a Notable development of its own, new in Run 1, tagged to the ECB.
  The Fed funds rate rose 0.25 points to 3.88% on 17 Sep (known 18 Sep): same-event merging joined it to the FOMC decision's development (19 sources, with the FOMC statement), which Run 2 updates with it; it is Significant by Jev, needs attention, and alerts through the followed Central banks group.
  Over the whole history since 2021 the rules fire 221 times (84 of them stablecoin supply moves, mostly XSGD and PYUSD, and 54 SGD weekly moves), a sign the supply rule's 10% is too tight for small coins; the depeg rule fires on XSGD on 26 Jan and 3 May 2026, as F2's rule does.
  The loan-to-deposit and high-yield thresholds never fire in the stored history.
- The walkthrough's last step finds the Fed funds detection through search, checks its data document (source table URL, doc type, published after Run 1 and by Run 2, event date), that it changed its development in Run 2, tagged to the Fed, at least Notable, and that the development alerts for the followed subject; in the app, the alert opens the evidence drawer on the data source with the sentence highlighted.
  It writes `detections.json`.
  The real seed fires on cached data in Run 2, so the step needs no test seed.

### F4. Indicators on monitor pages

An Indicators section on every monitor page with mapped series: one row per series with the latest value, change, a small line over 12 months, the state as a word, and "system-wide" or "market-wide" where it applies.
Issuer pages get peg, supply and supply by chain; bank pages get the system context; country pages get FX; central bank pages get their policy rate.
Mocked first.

### F5. Indicator widget

A new widget type `indicator` (S, M, L) in `api/intelmonitor/server/widgets.py` and `web/lib/widgets.ts`: settings are a series id, or a subject id that shows its primary series.
S shows the value, change and state; M adds a 12-month line; L adds developments marked on the line.
The widget gallery suggests each subject's primary series; the Generate agent's `add_widget` tool gets the new type through its schema.
Mocked first, together with F4.

### F6. Trend tab on real series

This replaces the document-count trend mocks.
Each monitor page gets a Trend view: the subject's series over 12 months with every development marked on the date it happened, and the standing question states per run beneath.
A per-run LLM step writes "why it moved", citing the developments and the facts block; before 27 Jul the corpus is empty, so the explanation says so rather than guessing.
The `GET /subjects/{id}/trend` endpoint from A7 feeds the development markers.
Mocked first, with the directions in `mocks/trend-future.html` redone on real series.

### F7. Custom questions with series

A custom question's config can name series (for example SGD/MYR); its answer gets their facts block and its widget can show the line.
After F2 and F5.

## Sequence

1. Build F1, then F2 and F3, which need no new UI beyond a data source item in the evidence drawer.
   In parallel, mock F4 and F5 together, the F6 trend view on real series, and the data source item in the drawer; stop for picks.
2. Build the picked F4, F5 and F6 and the drawer item.
3. F7.
4. Update `poc-plan.md`, `ui-ux.md` and the E2E walkthrough: a series backfill and fetch against cached responses, a detector firing into a development and an alert, a unit check on a per-100 quote, a past-date run with no look-ahead, and the indicator widget added from the gallery.

## Open questions

- Thresholds for each detector, to agree with pilot analysts.
- Whether to subscribe to the MAS SORA API and use the HKMA open API for rates, closing the policy-rate gaps.
- How far back to backfill runs for the answer-state strip; series need no backfill, but question states only exist for computed runs.
