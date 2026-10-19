# Phase 1 plan: meeting the PRD

This plan takes the POC to the Phase 1 scope in `prd.md`.
`prd.md` says what to build and how to judge it; this plan says how, in what order, and who owns which files.
Where this plan and `docs/archive/iteration-plan.md` or `docs/archive/exposure-alerts-plan.md` disagree, this plan wins.

It is written to be run as a workflow.
Each work item in section 6 has an id, its dependencies, the files it owns, its steps, and checks that decide when it is done.
Items in the same wave own disjoint files and can run in parallel.
Steps marked **GATE** stop for the user: the workflow reports and waits.

Milestones:
- **M0**, ready for the testing sessions: waves 1 to 5. FMD session Monday 12 October; TCRD session date to confirm (Q8).
- **M1**, after the sessions: section 7.

## 1. Conventions every item follows

- Repo rules in `CLAUDE.md` and `~/.agents/AGENTS.md` apply. In particular: no unit tests written after the code; end-to-end checks through the `verify-intelmonitor` skill; static mocks before any non-trivial UI change, then wait for the user's pick.
- Python checks, from `api/`: `uv run ruff check`, `uv run ruff format --check`, `uv run pyright`.
- Web checks, from `web/`: `pnpm typecheck`, `pnpm lint`. After any API model change, `pnpm gen:api` first.
- Dev servers run behind Portless (`portless` skill).
- Every model call goes through `Inference` (`pipeline/inference.py`) so it is cached and replayable. A new stage gets its own stage name.
- Interface copy: plain words, no em dashes, no internal terms (`prd.md` section 12).
- Markdown docs: one sentence per line.
- Never commit `.env`. Do not commit unless the user asks.

## 2. Constraints for this POC

- Hosting stays on the personal Railway plan (`scripts/deploy.sh`).
- Model calls run through `claude -p` on the Claude subscription, and Jev through OpenRouter.
  Every Claude stage (extraction, impact, notes, the uncertain screening band) uses Claude Sonnet 5.5 (`claude-sonnet-5-5`), the default in `config.py` and `.env`; summaries already pin it. The eval keeps Claude Opus 5.5 as its judge.
  The Claude cache key includes the model, so the switch re-runs every Claude call once; item A's re-extraction absorbs that.
- No scheduled runs. One or two full ingests before the sessions, each followed by `im run --both`, so the New and Updated markers have a previous run to compare with. Run the last ingest close to the sessions: X search reaches back only 7 days.
- No identity provider. The user picks a department and role, and that choice stands in for identity.
- A narrow subject set (item S): only what the test users are likely to care about, plus the targets the relationships point at.
- Screening's cache key includes every subject question, so any change to the subject list re-screens the whole corpus. Settle the subject list in item S before the first ingest, and change it once.
- The Data tab and its structured data stay. The Trend tab goes.

## 3. Inputs already in hand

| Input | Where | What it holds |
|---|---|---|
| Bank exposures | `api/seed/collected/bank-exposures.yaml` | 184 figures for DBS, OCBC and UOB, period ending 30 June 2026: loans and NPLs by geography and industry, loans by currency, specific disclosures, Pillar 3 risk-weighted assets by country. Each with source, page and verbatim quote. 13 listed gaps |
| Tech and payment dependencies | `api/seed/collected/tech-dependencies.yaml` | 311 relationships: complete MEPS+, FAST, PayNow, GIRO, eGIRO, NETS and SWIFT participant lists; 36 vendor dependencies; cloud regions; 6 incidents kept as evidence; 75 new endpoint entities |
| Group structure | `api/seed/collected/entity-links.yaml` | 88 relationships (ownership, subsidiaries, operating countries, supervisors, shareholders, listings) and 11 named groups (Partior, the MAS-ABS cyber taskforce, COSMIC, Project Guardian and others); 54 new endpoint entities |
| Market figures | `api/seed/collected/market-figures.yaml` | 37 series, 304 observations: SGX and HKEX monthly statistics, MAS asset management survey, EQDP placements, FX turnover, bond data; 9 Yahoo tickers |
| Subject proposals | The TCRD and FMD research YAML, summarised in item S | Topics, entities, groups and entity kinds |
| Keys | `.env` | `X_BEARER_TOKEN`, `SERPAPI_API_KEY`, plus the existing Exa, Tavily, OpenRouter and MAS keys |

