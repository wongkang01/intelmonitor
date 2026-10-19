# Phase 1 decisions log

Decisions taken while running `phase1-plan.md` as workflows, newest last.
"User" means the user chose; "Agent" means the orchestrating agent chose the best option under the user's instruction of 8 October 2026 to complete the plan without stopping and log each decision here.

## Open questions from the plan

| # | Decision | By | Why |
|---|---|---|---|
| Q7 | Keep both FMD topics, Insurance and risk financing and Infrastructure and transition finance | User | The FMD participants' division is not known |
| Q8 | The TCRD session falls in the same week as the FMD session, so one final ingest serves both | User | |
| Q11 | Store X post text, timestamps and engagement counts | User | The terms allow it for an internal POC |
| R0 | The first full re-run follows a fresh ingest with the new subjects | User | New subjects need documents for the wave 3 checks and the wave 4 mocks |

## Gate 1: subject list (8 October)

| # | Decision | By | Why |
|---|---|---|---|
| S1 | Keep the Banking regulation topic, narrowed to prudential rules, AML/CFT and enforcement | User | It serves regulatory supervisors; technology resilience moves to Technology risk regulation |
| S2 | Park Maybank and its one-member Other banks group; Maybank stays a relationship endpoint | User | Simpler; the Azure-to-Maybank eval case is replaced by a vendor case on DBS, OCBC or UOB |
| S3 | Groups stay in the seed as peer sets (sidebar headings, dashboard watchlists, peer comparison, search queries) but are no longer monitored subjects: no screening question, no developments tagged to a group, no group page | User | Focus is on topics and entities; group pages may return later for peer comparison |
| S4 | All nine payment systems are `payment_system`; Bank of Thailand is `central_bank`, OJK `regulator` | User | |
| S5 | Back up the store, then delete the dashboards and follows that name parked subjects; the server skips unknown subject ids instead of failing | User | Stale rows broke the dashboards endpoint |
| S6 | Drop coindesk.com, theblock.co and inquirer.net from the news domains | User | They served only parked subjects |
| S7 | Drop the document-level adverse and direction screening questions before the ingest | User | Item A retired their downstream use, and the subject change re-screens the corpus anyway |
| S8 | Keep the jurisdiction and regulatory-stage screening questions | Agent | Adding a question back later re-screens every document; keeping them costs little |
| S9 | Add Microsoft 365 as its own technology provider subject and remove "Microsoft 365" from Microsoft Azure's aliases | Agent | DBS's collected dependency is on Microsoft 365, not Azure; separate subjects tag outage news precisely and let the impact step follow the right link |
| S10 | Align the jurisdiction screening questions with the tracked geographies: add Taiwan, India, Australia and South Korea, drop the Philippines | Agent | The subject change re-screens everything now; adding a jurisdiction later would re-screen again |
| S11 | A dashboard that lists a group resolves it to the group's member entities | Agent | Groups no longer carry developments of their own (S3), and the Singapore banks starter dashboard lists the group |

## Waves 2 and 3

