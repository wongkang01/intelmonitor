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

Built (store and collection; the two endpoints come next):

- The five tables are in `api/intelmonitor/store/db.py` and `connect()` creates them in existing stores.
  `run_indicators` stays empty until runs compute indicators.
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
  (7) The per-100 conversion was checked against FRED cross rates: SGD per MYR on 18 Sep 2026 is 0.3128 from MAS and 0.3132 from `DEXSIUS / DEXMAUS`, SGD per THB 0.038342 and 0.038294; the E2E unit check comes with the API.
  (8) `CachedHttp` already retries 429 and never caches it.
  (9) `read_observations` with `as_of`.
- `data/intelmonitor.db` holds the real backfill from 2021-07-01: 55,890 observations.

### F2. Facts in standing answers

A new pipeline step computes a facts block per subject from its series as of the run date, for example "USDC stayed within 0.2% of its peg all week; its lowest was 0.9981 on 12 Sep".
The answer prompt receives the block and may only quote numbers from it or from developments.
Question-to-series links are declared in `questions.yaml` (for example `issuer.peg` uses the peg series, `bank.financial` the loan-to-deposit and NPL series, `country.economic-policy` the FX series).
Some states follow fixed rules instead of model judgement, declared per question: a coin more than 0.5% off its peg for over 24 hours makes Peg "Needs attention".
Answers can cite a series; the evidence drawer shows it as a data source with a small chart, the latest value, and a link to the source table.

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