Known data issues the loader must handle:
- Mainland China is `china` in `entity-links.yaml` and `mainland-china` in `bank-exposures.yaml`. Use `mainland-china`.
- `bank-exposures.yaml` mixes a currency bucket (`us-dollar`) and residual buckets (`rest-of-world`, `ccyb-others`, `other-asia-pacific`) with countries. None of these become relationship targets.
- Chart readings are marked in the files (UOB's US and Greater China figures, the asset management survey's earlier years). Keep the mark through to the evidence shown in the app.

## 4. PRD requirements and the items that meet them

| PRD requirement (section 7 and 8) | Today | Work item |
|---|---|---|
| Entity and topic monitoring | 30 subjects, group-level only | S |
| Priority labels, High, Medium, Low, per entity; promotional news Low | One global materiality score; 20% of developments in the top tier | A, U1 |
| Adverse flag and tone, by the section 8 definition | Document-level score, not shown | A, U1 |
| News, analyst and official sources | 21 news domains, official feeds | S (domains); analyst sources in M1 |
| Citations and evidence | Verified quotes, evidence drawer | Unchanged |
| Typed relationships, as small snippets backing a claim | Three edge types, no snippets | R, I, U2 |
| Why this matters, per affected entity | None | I, U1 |
| Entity brief at the top of the overview (journey steps 1 and 4; `prd.md` section 12, Summary) | A 60-word paragraph stitched from focus-area answers, read as a list of state changes | B, U2 |
| Indirect impact through stored relationships (USP point 2) | None | R, I, U1, U2 |
| Shared relationships as evidence | None | I, U2 |
| Development clustering | Same-event merge | Unchanged |
| Social media after news (Should) | None | X |
| Default dashboard by role (Should) | `profile.role` unused | U3 |
| Daily, weekly, monthly filters (Should) | `days` filter | U1 |
| Evaluation set (Should) | Phase A eval | A, I |
| Frequency of use (outcome) | No identity | U3 |
| Simplified prototype (section 12) | Many labels and widgets | P, U4 |

## 5. Target pipeline

Current run order (`pipeline/run.py`): detectors, screen, extract, merge, materiality, upcoming dates, indicators, standing answers, notes, summaries, diff, graph.

Phase 1 run order:

1. Sync the relationship store from `api/seed/relationships.yaml` (new, item R).
2. Detectors. Unchanged.
3. Screen (Jev): relevance and subject recall. Unchanged; it stays recall-oriented.
4. Extract (Claude): findings with quotes, plus per finding and subject: role (affected, actor, commentator, mentioned), adverse to this subject, promotional (item A).
5. Merge into developments. Unchanged.
6. Priority (Jev): per development and affected or acting entity, on the five materiality levels, shown as High, Medium, Low (item A).
7. Impact (Claude, new): indirect impact over the relationship store (item I).
8. Upcoming dates. Unchanged.
9. Indicators and notes on why series moved, for the Data tab. Notes stop reading focus-area answers (item B).
10. Diff. Unchanged.
11. Brief (Claude): one structured brief per subject, built from its developments, indirect impacts, detector events and upcoming dates (item B). Replaces the summary built from focus-area answers.
12. Graph: typed edges from direct roles, indirect impacts and the relationship store (item I).

Standing answers and custom questions stop running (item P).

### Stages and features to stop

Stop these and hide their UI.
Keep the code until the sessions confirm nobody misses them (D3).

| Stage or feature | Why it goes | What else changes |
|---|---|---|
| Trend tab | Its value was unclear in the POC review, and the Data tab keeps the structured data | Series, detectors, indicators and notes keep running for the Data tab |
| Run facts for answers | Only standing answers use them | |
| Standing questions and answers (`answers.py`, `questions.yaml`) | The PRD journey is a priority feed with "why this matters", not a grid of question widgets. The Adverse answer produced the DBS example. Category questions duplicate the category filter | Monitor overview becomes summary, priority feed and impact |
| Custom questions | Not in the PRD | |
| Generate dashboard agent, widget grid editing | Customisable layout is a Could have | Default dashboards come from onboarding instead |
| Full graph and Connections tab | Could have; unreadable for first-time users | Replaced by graph snippets in the development view and entity page. The full graph page stays reachable by link for the TCRD session only |
| User notes on developments and entity pages | Close to case management, a Won't have | Pipeline notes on why series moved stay, for the Data tab |
| Mark reviewed and the flag action | Infrequent users will not remember to mark pages reviewed; follow-up flags are a Won't have | The Orient step uses "new since your last visit", tracked automatically. Opening a development marks it read. Dismiss stays |
| Following and the alerts bell | The dashboard is the one way to choose what to monitor; the bell repeats the dashboard feed | |
| Runs popover and Run now | Developer controls | The top bar shows "Updated" with the date of the latest news |
| Direction of travel widget | A weekly count of developments that users cannot read | |
| Indicator widget on dashboards | A third meaning of status, and cut-off titles | The numbers stay on the Data tab |
| First-run tour | Sessions test the app with no explanation | Revisit after testing |