| # | Decision | By | Why |
|---|---|---|---|
| R1 | Relationship store as built: 528 relationships, 148 endpoints; RWA-only and currency-only bank-country pairs get their own exposure link with no weight; OCBC's onshore and offshore China slices sum into one Mainland China figure; NPL figures attach to the exposure as extra figures; partner_of rows are dropped | Agent (item R) | Keeps every sourced row reachable without inventing a loan share |
| R2 | `owns` also counts as a first hop for two-step paths, besides participates_in, depends_on and subsidiary_of | Agent (item R) | "Malaysia reaches OCBC through OCBC Malaysia" is stored as OCBC owns OCBC Malaysia |
| D5a | An exposure counts for impact only with a disclosed loan share of 5% or more; exposures with no disclosed loan share do not count | Agent | The threshold cannot be checked without a share; precision matters more than reach for the sessions, and the Hong Kong scenario still reaches all three banks |
| D5b | Region-level exposures (a bank that reports only Greater China) count, ranked after direct country links, and the route says the figure covers the whole region | Agent | A region figure is an upper bound for a place inside it |
| X1 | Social spike series, complaint or rumour classification and a trending ranking are left out of M0; social posts go through screening, extraction and merging like news, and the unverified label and lead time are computed when shown | Agent | The plan's done-when for X does not need them, and with one ingest a week of posts gives no baseline for a spike |
| X2 | Item X does not edit server code; U1 shows the unverified label and the lead time from each source's collection and timestamp | Agent | Item I owns the server models in the same wave |
| I1 to I13 | Item I's choices: supervised_by and listed_on never carry impact; a second hop into a place counts only after owns or subsidiary_of; the gate is Notable or above for any target; candidates rank direct, then region-level, then unweighted; the model picks a numbered route written by code and never writes one; code-selected passages that name the candidate go to the model; confidence is high, medium or low, not a percentage; the monitor page carries impacts for the last 7 days | Agent (item I) | See item I's report; each keeps routes code-made and precision high |
| U2a | Pages for countries, sectors, vendors and payment systems show the tracked institutions linked to them (route, size, evidence grade, last confirmed, source) from the relationship store, beside any indirect impacts | Agent | Both session scenarios start from the thing that failed or moved (a cloud provider, Hong Kong property), and the corpus has no Hong Kong property-price development to carry an impact |
| O10 | The wave 4 mocks are built from the completed 24 September re-run plus item I's and item B's scratch outputs, while the wave 3 run computes | Agent | The layout choice does not depend on which run the rows come from, and this saves several hours |
| V1 | A development reported only by social posts is capped at Minor until a news or official source confirms it | Agent (verification) | prd.md section 7: one post is not a signal, and unconfirmed posts were reaching High |

## Bugs found and fixed outside the plan

- Notes, briefs and answers counted rule breaks with `broken += await ...` inside `asyncio.gather`, so concurrent subjects overwrote each other's counts in the run log.

- The cached Jev client was bound to the first event loop, so `im run --both` and a second "Run now" in one server process failed with "Event loop is closed"; the client is now kept per event loop (`pipeline/jev.py`).
- `entity-links.yaml` had an unquoted company name with commas; it is quoted now and the build script's load-time repair is removed.

## Wave 4 mock picks

| # | Decision | By | Why |
|---|---|---|---|
| W1 | U1: the development opens as its own full page (mock option B) with a close or back control; the section heading is "Who does it impact" instead of "Why this matters"; news and official sources and social sources sit in separate tabs | User | The panel had picked option C (drawer) |
| W2 | U2: the entity overview follows the user's sketch: the brief top left, key data top right, developments full width below; the other important blocks (could affect, linked institutions, shared with, coming up) stay on the overview | User | The panel had picked option C |
| W3 | U3: onboarding option B | User | Matches the panel's pick |
| W4 | U4: dashboard and shell option B | User | The panel had picked option A |
| W5 | The entity page keeps a Developments tab with the full feed; the overview shows only the top 5 developments | User | |
| W6 | Development feeds group rows under significance headings: High, Medium, Low | User | The single mixed list was unclear |
| W7 | Adverse is redefined as the cause of harm to the entity (HANDOFF-adverse.md): events at the entity and harmful trends or rules bearing directly on it; never commentary, forecasts, market reactions or follow-ups; the flag is labelled "Adverse event" | User | The earlier rule came from a misread transcript and was too narrow |
| W8 | Development lists show a column header row (Priority, Finding, Date) above the rows, once per list, hidden below 640 px where rows stack | User | |
| W9 | Feeds drop the High, Medium and Low group headings and their meaning lines (W6): one list under the column header, highest priority first; Top developments drops its "This month, highest priority first" note. The priority meanings stay in Help | User | The Priority column already carries the label |
| W10 | Data changes are coloured: green when good, red when bad, using each series' bad direction (a rise is bad for NPL and loan-to-deposit ratios; otherwise a rise is green); the overview's right column holds Key data with an Upcoming dates panel under it, moved out of the brief | User | |
| W11 | A development opens as a popup the size of the New dashboard dialog, over the page it was opened from (URL ?development=<id>&scope=..., so links and Back work; old /developments/<id> links redirect into it); only a close button; left column: Who it impacts over Connections, each scrolling on its own; right column: sources with News and Social tabs | User | Supersedes the full page of W1 |
| W12 | Impact rule tightened: a bank's exposure to its home country never counts; exposure (loan share) routes count only for market, financial, policy and security news; ownership and subsidiary routes still count for regulatory news in the subsidiary's country; dependency and payment-system routes unchanged | User | UOB had 126 indirect impacts against 23 direct, many of them Singapore regulatory news reaching it "via its Singapore loans" |
| W13 | Could affect, the linked institutions and Shared with move from the Overview to a Related tab; the Overview keeps the brief, Key data, Upcoming dates and the top 5 developments | User | The Overview was crowded |
| W14 | The sidebar's Entities and Topics headings collapse their whole list; the choice is remembered per browser, and opening an entity's or topic's page reopens its section | User | |

