# Phase A evaluation, cut down (2026-10-05)

Reproduce the scoring from cached calls only (it fails on any cache miss, so no model call can be made):

    cd "/Users/wk01/code/mas/intelmonitor dashboard/api" && uv run python -m intelmonitor.eval rescore

It rebuilds pools and gold, reruns the judge and rewrites `scores.json` and `scores.md` from the cached replies in `cache/`.
On 2026-10-05 it reproduced `scores.json` exactly, with zero model calls.
Variants rerun with `uv run python -m intelmonitor.eval v2|v1|v0`, also cached (V2 in `db/v2.db`, V1 and V0-C in `cache/`).

## Setup

- Corpus: `data/intelmonitor.db` copied to `db/corpus-frozen.db` (547 documents). V2 runs in its own copy, `db/v2.db`. Everything else reads the frozen copy.
- Dates: base run 2026-09-17, scored run 2026-09-24. Only 2026-09-24 answers are scored.
- Answer model `claude-sonnet-5-5` (V2 answer step, V1, V0-C). Gold and judge `claude-opus-5-5`.
- All Claude calls go through the Claude Agent SDK on the user's Claude login, as the pipeline does; the repo has no `ANTHROPIC_API_KEY`. Dollar figures are the SDK's API-equivalent `total_cost_usd`.

### Variants

- **V2**, the current pipeline. The model is in every call's cache key (`pipeline/inference.py`), so a global switch would recompute routing and extraction. The eval switches the setting only around the answer step (`eval/v2.py`, `answer_model()`); no pipeline code changed.
  Screen, extract, merge and materiality were replayed for both dates with `recorded_only=True`: 9,746 recorded calls, 0 live, and the rebuilt developments match the stored ones exactly (672 and 973).
  Answers ran for the 6 subjects on 2026-09-17, then 2026-09-24, so scored answers see Sonnet 5.5 base answers.
  The exposure question went through `pipeline/custom.py` (`draft_config`, `answer_run` on both dates): 14 live Jev `custom_match` calls.
- **V1** (`eval/v1.py`): FTS5 over title and text with the subject's name and aliases (members' for a group, keywords for a topic) inside the lookback, the top 30 by bm25 as title plus 2,500 characters, then one Sonnet 5.5 call returning state, summary and document citations with quotes.
  Same one-line, 25-word summary and state rules as V2. Scored date only (no diff). All 23 quotes were verbatim.
- **V0-C** (`eval/v0.py`): Sonnet 5.5 with the SDK's WebSearch and WebFetch tools, one prompt per question "as of 2026-09-24", state plus source links.
  15 of 22 cited pages were retrievable (403s, mostly Bloomberg); claims resting on unretrievable pages count as unsupported.

### Questions

| Id | Scope | Lookback | Covers |
|---|---|---|---|
| banking-regulation/topic.new-developments | topic | 7 | news flow |
| geopolitics/geopolitics.financial-channels | topic | 14 | series, numbers |
| singapore-banks/group.peer-moves | group | 30 | state |
| sea-regional-banks/group.common-issues | group | 7 | news flow |
| mas/central-bank.regulation | entity | 30 | state |
| ocbc/bank.incidents | entity | 7 | bank incident |
| uob/custom.exposure | entity, custom | 14 | known-gap exposure |

The custom path drafted the exposure question as "Which markets where UOB has significant lending exposure (such as Greater China commercial real estate and ASEAN) had adverse developments recently, and what might they mean for UOB?", 14 days.
V1, V0-C and the gold use that wording.
The corpus has such market documents in the window (FTS: 7 China and property, 4 Hong Kong and property, 3 commercial real estate, 16 Indonesia and bank or credit), so the question was kept.

### Silver gold (`gold/`)

