# Exposure alerts: India property news → UOB

The feature: adverse news in a market a bank is exposed to (e.g. Indian property) alerts the bank's supervisor that the bank may be affected, even when the article never names the bank.
It needs four things: the news must come in, the system must see it is about a market, it must know which banks are exposed and by how much, and it must tell the right person in a way they can check.
Today the first two half work and the last two do not exist.

## 1. Exposure data (the hard part)

- What: per bank, exposure by country, sector or market, e.g. "UOB: India, share of loans, value, as-of date, source page".
- Public sources: quarterly results decks, Pillar 3 disclosures, annual reports.
  They are quarterly at most and coarse.
  UOB already discloses its Greater China and US CRE exposure.
- Internal supervisory returns would be better and more frequent, if MAS gives the POC access.
- Keep it current by storing it as a time series, like the indicator series already in the pipeline.
  - Each run checks whether the bank has published a new disclosure.
  - An extraction step reads the segment table and saves the new value with a verified quote; a person approves it.
  - Each run uses the latest value dated on or before the run date, so backfills do not look ahead.
  - A change in exposure becomes a development through a detector rule (e.g. "UOB India exposure up 2pp").
  - News such as "UOB sells India unit" flags that the exposure needs updating.

## 2. Getting the news in

- Add each exposure market as a subject, e.g. `india-property` in `api/seed/subjects.yaml` with keywords.
  `news_queries` (`api/intelmonitor/ingest/sources/search.py`) then searches for it automatically.
- Add Indian outlets (e.g. Economic Times, Mint, Business Standard) to `NEWS_DOMAINS`, which limits search to 21 domains today.
- Check each new outlet's dates, as The Edge Malaysia needed; add a `PAGE_DATES` entry if its search-API dates are unreliable.

## 3. Linking the news to UOB

- Screening and tagging: no new code.
  Screening loops over every subject, so India property articles get tagged `india-property` and become developments with materiality levels as usual.
- Exposure edges: extend the graph's exposure link (`EXPOSED_TO` in `api/intelmonitor/pipeline/graph.py`) from group → topic to entity → market, carrying the weight from section 1.
- Propagation: a new step after materiality.
  A development on a market reaches each exposed bank with a score of roughly materiality × exposure weight.
  Store indirect links separately from direct tags, so the app can say "via India exposure" and never confuse them with news actually about UOB.
- Answer step: a new bank question in `api/seed/questions.yaml`, e.g. "Which markets this bank is exposed to moved adversely, and what does it mean for the bank?"
  Its inputs are developments on linked markets plus the exposure values, passed as facts so the existing number check covers them.

## 4. Telling the supervisor

- Alert rule: fire when an indirect development is Notable or above and the exposure weight is above a threshold.
  It goes to people following UOB, through the existing alerts popover (`api/intelmonitor/server/alerts.py`).
- Monitor page: a "Via exposure" section on UOB's page, showing the path, the exposure size and its source, and the evidence.
- A scheduler: runs only happen on Run now today, so an alert cannot be timely without one.

## 5. Making it general, not just India

Supervisors will ask for other links too: peers, cloud vendors, counterparties, funding markets.

- Watch items, an extension of custom questions.
  A supervisor types a concern in plain language, and Claude drafts search queries and a match test.
  The match test runs over the whole window; `candidates` in `api/intelmonitor/pipeline/custom.py` limits it to documents tagged to the subject today.
  The drafted queries are added to ingest, so the documents actually arrive.
- Generated items: each bank's top exposure markets and its peer group automatically become watch items, refreshed when the exposure data updates.
- Runs stay deterministic, cached and evaluable; the flexibility is at setup, when Claude turns a concern into queries, a match test and links.
  A per-run search agent is only worth building if fixed queries miss too much, which the eval can measure.
- If an agent is used, it searches the ingested corpus first and the web only for gaps; anything found on the web is ingested and verified before it can be cited.

## 6. Proving it works

- Eval phase A (2026-10-05) gives the baseline: V1 and V2 both found 0 of 3 relevant developments on the UOB exposure question (HKMA rate rise and Hong Kong property, China's credit slump, tightening ASEAN funding), although the corpus had them.
  V2's custom path saw only the 7 documents tagged to UOB.
- Keep that question in the eval set and score recall on exposure links before and after the feature.

## Order of work

1. Source exposure data for DBS, OCBC and UOB from their latest results and Pillar 3 disclosures. This is the slowest step and blocks the rest.
2. Small wins: add the market subjects and outlets, and a Peers section on the entity page.
3. Core build: exposure edges and propagation, the bank exposure question, the "Via exposure" section.
4. Timeliness and alerts: the alert rule and the scheduler.
5. Generalise: watch items over the whole corpus.
6. Measure: re-run the exposure question in the eval.

The code is moderate work that fits the current architecture.
The real dependency is exposure data that is trustworthy and current.