## Item D

| # | Decision | By | Why |
|---|---|---|---|
| D1 | Item D runs on the 8 October ingest; a refresh script (scripts/refresh-for-sessions.sh: ingest with T0 the session date, im run --both, deploy with --data) is left for 11 or 12 October | Agent | The work finished on 8 October; X search reaches back 7 days, so the refresh should run on the session date |
| D2 | The eval comparison with phase A is replaced by the new eval steps (cases, impact, brief with the Opus judge, brief-compare) plus the High share and adverse checks | Agent | Phase A scored standing questions, which Phase 1 parks, and its cache cannot replay the new screening |

## Orchestration

| # | Decision | By | Why |
|---|---|---|---|
| O1 | Item P's pipeline part (stop standing answers and custom questions) moves from wave 3 to wave 1, and notes and summaries pause until item B rewrites them | Agent | The first full re-run would otherwise spend Claude calls on stages about to be parked |
| O2 | Ingests pass `--t0`, since `im ingest` reuses the stored T0 (24 September) otherwise | Agent | Without it the fresh ingest replays the old window |
| O3 | The first re-run computes 24 September, 1 October and 8 October in one process, in date order | Agent | 24 September holds the DBS acceptance case; one process keeps code edits by parallel agents out of a running pipeline; date order makes each run diff against a run built by the new code |
| O4 | Item R starts while wave 1 is still in review; items M and X start after the ingest finishes | Agent | R touches only new files; M and X edit code the ingest imports |
| O5 | X spend cap: at most about 3 USD per full ingest and 1 USD for testing, by capping posts per subject and searching only subjects where social posts matter | Agent | The sign-up credit is 20 USD and covers the POC only if each ingest stays small |
| O6 | The wave 4 mock gate and the item D gate are decided by the agent, logged here, instead of waiting for the user | User instruction | The user asked for the plan to be completed without stopping |
| O7 | The wave 1 integration agent was stopped after its checks passed (ruff, format, pyright, gen:api, typecheck, lint, a small end-to-end run, the five gold cases); it had hung on a browser command | Agent | Its remaining work was extra smoke testing; the gate workflow re-runs every check |
| O8 | Item R is split into two smaller agents with a retry, at high effort | Agent | Two single-agent attempts died mid-response without writing files |
| O9 | The user's `im serve` keeps running with reload, so code edits migrate the live store as they land; a backup is taken before each wave | Agent | The verify harness needs the live servers, and migrations are additive or reviewed |
| O11 | From 8 October afternoon every workflow agent runs on Opus 5.5 at high effort, not max | User | |
| O12 | From 9 October, workflow agents run on Opus 5.5 at medium effort, and simple mechanical tasks on Sonnet 5.5 | User | |

## Where things stand (8 October, 11:30, usage limit reached)