1. Pool per question: documents any variant cites (V0 URLs where they are corpus documents), documents an Opus screen of the raw 30-day window (409 documents, title plus 800 characters, batches of 40, no pipeline tags) marks as about the subject, and the top 25 alias keyword hits. The exposure screen also labels adverse developments in UOB's lending markets. Shuffled, no provenance. Pools of 13 to 40.
2. One Opus pass per question (title plus 1,500 characters): in or out per document, events, must-mention events, expected state, each with a reason.
3. Series question: the code-computed facts listed by series id; Opus marked none of the 11 must-mention.
4. Change gold from event publication dates.
5. Independence check: the gold pass again, reshuffled, on two questions.

### Judge (`judge/judge.json`)

- Correctness: atomic claims checked against the cited sources' text (documents up to 12,000 characters plus windows around cited quotes, V2 series facts, V0 fetched pages). Absence claims are excluded from the share. Claims after 2026-09-24 count as unsupported.
- Coverage: per question, all three answers shuffled under letters against the gold must-mention list.
- State: exact match. Unsupported numbers: `unsupported_numbers` against full cited text, facts and quotes.
- Change (V2): eligible 2026-09-24 developments matched to gold events by shared documents. Precision: flagged matched developments whose gold event changed. Recall: changed gold events matched by a flagged development.

## Results

Correctness cells show the score and supported claims over claims; coverage cells show the score and how many developments the gold requires.

| Question | Variant | Correctness | Coverage | State (gold) | Unsupported numbers | Change P / R |
|---|---|---|---|---|---|---|
| banking-regulation/topic.new-developments | V0-C | 40 (2/5) | 0 (3 required) | miss: watch (new) | 0 |  |
| banking-regulation/topic.new-developments | V1 | 100 (5/5) | 33 (3 required) | ok: new (new) | 0 |  |
| banking-regulation/topic.new-developments | V2 | 100 (5/5) | 100 (3 required) | miss: watch (new) | 0 | 100 / 78 |
| geopolitics/geopolitics.financial-channels | V0-C | 75 (3/4) | 50 (2 required) | ok: watch (watch) | 0 |  |
| geopolitics/geopolitics.financial-channels | V1 | 75 (3/4) | 50 (2 required) | ok: watch (watch) | 0 |  |
| geopolitics/geopolitics.financial-channels | V2 | 100 (5/5) | 0 (2 required) | miss: needs_attention (watch) | 0 | 100 / 100 |
| singapore-banks/group.peer-moves | V0-C | 50 (1/2) | 0 (2 required) | ok: new (new) | 0 |  |
| singapore-banks/group.peer-moves | V1 | 100 (3/3) | 50 (2 required) | ok: new (new) | 0 |  |
| singapore-banks/group.peer-moves | V2 | 60 (3/5) | 50 (2 required) | ok: new (new) | 0 | n/a / n/a |
| sea-regional-banks/group.common-issues | V0-C | 0 (0/1) | 0 (2 required) | miss: stable (watch) | 0 |  |
| sea-regional-banks/group.common-issues | V1 | 50 (1/2) | 0 (2 required) | miss: new (watch) | 0 |  |
| sea-regional-banks/group.common-issues | V2 | 100 (3/3) | 0 (2 required) | ok: watch (watch) | 0 | 100 / 100 |
| mas/central-bank.regulation | V0-C | 75 (3/4) | 0 (2 required) | ok: new (new) | 0 |  |
| mas/central-bank.regulation | V1 | 100 (6/6) | 100 (2 required) | ok: new (new) | 0 |  |
| mas/central-bank.regulation | V2 | 100 (6/6) | 100 (2 required) | ok: new (new) | 0 | 100 / 100 |
| ocbc/bank.incidents | V0-C | 0 (0/1) | 0 (1 required) | miss: stable (needs_attention) | 0 |  |
| ocbc/bank.incidents | V1 | 67 (2/3) | 100 (1 required) | miss: watch (needs_attention) | 0 |  |
| ocbc/bank.incidents | V2 | 100 (2/2) | 100 (1 required) | ok: needs_attention (needs_attention) | 0 | 100 / 100 |
| uob/custom.exposure | V0-C | 0 (0/2) | 0 (3 required) | ok: watch (watch) | 0 |  |
| uob/custom.exposure | V1 | 100 (2/2) | 0 (3 required) | ok: watch (watch) | 0 |  |
| uob/custom.exposure | V2 | 100 (3/3) | 0 (3 required) | miss: new (watch) | 0 | 100 / 25 |