## 6. Work items for M0

### Wave 1: classification, subjects (parallel)

**A. Extraction roles, adverse and priority.**
Depends on: nothing.
Owns: `api/intelmonitor/pipeline/extract.py`, `api/intelmonitor/pipeline/developments.py`, `api/intelmonitor/pipeline/params.py`, the `findings`, `developments` and `development_subjects` definitions in `api/intelmonitor/store/db.py`, `api/intelmonitor/eval/`.
Steps:
1. Extend the extraction schema: for each subject on a finding, `role` (affected, actor, commentator, mentioned), `adverse` (yes or no, by `prd.md` section 8), and per finding `promotional` (yes or no). Store them on the finding.
   Adverse marks the cause of harm to the subject: an event at it (outage, fraud, penalty) or a harmful trend or rule that bears directly on it (scams against its customers rising, higher capital requirements).
   Commentary, forecasts, market reactions and follow-ups that add no new harm are never adverse, even when negative in tone.
   Code keeps adverse false for a commentator or a mentioned subject.
2. A development's subjects in `development_subjects` are only those with role affected or actor on at least one finding. Keep commentator and mentioned links in a separate column or table; they never drive a page, priority or impact.
3. Remove the document-level `adverse` and `direction` from everything after extraction. A development's adverse flag is per subject, from its findings.
4. Score priority per development and subject (affected or actor only) with Jev, on the five materiality levels. The rubric includes relevance to that subject, Singapore relevance, and the adverse flag. Promotional developments are capped at Minor. Keep `materiality_level` as the maximum over subjects, for code that still reads it.
5. Add gold cases to the eval: the three DBS findings from section 9 as negatives for DBS adverse; the Swiss UBS capital vote as not High for Singapore banks; six short articles run through the extraction prompt for the adverse definition (`eval/adverse_cases.py`).
Done when:
- The checks in section 1 pass.
- The six adverse cases pass (`uv run python -m intelmonitor.eval adverse`): DBS digital banking down, phishing scams against DBS customers doubling and higher MAS capital requirements for the D-SIBs are adverse; DBS economists' growth outlook (DBS a commentator, and not adverse for Singapore either), DBS shares falling after an outage and a 9% profit rise are not.
- A re-run over the existing corpus (`im run --both`, screening cached) shows: nothing adverse to DBS in the week of section 9; the market-wrap share move at Low; the UBS vote not High on the Singapore banks group; known incidents still adverse, such as the 21 August 2026 disruption to DBS digital payments.
- High (Significant or Critical) covers under 10% of developments in the latest run, against 20% today.

**S. Subjects, entity kinds and sources.**
Depends on: nothing.
Owns: `api/seed/subjects.yaml`, the `EntityKind` and `TopicIcon` literals in `api/intelmonitor/seed.py`, `api/intelmonitor/pipeline/subjects.py`, `api/intelmonitor/ingest/sources/search.py`, `api/intelmonitor/ingest/sources/official.py`, `web/components/ui/SubjectIcon.tsx`.
Steps:
1. Add entity kinds `tech_provider`, `market_infrastructure`, `payment_system`, `asset_manager`, `insurer`, `agency`, `regulator` and `sector`, each with a `_KIND_LABEL`. Add the topic icons the new topics use.
2. Set the subject list. Keep: DBS, OCBC, UOB, the Singapore banks group, MAS, HKMA, BNM, Singapore, Malaysia, Indonesia, Thailand, Vietnam. Park (remove from the seed, keep in git history): the other central banks, stablecoin issuers, the SEA regional banks, the Philippines, and the stablecoins and geopolitics topics unless a session needs them. Add:
   - Session subjects. TCRD topics: IT outages, Cyber threats, Third-party and cloud risk, Technology risk regulation. FMD topics: Singapore equities market, Asset management, Fixed income and FX, and one of Insurance and risk financing or Infrastructure finance (Q7). FMD entities: SGX, HKEX.
   - Relationship targets, so news about them is searched for and tagged: Hong Kong, Mainland China, Taiwan, India, United Kingdom, Australia, South Korea (countries); real estate and construction, housing (sectors); MEPS+, FAST, PayNow, GIRO, NETS, BCS, SWIFT, Visa, Mastercard (payment systems); AWS, Microsoft Azure, Google Cloud, Oracle Cloud, Equinix, CrowdStrike, Singtel, Thought Machine, Toppan Next Tech (vendors); OJK, Bank of Thailand (regulators).
   - Each with aliases and keywords. Take topic `covers` text and aliases from the research YAML.
   Participant banks, e-wallets and subsidiaries from the collected files stay as relationship endpoints, not subjects.