- Done and reviewed: items A, S (with the gate decisions), R, M, X, I and B; the fresh ingest (T0 8 October, 1,261 documents); the 24 September run on the new code (item A's done-when all pass: nothing adverse to DBS in the section 9 week, the UBS vote only on Banking regulation at Medium, High at 9.7% against 20%); `im series fetch` on the live store (manual series loaded, `im check series` clean).
- Stopped mid-way and to resume: the wave 2 and 3 integration workflow (adds `social` to the server and web collection lists, refusal handling in briefs and notes, past-run check coverage, year-to-date change windows); it may have left partial edits, so re-run its checks first. Resume with the persisted script `phase1-waves2-3-integrate` and `resumeFromRunId: wf_ea6c900c-128`.
- Stopped mid-way: the wave 4 mock workflow (three of four mock files were written under `mocks/phase1/`); resume with `resumeFromRunId: wf_c87ee400-461`.
- Not started: `im ingest --social-only` (only after `social` is in the server's Collection type), the wave 3 run (`run_dates.py 2026-09-17 2026-09-24 2026-10-01 2026-10-08`, which adds impacts, notes and briefs), the done-when checks for I and B with the evals, U1 to U4, item D (final ingest on 11 or 12 October, run, eval, walkthroughs, test dashboard cleanup, Railway redeploy) and the final artifact.
- Backups: `data/intelmonitor-before-item-a-migration-2026-10-08.db`, `data/intelmonitor-before-phase1-rerun-2026-10-08.db`, `data/intelmonitor-before-wave3-run-2026-10-08.db`.

## Where things stand (8 October, evening, usage limit reached again)

- Since the last note: the integration pass is done and reviewed (social collection on server and web, refusal handling, past-run check coverage, year-to-date windows); `im ingest --social-only` stored 273 social documents and 1,968 trend rows (about 1 USD of X spend); the wave 3 run recomputed 17 Sep to 8 Oct with impacts, notes and briefs (RUN EXIT 0; 400 indirect impacts and 53 briefs on 8 Oct, no refusals); the user picked the mocks (W1 to W4).
- Stopped mid-way: the wave 4 UI workflow after U1 was built, during U1's review (`resumeFromRunId: wf_edc9c3b9-346`; check `git diff web/` for partial review edits first); the wave 3 verification workflow (`resumeFromRunId: wf_356cf010-b9e`).
- Left: finish U1's review, then U2 to U4; the item I and B done-when checks and evals; item D (final ingest on 11 or 12 October, run, eval, walkthroughs, test dashboard cleanup, Railway redeploy); the final artifact.
- Backup before the wave 3 run: `data/intelmonitor-before-wave3-social-2026-10-08.db`.

## Where things stand (8 October, 23:00, usage limit reached)

- Done since the last note: U1 to U4 built and reviewed; the wave 3 verification passed (items A, I, B and X done-when, evals cases, impact and brief with the Opus judge); the adverse redefinition (W7) applied to extraction, the eval and phase1-plan.md, with six new gold cases passing; impact "why" text no longer leaks prompt labels such as F1 or P1 (prompt rule plus a code strip in pipeline/impact.py); scripts/refresh-for-sessions.sh written.
- Running in the background (not an agent): the adverse re-run of 17 Sep to 8 Oct, log `<scratchpad>/adverse-run.log`, ending with "RUN EXIT". If it stopped on a usage limit, rerun `uv run python <scratchpad>/run_dates.py 2026-09-17 2026-09-24 2026-10-01 2026-10-08` from api/; completed calls replay from cache.
- Stopped mid-way: the UI follow-ups workflow (W5, W6, W7 label, review leftovers); resume with `resumeFromRunId: wf_b8efc0e5-12b` after checking `git diff web/`.
- Left: the UI follow-ups; item D (session walkthroughs, test dashboard cleanup, eval on the re-run, Railway redeploy with --data, then refresh-for-sessions.sh on 11 or 12 October); the final artifact.
- Backup before the adverse re-run: `data/intelmonitor-before-adverse-rerun-2026-10-08.db`.

## Final state (9 October)

- Waves 1 to 5 are done: items A, S, R, M, X, I, B, U1 to U4, the user's follow-ups (W5 to W7) and item D except the session-date refresh (D1).
- Item D: three misdated documents fixed with the new `im redate` (two removed as outside the window), all four runs recomputed, test dashboards deleted, profile, visits and triage reset for testers, session walkthroughs recorded under artifacts/verify/phase1-sessions/, the Railway demo redeployed with the 8 October store (deployment 53d15f5b-d403-4df6-b90a-6855f183aa60).
- Showcase: artifacts/phase1-showcase/, published as a private artifact at https://claude.ai/artifact/XRSJtmpuZErFJLUx9S1RnE.
- Still to do: run `scripts/refresh-for-sessions.sh 2026-10-11` (or the 12th) before the sessions; it backs up, ingests, recomputes and redeploys with the new data. Nothing is committed.
- Backup before item D: `data/intelmonitor-before-item-d-2026-10-09.db`.
- 12 October: redeployed to Railway (deployment 2e5a1bb1-e174-4e33-8971-b5348d1ad79b) with the current code and the 8 October store, from a copy reset for testers (no active role, only the Singapore banks, TCRD and FMD dashboards, no visits or triage marks); the local store keeps the user's own profile.
