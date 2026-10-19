# Product proposals: three directions for IntelMonitor

Written 2026-10-05, from `user-insights-2025.md` (pain points P1 to P15) and the MAS department research.
Each proposal is a different idea of what the product is, not a list of features.
All three assume the Edge Malaysia date fix and the eval run.

## Personas

1. Prudential supervisor: BD1, BD2, ID, PD. Watches named institutions; needs adverse news, local entity resolution, peers and exposure.
2. Financial crime: AMLD. Cares about adverse event types and patterns across a sector more than single entities.
3. Development and policy: FDD, FTIG. Positive news matters too: relocations, new products, rival financial centres.
4. Curator and management: EKD, department heads. Produces newsletters for others; needs briefs and export.

Markets and investment (RMD) is left out because the EPG econtech dashboards already serve it.

## Proposal 1: The Newsroom

IntelMonitor stops being a dashboard and becomes an AI editorial desk that publishes a daily brief per persona.
Users already live in newsletters (GMM, IA-News, Factiva); this meets them there and goes beyond what a newsletter can do.

### Pipeline

- Watch items replace fixed subjects as the unit of interest.
  Each is a plain-language concern that Claude turns into search queries, a match test against the whole corpus, and links.
  Peers and exposure markets generate their own watch items, so "India property → UOB" is one more watch item.
- A new editor stage after the answers ranks developments by materiality × persona relevance × novelty to the reader (using the Mark reviewed watermark).
  It writes a lede paragraph, a status per subject (Calm, Watchful, Strained, Critical) with its drivers, and a "why this matters to you" line per item.
- A scheduler runs ingest and runs twice a day.

### Screens (mocked; artifacts since deleted)

- Front page: masthead with edition time and portfolio size; lede paragraph; status per institution since the last read; sections Via exposure, Peers, Your institutions, Elsewhere that matters; right rail with an impact × imminence chart, "checked and set aside" counts with reasons, upcoming dates and watch items; persona switcher (Supervisor, Financial crime, Development, Desk); Listen and Email buttons.
- Desk (EKD editor): candidates ranked with materiality, fit and novelty columns and include checkboxes; editable lede marked as edited; drag to reorder; a desk note; checks before publish (sentences with a verified source, numbers not in any source, sources older than the window, edited claims to recheck); audience by department; delivery (front page, email, audio); reader stats from the last edition.
- Phone: swipe card (Not for me, Flag, Keep) with a verified quote, and an audio edition player for the train.

### Wacky additions

- A 4-minute audio edition for the commute.
- Swipe triage that trains a per-user relevance model.
- A "nothing happened" guarantee that says what was checked and why it was set aside.

Pain points: P1, P7, P10, P11, P12, P15 strongly; P4 and P13 partly.
Risk: the editor stage becomes the single point of truth; a wrong lede is worse than a wrong table row.

## Proposal 2: The Living Map

A knowledge graph of who is exposed to whom; every piece of news lands on a node and its impact spreads along the edges.

### Pipeline

- Entity resolution down to legal entity (LEI): institution, subsidiaries, branches, parent, foreign group. Separates HSBC Singapore from HSBC UK (P3).
- Edges, each a time series with weight, source and as-of date: owned by, branch of, exposed to (country, sector, market), depends on (vendor, cloud, payment rail), counterparty, peer of, regulated by.
- A disclosure extractor reads each new annual report, Pillar 3 disclosure and SGX filing and proposes edge updates for a person to approve. The econtech SGX scraper already collects filings.
- A propagation stage pushes a development's signal along edges, weighted by exposure × materiality and halved each hop. Every entity gets a direct and an indirect score, and the indirect score names its path.
- A scenario engine: "Indian property prices fall 20%", "Tether depegs", "AWS Singapore down 48h". It ranks exposed institutions with exposure sizes and the latest news on each hop, and keeps the scenario as a standing watch item that says each run whether the news moved it closer or further away (P8).

### Screens (mocked; artifacts since deleted)

- Map: DBS, OCBC, UOB with subsidiaries (UOB Thailand, DBS Hong Kong, OCBC Wing Hang), markets (Hong Kong property, Greater China CRE, China credit, ASEAN USD funding, AI infrastructure loans) and a shared cloud provider. The HKMA rate rise is selected and its ripple runs through Hong Kong property to UOB, DBS Hong Kong and OCBC Wing Hang. Lenses: Prudential, Financial crime, Financial centres, System. A run-date slider.
- Scenario box ("What if Hong Kong office values fall 20%") with a results table: institution, path, exposure as disclosed, latest signal, closer or further this week. A "Replay Credit Suisse 2023 on today's graph" button.
- Side panel: the selected development, institutions reached with hops and score, "who to call" ranked by score and days since last contact, and edges proposed from the news (e.g. UOB lead adviser on the ZanKore GPU facility) to add or dismiss.
- Entity edges page (UOB): exposure table with measure, value, as-of date, source and status; owns, depends on, peer of, regulated by; how one exposure changed across filings; updates from filings and news waiting for approval; refresh schedule (results, Pillar 3, annual report, internal returns); edge rules (flag a 2pp move between filings, flag a sale or purchase of a unit).