3. Add the research's news domains to `NEWS_DOMAINS` and the cloud providers' status pages to official sources. Check each new outlet's dates, as The Edge Malaysia needed, and add a `PAGE_DATES` entry where search-API dates are wrong.
Done when:
- The checks in section 1 pass, and `im serve` starts with the new seed.
- Every relationship target listed above is a subject id.
- **GATE**: the user confirms the final subject list before the first ingest, since changing it later re-screens everything.

### Wave 2: relationship store, manual series, social ingest (parallel)

**R. Relationship store.**
Depends on: S (subject ids).
Owns: new `scripts/build_relationships.py`, new `api/seed/relationships.yaml` (generated), new `api/intelmonitor/relationships.py`.
Steps:
1. `scripts/build_relationships.py` reads the three relationship files in `api/seed/collected/` and writes `api/seed/relationships.yaml`:
   - one schema for every relationship: `id`, `from`, `to`, `type` (`exposed_to`, `depends_on`, `participates_in`, `owns`, `subsidiary_of`, `operates_in`, `supervised_by`, `shareholder_of`, `member_of`, `listed_on`), `weight` (share of the bank's loans for exposures, ownership share, else null), `measure` and `value` and `unit` for exposures, `evidence` (public, reported, assumed, plus `chart_reading` where marked), `as_of`, `last_confirmed`, `source_url`, `source_title`, `quote`, `detail`;
   - exposures: one `exposed_to` relationship per bank and target, from gross customer loans by geography or industry; where a bank only gives a region (Greater China, South and Southeast Asia), link to the region and list its member countries on the region entity; Pillar 3 risk-weighted assets and loans by currency attach to the same relationship as extra figures, not as separate links;
   - named groups become `member_of` relationships to a group endpoint;
   - normalise ids (`china` to `mainland-china`), drop currency and residual buckets as targets, and merge endpoint entities declared in both files;
   - an `endpoints` section for every non-subject id, with name and kind.
2. `api/intelmonitor/relationships.py`: pydantic models, `load_relationships()`, a check that every `from` and `to` is a subject or an endpoint, `sync_relationships(conn)` that writes a `relationships` table (its DDL lives in this module), and `paths_to(target_id)` that returns every tracked subject reachable by one relationship, or two where the first hop is `participates_in`, `depends_on` or `subsidiary_of` (so BCS reaches each FAST bank through FAST, and Malaysia reaches OCBC through OCBC Malaysia).
3. Expose two queries for item I: `candidates(target_ids)` and `shared(a, b)`, the endpoints linked to both of two subjects.
Done when:
- `uv run python scripts/build_relationships.py` is deterministic: a second run produces no diff.
- Loading reports zero unknown endpoints.
- Spot checks pass: `candidates(["hong-kong"])` returns DBS, OCBC and UOB with weights; `candidates(["bcs"])` returns every FAST bank that is a subject; `shared("dbs", "ocbc")` includes NETS, the MAS-ABS taskforce, COSMIC and Project Guardian.

**M. Manual series for the Data tab.**
Depends on: S.
Owns: `api/seed/series.yaml`, the series source models in `api/intelmonitor/seed.py` (after S has merged), new `api/intelmonitor/ingest/series/manual.py`, `api/intelmonitor/ingest/series/collect.py`.
Steps:
1. Add a `manual` series source that reads observations from `api/seed/collected/market-figures.yaml`, keeping each observation's source URL.
2. Add the 37 market series to `series.yaml`, tied to SGX, HKEX and the FMD topics, and the STI and Hang Seng tickers as Yahoo series.
3. Park the series whose subjects item S removed.
Done when: `im series fetch` loads the manual series, and the FMD subjects' Data tabs show them with their sources (checked with `verify-intelmonitor`).

**X. Social media and search trends.**
Depends on: S.
Owns: new `api/intelmonitor/ingest/sources/social.py`, new `api/intelmonitor/ingest/sources/trends.py`, `api/intelmonitor/config.py`, `api/intelmonitor/ingest/run.py`, the new `trends` table in `api/intelmonitor/store/db.py`.
Steps (detail in section 8):
1. X recent search: last 7 days per subject, stored in a `social` collection with timestamps and engagement counts. X trends for Singapore as a snapshot.
2. Forums and Reddit through Tavily and Exa with `include_domains`, into the same collection.
3. SerpApi Google Trends: 7-day trending by geo and business category, and interest over time per subject, into the `trends` table.
4. Social documents go through screening, extraction and merging like news. They carry an "unverified" label until a news or official source in the same development confirms them.
Done when: an ingest adds social documents and trend rows; at least one DBS outage development shows both a news source and a social source; the X spend shown in the developer console stays inside the free credit.

### Wave 3: impact, the brief and the run order

**I. Impact step, graph and shared relationships.**
Depends on: A, S, R.
Owns: new `api/intelmonitor/pipeline/impact.py`, `api/intelmonitor/pipeline/run.py`, `api/intelmonitor/pipeline/graph.py`, the `development_impacts` table in `api/intelmonitor/store/db.py`, `api/intelmonitor/server/graph.py`, the impact and shared-relationship endpoints and models in `api/intelmonitor/server/app.py` and `api/intelmonitor/server/models.py`.
Steps:
1. In `run.py`: call `sync_relationships` first; add the impact stage after priority; stop calling standing answers and custom questions (item P's pipeline part).
2. Impact, for each development at Medium or above:
   - targets: the development's affected or acting subjects;
   - candidates: `candidates(targets)`, less the targets themselves; an `exposed_to` link counts only at a weight of 5% or more, and links graded `assumed` never count;
   - one Claude call per development with the development's findings and each candidate's route and relationship evidence; per candidate it returns `affected` (yes or no), `direction` (negative, positive, mixed), `route` (plain words, such as "via its Hong Kong loans, 12.2% of total"), `why` (one or two sentences citing the finding), and `confidence`;
   - store affected candidates in `development_impacts` with the relationship ids, apart from `development_subjects`.
3. Graph: build edges from the relationship store with their types, plus `AFFECTS` (direct) and `IMPACTS` (indirect, with the route), each with a plain label.
4. API: a development returns its direct subjects and its indirect impacts with route, why, relationship evidence grade, source and `last_confirmed`; a subject returns its indirect impacts for the period; `GET /shared?a=&b=` returns the shared endpoints with each link's type and source.
5. Eval: add cases for a BCS or FAST outage reaching the FAST banks, Hong Kong property news reaching DBS, OCBC and UOB in order of weight, and an Azure outage reaching Maybank only through its group-level deal, flagged as reported.
Done when:
- The checks in section 1 pass, and `pnpm gen:api` regenerates the client.
- On a full run: the DBS case in section 9 shows the US dollar rate sensitivity as an indirect impact; a Hong Kong property development lists the three banks with routes and weights; no indirect impact is shown as news about the entity itself.
- The impact stage's Claude calls per run are recorded in the run log and stay within the subscription limits.

**P. Stop the parked stages in the pipeline.**
Folded into I, step 1, since both edit `run.py`.
The UI side of P is in U4.

**B. Entity brief, and notes without focus areas.**
Depends on: A, I (runs after I in this wave, since both touch the server models).
Owns: `api/intelmonitor/pipeline/summaries.py`, `api/intelmonitor/pipeline/notes.py`, the `run_summaries` table in `api/intelmonitor/store/db.py`, the brief model and its field on the monitor page in `api/intelmonitor/server/models.py` and `api/intelmonitor/server/queries.py`, the brief cases in `api/intelmonitor/eval/`.
Keeps the `write_summaries` call signature in `run.py`, so I's ownership of `run.py` holds.

Why: today's summary is built from focus-area answers, which are already one-line summaries, and its prompt asks for what changed between runs. The result is a list of state changes in internal vocabulary ("Geographic exposure moved to Watch from Stable…") with no view of the entity's situation. Focus areas also stop running in Phase 1 (D1), which removes its main input and its direction count.

Steps:
1. Inputs, from the evidence rather than from other summaries:
   - the subject's developments in the last 7 days, plus older ones updated in that window: full finding statements, priority for this subject, adverse flag and tone, new or updated; only subjects with role affected or actor (item A);
   - its indirect impacts with route and evidence grade (item I);
   - detector events on its series, and the Data tab note's headline;
   - its upcoming dates;
   - the previous run's brief, so the brief continues rather than restarts.
2. One Claude call per subject (Sonnet 5.5, effort high) returning structured output:
   - `bottom_line`: one sentence on the entity's situation now;
   - `direction`: worse, better, unchanged or mixed against the previous run, with a one-line `direction_reason`;
   - `points`: at most 3, each a topic rather than a single development, with `claim`, `why_it_matters` for this entity, and `development_ids`;
   - `indirect`: at most 2 indirect impacts worth reading, by development id;
   - `coming_up`: dated upcoming items, by upcoming date id.
3. Prompt rules:
   - write as an analyst briefing a supervisor: the entity's state first, a change only when it changes that state;
   - selecting is the job: leave out what does not move the assessment;
   - on a quiet week, say so and give context ("No material developments since 30 Sep; the last notable item was the 19 Mar outage");
   - for topics and for development staff, opportunities count as well as threats (`prd.md` section 8);
   - no status vocabulary (Watch, Needs attention, focus areas, runs), no dashes, numbers only as the inputs give them (keep the existing number and FX checks).
4. Code checks, with one retry: every cited id exists in the inputs; every number appears in the inputs; the direction agrees with the signals code computes (High adverse developments for the subject now against the previous run). If the model and code still disagree after the retry, store the brief with the direction flagged and show "unchanged".
5. Code adds the footer facts: developments in scope, High count, adverse count, date of the latest news. The model never counts.
6. Store the brief in `run_summaries` (new columns for the structured fields; keep `text` as the bottom line, for older readers) and return it on the monitor page.
7. `notes.py`: drop the "Focus areas in this run" context and the focus-area wording in the detector rule text.
8. Eval: a judged brief eval with Opus 5.5 as judge, on DBS, UOB, Singapore banks, AWS and one FMD topic: every claim supported by a cited development; the top High developments covered; the bottom line consistent with the points; nothing stale or about another entity. Run a few subjects on Opus 5.5 beside Sonnet 5.5 once, to see whether the difference shows.
Done when:
- The checks in section 1 pass, and `pnpm gen:api` regenerates the client.
- On a full run, the DBS brief for the week in section 9 does not lead with the economists' oil comment and does not call the week adverse for DBS; the UOB brief groups the commercial property items into one point.
- The brief eval passes on every listed subject, and no brief contains a status word or a focus-area name.

### Wave 4: interface

**GATE: mocks first.**
Build static mocks for U1 to U4 in `mocks/` (two or three distinct options where the layout is open), publish them with the html-communication skill, report the URL, and stop until the user picks.
The mocks use real data from the wave 3 run.

After the pick, U1 to U4 run in sequence, since they share components.
Each one's done-when is a `verify-intelmonitor` pass on the screens it changes, with screenshots kept.

**U1. Feed and development view.**
Owns: `web/components/developments/`, `web/components/shell/Evidence.tsx`, `web/components/monitor/SubjectDevelopments.tsx`, related API queries.
- One label per question: priority (High, Medium, Low), adverse flag and tone, New or Updated (`prd.md` section 12).
- Adverse and tone filters; Today, This week, This month presets on the date filter.
- Development view: direct subjects, then indirect impacts with route, why it matters, evidence grade and age, and a small graph snippet. Replaces "Tagged to" with its percentages and Wrong buttons.
- Social sources marked unverified.

**U2. Entity page.**
Owns: `web/components/monitor/` except the Data tab, `web/components/graph/`.
- Overview: the brief panel (item B) at the top: bottom line, direction in words, up to three points each linking to its developments, "Could also be affected", "Coming up" and the footer facts. Below it, the priority feed of direct developments and a "Could affect this entity" section of indirect impacts grouped by route (exposure, dependency, structure). Replaces `web/components/monitor/overview/RunSummary.tsx`.
- A "Shared with" snippet: pick a peer, see what links both, from `GET /shared`.
- Remove the Trend tab; keep the Data tab.

**U3. Onboarding, role and default dashboard.**
Owns: `web/components/shell/ProfileDialogs.tsx`, `web/components/shell/ProfileMenu.tsx`, `web/components/dashboard/NewDashboard.tsx`, the profile endpoints.
- First visit asks for a role: regulatory supervisor, technology and cyber risk supervisor, development staff, or other.
- Supervisors pick entities; development staff pick topics, sectors or entities; other gets MAS supervised entities. The choice creates the default dashboard.
- The role stands in for identity: log each visit with it, and let the user switch role from the profile menu.
- Preload one profile per session department.

**U4. Simplify the prototype.**
Owns: the remaining shell and dashboard components.
- Hide everything in section 5's "Stages and features to stop" table.
- The rest of `prd.md` section 12: no cut-off findings, plain words, the dashboard's single feed and watchlist.

### Wave 5: data and session preparation

**D. Ingest, run, check, deploy.**
Depends on: waves 1 to 4.
Steps:
1. **GATE**: confirm the subject list (item S) and Q7, Q8, Q11 are answered.
2. `im ingest`, close to the sessions. Keep the existing corpus; widen the window only if the preload examples (the 30 September Azure outage, the MAS-ABS cyber taskforce, the TRM consultation, the EQDP third batch, the Global Listing Board) are missing from the store.
3. `im run --both`.
4. Run the eval (`uv run python -m intelmonitor.eval`, gold and score) and compare with the phase A baseline in `eval-runs/`.
5. Walk both session scenarios end to end with `verify-intelmonitor` and keep the recordings.
6. Delete the test dashboards from the store ("test", "main test", "Verify P6 Build OCBC", and the two "... and 2 more").
7. Redeploy the Railway demo with `scripts/deploy.sh`.
Done when: both scenarios in `prd.md` section 11 can be completed in the deployed app without explanation, and the eval shows no regression against phase A.

## 7. M1: after the sessions

- **H. Local entity versus group.** A parent link so HSBC Singapore and HSBC group are separate subjects, and priority is judged for the local entity.
- **K. Analyst sources.** Depends on Q3. Their own collection, shown as "analyst view".
- **Relationship refresh.** A job that re-reads the structured sources on their own timetable (quarterly results, participant lists, annual reports), records `last_confirmed`, and diffs participant lists so a missing bank ends its link.
- **Relationship changes from news.** Extraction recognises "X starts or stops using Y" findings and proposes a relationship change for the user to approve. New incidents that name a bank and a vendor update `last_confirmed`.
- **Shelf life.** Links past their type's shelf life (about two years for vendor deals) are shown as unconfirmed and stop counting for impact.
- **D3.** Delete or keep the parked code, depending on the sessions.

## 8. Social media and trends, detail for item X

X is the main social source, because posts there come out faster than news.
- X API, pay-per-use: $0.005 per post read, $0.010 per trends call. The $20 sign-up credit covers the POC, about 2,000 reads for 20 subjects. Recent search reaches back 7 days.
  - At each ingest, pull the last 7 days of posts per subject, with timestamps and engagement counts.
  - Pull X trends for Singapore as a snapshot.
- Google Trends through SerpApi, free plan of 250 searches a month. Each ingest uses about 10:
  - trending searches over the past 7 days, filtered to business and finance, for SG and four regional geos (5 calls);
  - interest over time for each tracked subject, up to 5 terms per call (4 or 5 calls). This covers the weeks before the ingest, so a search spike during an incident shows even without scheduled runs. Values are relative within a call, so compare each term with its own baseline.
  - Flag trending items that match a tracked subject.
  - Fallback with no key: the Trends RSS feed, `https://trends.google.com.sg/trending/rss?geo=SG`, which only shows what is trending at fetch time.
- Lead time: for each development, compare the earliest X post with the earliest news article, and show it ("posts appeared 40 minutes before the first news report"). This is the evidence for the early-warning hypothesis in the TCRD session.

Forums and Reddit fill in where X is thin:
- Tavily with `include_domains` set to `reddit.com`, `x.com` and `forums.hardwarezone.com.sg`. Tested on 7 October 2026: "DBS outage" returned r/singapore and r/askSingapore threads on the March and July DBS disruptions and some X posts, but no publication dates and some unrelated X accounts.
- Exa with `includeDomains` set to `reddit.com` and `forums.hardwarezone.com.sg`. Tested the same day: dated HardwareZone threads, including an "is DBS digibank down" thread from 6 February 2026. Exa's `tweet` category is no longer supported.
- Optional: Reddit's own API, free at 100 requests a minute but no commercial use (Q1).
- One search per subject per platform at each ingest, so the volume stays small.
- Many forum threads repost a news article. Those merge into the existing development as reaction. A thread with no matching news, such as "is DBS down?", is early warning.
- Classify each post with Jev, as screening already does: about which subject, role, complaint or rumour or opinion, and tone toward that subject. Generic sentiment models (`cardiffnlp/twitter-roberta-base-sentiment-latest`, `ProsusAI/finbert`) score the whole post, which repeats the DBS mistake; use them only as a pre-filter if volume outgrows Jev.
- Spikes: count negative posts per subject per day as a series, and fire the existing detector engine's `move` rule with `sigmas` on it. One post is never an alert.
- Trending: rank subjects by post count and engagement in the last 7 days against their own earlier weeks, plus X trends and Google Trends. Without scheduled runs this is a snapshot, not a live alert.

## 9. The DBS acceptance case

On the 7-day DBS page, the Adverse answer read "DBS economists flag unresolved Middle East crisis risk to inflation/rates; DBS shares fell 0.18% to $76.86 despite 9% profit rise", state Watch.
After A, nothing adverse to DBS shows for that week.
The economists' comment is commentary, so DBS is at most a commentator and the comment is never adverse.
The share move is a market reaction, Low and not adverse, and the profit rise is not adverse.
Known incidents stay adverse, such as the 21 August 2026 disruption to DBS digital payments.
After I, the impact step finds the sourced line in the same Business Times article: DBS's US dollar book loses about S$4 million of annualised net interest income per basis point rise in US dollar rates, which the Fed hike makes relevant.

## 10. Decisions

- **D1. Standing questions and custom questions stop running.** Adopted; `prd.md` section 12.
- **D2. Five levels become three labels.** Adopted: High is Significant or Critical, Medium is Notable, Low is Minor or Trivial. Adverse stays a separate flag.
- **D3. Delete parked code after the sessions,** or keep it for a later economist persona. Open.
- **D4. Indirect impact is a Must have on real public data.** Adopted 7 October 2026; `prd.md` review item 15.
- **D5. Exposure threshold of 5% of a bank's loans** for an exposure to count toward impact. Proposed; tune on the eval.

## 11. To clarify or get access to

| # | Item | Why | Ask | Needed by |
|---|---|---|---|---|
| Q1 | Reddit API terms | The free tier bans commercial use; confirm an internal POC is allowed before calling it directly. Tavily and Exa need no extra terms | Reddit's developer terms | X, optional |
| Q2 | LLM providers for internal data | Public data can go to Anthropic and OpenRouter; the FI-to-vendor list or DMS documents may not | PMs, IT security | Before any internal data |
| Q3 | Analyst research | Bloomberg, broker research or similar; licences usually forbid redistribution and LLM processing | PMs, library or EKD | K |
| Q4 | Licensed full-text news | Factiva or publisher licences would remove paywall gaps (P10) and give reliable dates | EKD | After the sessions |
| Q5 | FI-to-vendor list | Would replace the partial public vendor links; its classification decides whether it can go to an LLM | The team that holds it | After the sessions |
| Q6 | Which numbers users track | Decides what the Data tab keeps; ask in both sessions | Test users | Sessions |
| Q7 | FMD participants' division | Decides the last FMD topic | Session organiser | S |
| Q8 | TCRD session date, and whether they already have monitoring tools | Sets the ingest date and shapes the scenario | Session organiser | D |
| Q9 | Downdetector or similar outage feeds | Early outage signal for TCRD; the public pages restrict scraping, the data is sold | PMs | Later |
| Q10 | Meltwater or another paid social feed | No free tier; only worth it if the sessions show social media matters | PMs | After the sessions |
| Q11 | X developer terms | Confirm storing posts in the app's database is allowed for an internal POC | X developer agreement | X |