**Overall, 6 standing questions** (macro mean over questions; n/a items skipped)

| Variant | Correctness | Coverage | State accuracy | Unsupported numbers | Change P / R |
|---|---|---|---|---|---|
| V0-C | 40 | 8 | 50 | 0 | n/a |
| V1 | 82 | 56 | 67 | 0 | n/a |
| V2 | 93 | 58 | 67 | 0 | 100 / 96 |

**Overall, All 7 questions** (macro mean over questions; n/a items skipped)

| Variant | Correctness | Coverage | State accuracy | Unsupported numbers | Change P / R |
|---|---|---|---|---|---|
| V0-C | 34 | 7 | 57 | 0 | n/a |
| V1 | 85 | 48 | 71 | 0 | n/a |
| V2 | 94 | 50 | 57 | 0 | 100 / 84 |

### Cost and time

| Variant | Cost | Calls | Time |
|---|---|---|---|
| V2 | $2.44 ($2.37 answers, $0.07 custom) | 12 subject answer calls (each answers all of a subject's questions), 3 custom, 14 live Jev | 25 s replay, 240 s answers, 17 s custom, 282 s wall |
| V1 | $1.25 | 7 | 55 s of calls, 18 s wall |
| V0-C | $2.92 | 7 (8 to 22 turns each) | 472 s of calls, 166 s wall |
| Gold | $3.93 | 11 screen + 9 gold | |
| Judge | $2.43 | 21 correctness, 9 coverage, 5 recheck | |
| Total | about $13.1, including a $0.11 probe | | |

V2's cost is not per question: each subject call answers 6 to 8 questions.

### Exposure question

All three variants cover 0 of 3 must-mention developments (HKMA hike and Hong Kong property, China's credit slump, tightening ASEAN funding).
V2's custom path only sees documents tagged to UOB (7 candidates). It answered "no adverse market developments" with state `new`; gold is `watch`.
V1 has the same blind spot (UOB keywords) but said `watch`. V0-C said `watch`, citing pages the judge could not verify.
The gap comes from subject scoping, not from the corpus.

### Self-consistency

- Gold, reshuffled: banking regulation 29 documents, in/out 100% (kappa 1.0), must-mention 3/3 matched, state `new` vs `watch`. Singapore banks 32 documents, 96.9% (kappa 0.84), 2/2 matched, state agrees. State agreement 1 of 2.
- Judge, random 20%: correctness 17/18 claims (94%) over 5 answers; coverage 12/12 decisions on 2 questions.

## Caveats

- Silver gold: Opus, not an analyst, and from title plus opening only.
- n=7: one claim moves a question's correctness by 17 to 50 points and the mean by 3 to 8.
- Opus built the gold and judges coverage, so coverage may favour answers worded like Opus's event titles.
- The OCBC incident document quotes "CEO David Conner" (CEO until 2012); it is very likely a 2010 article misdated at ingest. The gold and V2 take it as a 2026 incident; V1's doubt was scored unsupported; V0's `stable` may be right. Excluding OCBC: V1 85 / 47, V2 92 / 50.
- The series question has no must-mention series, so it tests events only; V2 answered with series numbers and scored 0 coverage there.
- The gold is corpus-derived, so V0-C gets no credit for real events outside the corpus, and its correctness suffers from unfetchable pages.
- Correctness shows the judge the URLs or document headings, so it can tell V0 from the corpus variants.
- Change gold only sees documents in each window: on 7-day questions every gold event is new by construction. Informative cases: MAS and Singapore banks (1 change flagged correctly, unchanged events left alone) and geopolitics (50% of flags had the right kind). Recall misses (banking regulation 2 of 9) are events with no V2 development at all.
- Dollar costs are API-equivalent; calls ran on a Claude login.

## Reading against the decision rule (provisional)

The plan replaces V2 with V1 when V1 is within 5 points on correctness and coverage.
Here V1 is within 5 on coverage (56 vs 58) but 11 points behind on correctness (82 vs 93).
V1's misses: a bill called a law, a contradicted absence claim, and its OCBC doubt.
So the rule is not met on this run, but the gap is about three claims at n=7, and V1 matched V2's state accuracy at a fraction of the machinery.
Not decided; it needs the full 15-question set and an analyst-checked gold.

## Answers

### banking-regulation/topic.new-developments

Question: What material developments happened on this topic? Lookback 7 days. Gold state: new.

Gold must-mention:

- Swiss upper house voted to require UBS to back its foreign units with 90% CET1 capital, after the government and UBS clashed and business groups lobbied against it. (change gold: new)
- Fed Vice Chair Bowman outlined the final overhaul of the Fed's bank stress-testing and capital-setting framework, with changes coming soon. (change gold: new)
- Bowman released initial findings of an independent review of SVB's failure that criticise the Fed's own supervisory process. (change gold: new)

- V0-C (watch): MAS Financial Stability Review (22 Sep) found banks well-capitalised but ranked AI-driven cyber risk top concern; EBA finalised third-party risk guidelines; FCA opened AML probe into Euro Exchange Securities.
- V1 (new): BCBS's Basel III monitoring shows stable capital, Group 1 LCR 136.6%, NSFR 123.3%; Fed's Bowman flags final stress-test revisions soon; UBS capital dispute with Swiss minister continues.
- V2 (watch): Swiss upper house backed 90% CET1 cover for UBS foreign units; Fed flagged stress-test and capital finalisation; SVB review faulted Fed supervisors; Singapore published national AML strategy.

### geopolitics/geopolitics.financial-channels

Question: Are there effects on capital flows, FX, payments or trade finance? Lookback 14 days. Gold state: watch.

Gold must-mention:

- PBOC guided the yuan stronger with five straight firmer fixings and an eased appreciation curb, lifting it to a 3.5-year high against the dollar ahead of the Sept 24 Trump-Xi summit. (change gold: updated)
- US filed to forfeit $61m in crypto it says came from Iranian oil sales to Chinese buyers, laundered by Chinese firms through Binance as part of a network moving over $1.5bn. (change gold: unchanged)

- V0-C (watch): US Treasury's Iran sanctions campaign threatens mid-tier Chinese banks; China tightened outbound capital rules; PBOC steadied the yuan before the 24 September Trump-Xi summit.
- V1 (watch): US seeks $61 million crypto forfeiture over Chinese-linked Iran oil payments; new Russia sanctions law threatens tariffs up to 100% on top buyers.
- V2 (needs_attention): US 10-year 5.11%, series high; VIX 14.21; SGD weakened 0.23% against the USD and 0.26% against the CNY on the week.

### singapore-banks/group.peer-moves

Question: Did any member make a move its peers are likely to follow? Lookback 30 days. Gold state: new.

Gold must-mention:

- DBS expanded its gold vaulting capacity for wealth and institutional clients, and OCBC has approached storage providers to secure more space. (change gold: unchanged)
- DBS and Citi completed the first weekend cross-border USD payment using tokenised deposits on Swift's Digital Ledger. (change gold: unchanged)

- V0-C (new): DBS, OCBC and UOB jointly completed first live SGD tokenised-deposit interbank transactions on Swift's ledger on 10 Sep; no unilateral move peers must follow found.
- V1 (new): DBS expanded gold vaulting capacity this year; OCBC has approached storage providers for more space, and other banks are considering similar moves, per Bloomberg.
- V2 (new): DBS's wealth push (S$1 trillion AUM target, 18 new centres) and tokenised deposits may draw followers; OCBC is already chasing bullion storage after DBS's gold vaulting.

### sea-regional-banks/group.common-issues

Question: Is the same issue showing up at several members? Lookback 7 days. Gold state: watch.

Gold must-mention:

- Rising Malaysian government bond yields and stronger deposit competition are expected to compress NIMs and weaken upcoming earnings across Malaysian banks, including Maybank and CIMB. (change gold: new)
- CIMB expects a small uptick in gross impaired loans, mainly in the commercial segment, if the Middle East conflict keeps pushing up costs. (change gold: new)

- V0-C (stable): No common adverse issue found across Maybank, CIMB and Bangkok Bank for 17–24 Sep 2026; Thai flood relief measures came after the window.
- V1 (new): Only a routine overlap: BNM onboarded both Maybank and CIMB to test tokenised deposits for payments. No shared adverse issue is evident; Bangkok Bank isn't involved.
- V2 (watch): Tradeview flagged CIMB and Maybank for third-quarter fair-value losses; both are also Indonesia foreign-cap beneficiaries and joined BNM's tokenised-deposit trial. Bangkok Bank absent.

### mas/central-bank.regulation

Question: Any new rules, consultations or guidance for banks? Lookback 30 days. Gold state: new.

Gold must-mention:

- MAS amended bank Notices 643 (related-party transactions), 643A (exposures to related concerns) and 656 (single counterparty group limits) on 4 Sep 2026, effective 4 Sep 2027. (change gold: unchanged)
- A bill giving MAS power to impose minimum TLAC requirements on systemically important financial institutions had its first reading in Parliament on 8 Sep. (change gold: unchanged)

- V0-C (new): MAS opened a stablecoin consultation on 1 Sept (closes 16 Oct) with clarifications for banks; its bank corporate governance paper came 30 Sept, outside the period.
- V1 (new): MAS issued revised Notices 656, 643 and 643A for banks on 4 Sep, opened a stablecoin consultation (closes 16 Oct), and the Bill introduced TLAC powers.
- V2 (new): MAS issued draft AI Risk Management Guidelines, stablecoin consultation P015-2026 (closes 16 October 2026), a TLAC bill, Notice 643A amendment and a national AML strategy.

### ocbc/bank.incidents

Question: Have any material operational or technology incidents occurred? Lookback 7 days. Gold state: needs_attention.

Gold must-mention:

- OCBC suffered a disruption of its ATM, internet and mobile banking services, and the CEO stated that all customer data remained protected. (change gold: new)

- V0-C (stable): No material OCBC operational or technology incidents found for 17–24 September 2026; only routine scheduled iOCBC maintenance notices (26–27 September) surfaced, with no reported outages, breaches or MAS action.
- V1 (watch): An article dated Sept 23 reports an OCBC ATM, internet and mobile banking disruption with data protected. Its CEO quote looks dated, and nothing corroborates it.
- V2 (needs_attention): OCBC's ATM, Internet and mobile banking services were disrupted on 23 September; CEO David Conner said all customer data remained protected.

### uob/custom.exposure

Question: Which markets where UOB has significant lending exposure (such as Greater China commercial real estate and ASEAN) had adverse developments recently, and what might they mean for UOB? Lookback 14 days. Gold state: watch.

Gold must-mention:

- The HKMA raised its base rate 25bp to 4.25%, its first hike since 2023, which threatens Hong Kong's nascent property recovery. (change gold: unchanged)
- China's credit growth slumped far more than expected in August, and the PBOC governor signalled the end of the era of surging loans. (change gold: unchanged)
- Funding is tightening in key ASEAN markets: Indonesian interbank rates and LDRs are rising, and in Malaysia higher government bond yields and credit tightening are pressuring bank margins and loan growth. (change gold: new)

- V0-C (watch): Little new UOB-specific adverse news 10–24 Sep: Indonesia's rupiah and capital outflows pressure ASEAN credit; Jefferies' 23 Sep initiation flags Greater China CRE asset quality. Unverified snippets.
- V1 (watch): No fresh Greater China CRE or ASEAN shock; Macquarie upgraded UOB citing CRE provision buffer, while UOBKH flags Middle East conflict risk to loan growth.
- V2 (new): Since 10 Sep, no adverse market developments reported; Macquarie upgraded UOB on 16 Sep after CRE review, estimating $181m extra provisions per 10% collateral drop.