### Wacky additions

- Contagion replay of Credit Suisse 2023 or SVB through today's graph.
- Shadow exposure discovery: an agent reads news for links not yet in the graph and proposes edges.
- A "who should I call" button ranked by exposure × severity × days since last contact.

Pain points: P3, P5, P6, P8, P14 strongly, and P2 (watchlists come from the graph).
Risk: exposure data is the bottleneck, not code. Public disclosures are quarterly and coarse.

## Proposal 3: A research agent for every analyst

Each user gets a persistent agent that knows their portfolio, works between their logins, and drafts the deliverables they produce today.
Fixed stages become tools; standing questions become goals.

### Pipeline

- Slimmed core: ingest, dedup, screening and quote verification stay as tools; merging and answering become agent behaviour. The eval showed simple retrieval nearly matches V2 on coverage; the agent closes the correctness gap by verifying before it writes.
- One agent per persona holding the user's institutions, watch items, exposure edges, triage history, notes and corrections.
- Runs on a schedule, searches the corpus first, and goes to the web only for gaps. Anything found there is ingested and verified before it can be cited. Every run is logged and cached so it stays evaluable.
- Deliverables, each a draft to edit: the weekly update to the director (P7), a follow-up note to the bank, questions for the next supervisory meeting, input to the annual supervisory plan.

### Screens (mocked; artifacts since deleted)

- Inbox: "7 things since Tuesday", ranked by what the user acted on before. Card types: Act, Watch, Drafted for you, Meeting prep, Check yourself, Quiet. Each card has an evidence trail (developments → findings → verified quotes) and actions (Draft note, Add to weekly update, Ask a follow-up, Not relevant).
- Chat panel answering "What changed at Maybank since I last looked?" with numbered citations, and offering to turn a question into a watch item.
- "What it has learned about you", editable (skips investment picks, reads CRE items in full, forwards governance news to the director).
- Draft note to UOB: a cited request for Hong Kong CRE LTVs, special-mention names and stress results; footnoted sources; a three-way panel view (prudential, markets, financial crime) with disagreements highlighted; "the case against sending this now" built from the same corpus; a likelihood slider compared with the team median and the user's calibration; what happens after sending (contact logged, reminder set).

### Wacky additions

- A devil's-advocate agent that writes the strongest opposite case for every assessment (P13).
- An analyst panel of persona agents giving their take on one development side by side.
- A drift detector on the user ("you dismissed every CIMB item for 3 weeks, but CIMB's adverse news tripled").
- An internal forecast market for direction of travel, with calibration per analyst.

Pain points: P1, P2, P7, P12, P13 strongly; P14 once internal data is connected.
Risks: hardest to evaluate and to trust; per-user agents conflict with the single-user POC rule until end-user feedback, so a persona switcher stands in.

## Comparison

| | Newsroom | Living Map | Agent per analyst |
|---|---|---|---|
| Core bet | Users want a better newsletter | The value is in the connections | Users want their deliverables drafted |
| Persona served best | Curator, management, everyone on the go | Prudential supervisors, AMLD | Supervisors with large portfolios |
| Pipeline change | Medium: watch items, editor stage, scheduler | Large: entity resolution, edge data, propagation, scenarios | Large: stages become tools, agent loop |
| UI change | Total: front page, desk, audio, swipe | Total: the map is the app | Total: inbox plus chat |
| Biggest unknown | Whether the editor's judgement is trusted | Getting exposure data | Evaluating and trusting it |
| Fit with the eval | Fits V2 | Fits V2, adds stages | Pushes towards V1 plus agent |

## Recommendation

Build the Living Map's data layer (entities, legal-entity resolution, exposure and dependency edges, propagation) and show it through the Newsroom's front page.
The map answers the hardest supervisor needs (P3, P5, P6, P14) and makes "India property → UOB" structural.
The Newsroom is how all four personas would read it, including the curators who already produce newsletters.
Take one idea from Proposal 3 now: the drafted follow-up note to the bank.
It is cheap, it is what supervisors do after alarming news, and it tests whether users trust drafted output before committing to an agent architecture.

## Data notes for future mocks

- Developments used in the mocks came from the corpus: Macquarie's S$181m provisions per 10% collateral fall at UOB, UOB's S$345m excess US-branch provisions, Maybank's CFO removal and 2% share fall, CIMB's impaired loan warning, Fed funds at 3.88%, the MAS CRO survey and AI stress test, the DBS and Citi tokenised payment, the ZanKore GPU facility.
- Bank exposure weights and vendor names do not exist in the data yet and were shown as placeholders.
