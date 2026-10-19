# Entity and topic monitoring dashboard: PRD

Status: work in progress, 7 October 2026.
Source: the PRD deck of 5 October 2026, review comments from Bennett Tong and Ella Choi (6 October 2026), and the PM review of the prototype (7 October 2026).
Classification: Restricted / Non-sensitive.

## 1. Product definition

**Objective.** Help MAS staff stay up to date on the entities and topics relevant to their work, across fragmented information sources.

**Primary job.** Show what changed, why it matters and the source evidence, with little or no prompting.
The dashboard starts from an answer, not a blank prompt.

**MVP hypothesis.** A preloaded, prioritised feed helps staff find relevant developments for an entity faster than news alerts, searches and generic LLM tools.
The FMD session may show that some development staff start from topics and markets rather than entities.
If so, the hypothesis becomes "for an entity or topic".

**Design principle: a first-time, infrequent user.**
The target user has had no briefing, opens the dashboard occasionally and does not know its layout.
Every screen must answer "what am I looking at, and what do I do next?" without anyone explaining it.
Labels use plain language. Internal terms such as "hops" do not appear in the interface.
Dense, abbreviated layouts for power users come later.

## 2. Users

| Group | Audience | Examples | Monitoring need |
|---|---|---|---|
| Regulatory supervisors | Primary | BD, ID, PD, FAS | Entities first. Prioritise adverse news and assess supervisory relevance and follow-up. |
| Technology and cyber risk supervisors | Primary | TCRD | Many FIs and their vendors at once. Early signals of outages, breaches, threat campaigns and third-party failures. |
| Development staff | Primary | FDD, FMD, INT, FTIG | Monitor topics, sectors and entities to inform development policy and funding decisions. |
| Management | Secondary | MFSC | Compare themes and recurring pitfalls across entities to inform regulatory policy. |
| General staff | Secondary | EKD/TG, PDD | Research topics and understand their relevance to MAS work. |

The MVP is designed for the two primary groups.
Secondary users can use it, but no feature is built for them alone.

Interest in other entities depends on the job, not only the persona.
A supervisor whose job is one bank may not care about its peers.
A supervisor covering all the significant banks, or TCRD looking across FIs and their vendors, will, because those FIs are linked.

FMD is provisional under development staff.
Its public mandate is market- and sector-led (capital markets, asset management, funds, insurance, infrastructure finance), not bank-led.
Interest in Singapore banks as a hub may sit with the Financial Centre Development Department instead.
Confirm with the FMD session which division the participants come from.

RiMD is provisional.
Its need overlaps supervisors and development staff: topic-led monitoring of adverse developments such as geopolitical tensions, with entities as supporting context.

Excluded: EPG (economics) and RMD (reserves).
Their data needs are more quantitative and specialised.

## 3. Pain points by user group

**Regulatory supervisors**

- They usually know about adverse news already, but may miss events that reach their entities indirectly.
- They find it hard to trace a link between news (such as layoffs) and internal data (such as a notice of upcoming layoffs).
- They have limited analysis across time.
- Promotional and trivial news, such as "DBS launches 10 insurance plans this week", shows up because the entity is named, and crowds out real events.

**Technology and cyber risk supervisors**

- FIs report their own incidents within an hour, so news of an FI outage rarely tells them something new.
- They want earlier signals: vendor and cloud outages, breaches at third parties, emerging threat campaigns, and incidents at overseas peers that could repeat here.
- Concentration risk is hard to see: which FIs depend on the vendor that just failed.

**Development staff**

- They may miss news on their entities and topics.
- They want to get ahead of issues rather than react to them.
- They find it hard to follow trends over time.

**Management**

- They find it hard to see themes that cut across entities.
- They want to get ahead of issues rather than react to them.

**General staff**

- They cannot always see how news relates to their everyday work.

## 4. Problems the dashboard must solve

| Problem | What staff face | Product response | Phase |
|---|---|---|---|
| Information overload | Limited time to read large volumes of news and updates. | A prioritised development feed with concise summaries and labels that flag the most urgent, highest impact items. | 1 |
| Important signals may be missed | High volumes and fragmented channels hide material developments. | Scheduled monitoring, change detection, basic analysis, and relationships between events and entities, including events that do not name the entity. | 1 |
| Cross-cutting themes are hard to see | Leaders cannot easily see common themes and recurring pitfalls across supervised entities. | Event-entity relationships: each event links to every entity it affects, so one event hitting several entities shows as one item. Theme aggregation and trend roll-ups stay under cross-entity analysis (Could have). | 1 for relationships, 2 for roll-ups |
| Relevance is unclear | Staff must work out how a development affects their entity, topic or responsibilities. | A short "why this matters" explanation: which entities the development affects and by what route, with a source. Relevance to the user's job function comes later. | 1 for entities, 2 for job function |

For the testing sessions, scheduled monitoring is replaced by one or two manual ingests run shortly before them.

The third row follows review comment 1, which asked to reframe "cross-entity view" as the event-entity relationship already in the Must haves.

## 5. Unique selling point

The dashboard lets MAS staff:

1. Read the most significant news first, with social media added second.
2. Understand how news events could plausibly affect supervised entities, directly or indirectly.

News is the core: slower but solid.
The product must work on news alone.
Social media is faster and shows reaction, and is added later to improve it.

A direct effect is something that happens to the entity itself.
An indirect effect reaches the entity through its group, peers, vendors and third parties, markets, counterparties or exposures, in news that may never name it.
Point 2 is a key feature of Phase 1, not an add-on.
It rests on a store of standing relationships, collected once from public sources and refreshed when those sources update:
- exposure: a bank's loans to a country, region or sector, from its results and Pillar 3 disclosures, with the size;
- dependency: an FI's use of a vendor (cloud, data centre, telco, core banking, print and mail) or its participation in a payment or market system (MEPS+, FAST, PayNow, GIRO, NETS, SWIFT, SGX clearing);
- structure: subsidiaries and the countries they operate in, the regulators that supervise them, major shareholders, and shared ventures and memberships.

When new news is about a country, sector, vendor or system, the dashboard follows these relationships to the supervised entities they lead to, and judges whether the development plausibly affects each one.
"Plausibly" means the dashboard states the route, the size where one is disclosed, and the source and date of the relationship, and does not claim certainty.

Public data has limits, and the dashboard shows them rather than hiding them.
Exposures are disclosed by region and industry, not by counterparty, and some countries (India, the United States, Vietnam) have no disclosed size.
Vendor relationships are public only when a press release, case study or incident reveals them, and public data cannot show that a relationship has ended.
Each relationship therefore carries an evidence grade and the date it was last confirmed.

Point 2 is the hypothesis the testing sessions most need to check.
The sessions run it on real public data.

**Hypothesis on hold: data sources are the advantage.**
A recurring dashboard builds a larger corpus than a one-off question to a general LLM tool, which typically draws on about 10 sources.
A news outlet could build the same on its own archive, so the corpus alone is not unique.
Internal data is unique: the FI-to-vendor mapping and DMS documents enable links and impact analysis no outside tool can make.
The PMs accepted this as a hypothesis on hold (KIV) and asked for it to be broken down further.

## 6. Core monitoring journey

| Step | Question | What the user sees |
|---|---|---|
| 1. Land | What needs my attention? | The latest material developments for the scope chosen at onboarding, tagged and labelled by priority. |
| 2. Orient | What changed? | New and updated developments, set apart from what the user has already seen since their last visit. |
| 3. Filter | What is relevant to my scope? | Entity or topic selection over a daily, weekly or monthly period. |
| 4. Understand | Why does this matter? | How the information relates to the selected entity, topic or work context. |
| 5. Verify | Can I trust this? | The source and the supporting excerpt, before anything goes into a formal update. |
| 6. Compare | Is this part of a pattern? | A specific claim backed by a small piece of the graph, such as "DBS and OCBC both depend on X", and topic trends that may inform policy or regulation. |

The full relationship graph is not a journey step.
Few users can read a whole graph, and a supervisor focused on one entity will not click through it.
Relationships appear as evidence for a claim the dashboard makes.

## 7. Scope

### Must have

- Entity and topic monitoring.
- Priority labels (High, Medium, Low), set by the model by default. Promotional, product and trivial news gets the lowest label.
- Adverse-news flag and tone. Adverse marks the event that harms the entity, not commentary or reactions to it. Section 8 has the full definition.
- News, analyst and official sources.
- Source citations and evidence.
- Typed relationships between entities and related events. Each link has a type, and each type means one thing. This includes events that affect an entity without naming it, and absorbs the earlier "cross-entity view" response (review comment 1). Relationships appear as small graph snippets that back a specific claim.
- "Why this matters" for each affected entity: the route by which a development reaches it, with a source.
- Indirect impact through stored relationships (USP point 2): exposures by geography and sector, vendor and payment-system dependencies, and group structure. Each relationship has a type, a size where disclosed, an evidence grade, a source and the date it was last confirmed.
- Shared relationships as evidence: for two entities, what links them both, such as a shared vendor, payment system, market or venture, shown as a small graph snippet.
- Development clustering: repeated reports of one event merge into a single development. The priority feed and change detection depend on it.

### Should have

- Social media, after news. A basic version can ship first: X posts through its pay-per-use API, plus forums and Reddit through the existing web search. Social media plays two roles, and each needs its own treatment:
  - early warning: people raise an issue online before it reaches the news, such as customer complaints about an outage;
  - reaction: what people think once something has happened.
  Social media is less credible than news, so a single post is not a signal. It takes volume, such as a spike in negative posts about an entity, before the dashboard flags an issue. Posts carry an "unverified" label until another source confirms them.
- Refreshing relationships: re-reading their sources when they update (quarterly results, payment participant lists, annual reports), and proposing changes found in the news, such as a bank switching provider, for a person to approve.
- Internal DMS and OneDrive sources. Phase 1 excludes internal documents because of their heavy dependencies.
- Links from external news to internal sources.
- Entity and topic tagging: each article or artefact is tagged to an entity or topic so retrieval finds it (review comment 3).
- Default dashboard set by role (review comment 4). Onboarding asks for the user's role. A regulatory supervisor picks their supervised entities, and a development staff member picks their topics, sectors and entities. Their first dashboard is prepopulated from that choice. Secondary users get a default of MAS supervised entities.
- Daily, weekly and monthly filters.
- Evaluation set for relevance and completeness.

### Could have

- Customisable layout.
- Customisable data pipeline components.
- Cross-entity analysis: theme aggregation and trend roll-ups.
- Full relationship graph for free exploration, and an event view listing every entity a development affects. Most useful to users who cover many FIs, such as TCRD.
- CRAFT-aligned risk tags.
- Predictive analysis or considerations.
- Relevance and links to the user's job function.
- Custom priority definitions. By default the model sets priority (review comment 2).
- Event chronology: a long-running event, such as a war, shown as its sub-events in sequence (review comment 5).

### Won't have

- Structured data from EDL.
- Case management.
- Follow-up flags and reminders.
- Email drafting or action workflow.

## 8. Requirements for the Must haves

| Requirement | Done when |
|---|---|
| Entity and topic monitoring | A user can open a dashboard for any supported entity or topic and see its developments without writing a prompt. |
| Priority labels | Every development carries a priority label, and the feed sorts by it. Labels are judged for the entity or topic being viewed, so a group-level event can rank differently for a local entity. Priority is the only importance label shown: High, Medium or Low. The model's materiality score feeds it but is not shown, and Needs attention, Watch and Stable do not appear. |
| Priority labels, top tier | High stays rare enough to mean "read this". Today 152 of 770 developments in a weekly run (20%) reach the level shown as Needs attention, so the top tier must narrow once priority is judged per entity and promotional news drops to Low. |
| Priority labels, low tier | Promotional and product news about a named entity, such as a new insurance plan launch, gets the lowest label and does not appear among the top items. |
| Adverse-news flag and tone | A development is adverse to an entity when it reports the cause of harm to that entity: something that happened at it (an outage, breach, fraud, loss, penalty, enforcement action, rating downgrade, failure), or a harmful trend or change that bears directly on it (fraud or scam cases against its customers rising, defaults rising in its book, a new rule that raises its costs). It is not adverse when it only describes, forecasts or reacts to harm whose cause was reported elsewhere: commentary and outlooks (including the entity's own economists), share price moves and analyst views, and follow-up reporting that adds no new harm. Tone is separate: an outlook can be negative in tone without being adverse. Every development shows the flag, labelled "Adverse event", and its tone, and the user can filter on both. |
| Sources | The feed draws on news, analyst and official sources, and each item shows its source type. |
| Citations and evidence | Every claim links to its source and a verified excerpt. The groundedness metric (section 9) tracks unsupported claims. |
| Event-entity relationships | Each development lists the entities it affects, whether each effect is direct or indirect, and for indirect effects the route (group, peer, vendor, market, counterparty or exposure) with its source. Every link in the graph has one of these types, labelled in plain words. |
| Why this matters | Each affected entity has one or two sentences on how the development could reach it, citing the source. |
| Relationship store | Every relationship has a type (exposed to, depends on, participates in, owns, subsidiary of, operates in, supervised by, member of), its endpoints, a size where the source discloses one, an evidence grade (public, reported, assumed), the source link and a verbatim quote, the date it holds from, and the date it was last confirmed. No relationship exists without a source. |
| Indirect impact | When a development is about a country, sector, vendor or system, every supervised entity linked to it is considered. An exposure link counts only above a minimum share of the bank's loans. Two-step chains count where links connect, such as BCS to FAST to each FAST bank, or a subsidiary's country to its parent. For each entity the model decides whether the development plausibly affects it, and in which direction. Indirect impacts are stored and shown apart from news about the entity itself. |
| Indirect impact, shown | Each indirect impact shows the route in plain words ("via its Hong Kong loans, 12.2% of total"), the relationship's evidence grade and when it was last confirmed, and the development's source. A relationship with no disclosed size says so. |
| Shared relationships | For any two tracked entities, the dashboard can show what links them both, as a small graph with each link's type and source. |
| Development clustering | Reports of the same event from different sources and days appear as one development, and a new report updates it instead of adding a duplicate. |

What counts as adverse or significant depends on the role.
For prudential supervisors, adverse means events and trends that harm the entity, such as downtime, rising fraud, losses or enforcement.
For TCRD, it means outages, breaches, ransomware, third-party failures and cloud incidents, and economic or market news is mostly noise.
For development staff such as FMD, significant means opportunity as well as threat, so an adverse-only view misses half of what they need.

## 9. Success metrics

### Product outcomes

| Metric | Definition |
|---|---|
| Weekly active users (WAU) | Unique users who open at least one dashboard in a week, against the eligible pilot cohort. |
| Dashboard helpfulness | User feedback on whether the dashboard helped them find, understand or verify a relevant development. |
| Frequency of use | Days with a visit per active user per week, and the share of users who visit daily or several times a day. Replaces "repeat use", which overlapped with WAU (review comment 6). |

Success means staff come back because the dashboard helps them notice, understand and verify meaningful change.
Daily use is the strongest sign of that.

### Quality metrics

| Metric | Definition |
|---|---|
| Groundedness | Share of claims supported by their cited source. Unsupported factual claims and numbers are tracked separately. |
| Relevance | Whether a surfaced development belongs and matters to the intended user, entity or topic. |
| Coverage | Share of known material developments surfaced for the selected scope and period. |
| Change accuracy | Accuracy of the new and updated labels against the previous monitoring run. |

## 10. Dependencies

**Relationship data.**
Phase 1 runs on relationships collected from public sources on 7 October 2026: bank exposures from the June 2026 results and Pillar 3 reports, payment-system participant lists from MAS and ABS, vendor dependencies from press releases, case studies and incident reports, and group structure from annual reports and SGX filings.
Another team's project has a list of the major vendors FIs use.
It would replace the public vendor links, which are partial, but its classification decides whether it can be sent to an LLM.
The authoritative source for dependencies would be each FI's register of third-party arrangements, which MAS proposed in its March 2026 consultation that FIs file twice a year.

**Social media data.**
Social media no longer blocks the MVP, since the product must work on news alone.
X charges per post read, which is affordable for the POC, but its search reaches back only 7 days and storing posts needs a terms check.
LinkedIn restricts API access.
A full version may still need a licensed feed.
Most finance posts repeat news the dashboard already has.
The posts worth collecting come before the news: customer complaints about outages or scams at supervised entities, market rumours that could affect liquidity, and threat chatter.
Two internal leads:
- a tech sub-team's social media listening tool, which tracks positive and negative sentiment and alerts users when negative sentiment spikes; study how it works;
- a colleague trialling Meltwater, a media-monitoring provider.

## 11. Testing sessions

**Method.**
Do not explain the dashboard.
Give the user a task, then ask what they think and what they would do next.
End each session by giving the real answer.
For every major feature, be ready to explain what it is, how its labels and numbers are produced, and how it is meant to help their work.

**Pass condition.**
An unbriefed user can say what each screen shows and what to do next.
A likely failure to watch for on the relationships view: "I don't know how to use this, I don't have time to click on each one."

**Prudential scenario, both sessions.**
"Hong Kong property prices have fallen sharply this week. Which Singapore banks would you look at, and why?"
Tests indirect impact through exposure: the three banks' Hong Kong and Greater China loans, with sizes and sources.

**Known weak spots to prepare for.**
Users are likely to raise adverse classification and promotional noise.
If the fixes in section 8 are not ready, prepare a workaround to show.
The value of relationships to a supervisor's decisions is still unproven.
Bring one best hypothesis of how a relationship helps answer a real question, and test it.

**TCRD session.**
Tests indirect impact through vendors, the relationships view, and social media as early warning.
Scenario: "A major cloud or payment provider has just reported an outage. Which FIs would you be concerned about, and what would you look at first?"
Vendor and payment links come from public sources; the session ends by showing which links are public, reported or partial, and asks whether TCRD would trust them or need the FIs' registers of third-party arrangements.
Questions:
- How do you find out about incidents today: FI reports, threat intelligence feeds, news?
- What do you wish you knew earlier?
- Do you already use media or social monitoring, or a tool like this?
- Would a vendor-to-FI dependency view change how you work?

**FMD session.**
Tests whether development staff start from topics or entities, and whether "significant" should include opportunity.
Preload topic monitors for their mandate rather than a bank-centred view.
Scenarios:
- "Brief your director on what happened in regional capital markets this week. What would you pull out?"
- "Is Singapore gaining or losing ground on X compared with peer financial centres?"
Questions:
- Which entities do you track: exchanges, asset managers, industry associations, foreign competitors?
- Where do you get market intelligence today: Bloomberg, research notes, industry contacts?
- What would make this better than what you already have?
Before the session, ask the organiser which FMD division the participants come from, so the right topics are preloaded.

## 12. Simplifying the current prototype

From a walkthrough of the prototype on 7 October 2026, checked against the design principle in section 1.
Each change removes something outside the Must haves, or moves it behind a click, so the first screen answers "what changed, and what do I open?".

### Across every screen

- **One label per question.** Today a development shows Needs attention, New or Updated and, in the drawer, a materiality level such as "Significant"; a focus area shows Stable, Watch, New or Needs attention; and cells show transitions such as "Watch → Needs attention". These all try to say how important something is, in different words. Each development instead answers three separate questions:

  | Question | Label | Values |
  |---|---|---|
  | How important is it for this entity or topic? | Priority | High, Medium, Low |
  | Is this the event that harms the entity? | Adverse flag and tone | Adverse event or not, with tone |
  | Have I seen it? | Change marker | New, Updated, or none |

  Remove Needs attention, Watch, Stable, the materiality names and state transitions.
- **Materiality stays as the score behind priority.** The model keeps rating five levels internally. High is Critical or Significant, Medium is Notable, and Low is Minor or Trivial. Today Needs attention is simply Significant or above, so it becomes High.
- **Adverse stays separate from priority.** A significant opportunity, which development staff care about, can be High without being adverse. Folding adverse into priority would break the adverse filter for supervisors.
- **Relabelling alone does not fix the noise.** Every regulatory item on the Singapore banks list is Needs attention today, including a 2012 ECB announcement and DBS's tokenised payment trial. Two causes need fixing in the pipeline, not the interface. First, materiality is one score per development, so a Swiss vote on UBS capital ranks top on the Singapore banks dashboard; priority must be scored per development and entity, on the same five levels, with relevance to that entity in the rubric. Second, 20% of developments reach the top tier; promotional news must fall to Low (section 8).
- **No cut-off findings.** A development title or finding wraps to its full length wherever the user has to read it to decide whether to open it.
- **Clickable things look clickable.** Rows that open sources show a visible cue, such as "View sources" or a chevron, not only a hover state.
- **No internal terms.** Remove "run", "Run of 24 Sep against 17 Sep", "answers changed", "focus areas", "materiality", "in scope", "hops", "tagged by Jev", "tagged by Claude", confidence percentages, "Mark wrong", "Not asked" and "Command line".
- **One date.** The top bar says "Last run 5 Oct" while widgets say "Run of 24 Sep". Show one "Updated 24 Sep", meaning the date of the latest news covered.

### Dashboard widgets

| Widget | Decision | Reason |
|---|---|---|
| Since your last review | Change. Merge with Developments into one feed: the latest developments sorted by priority, with those new since the last visit marked New. Each row shows the full title, one line on why it matters, and "View sources". Remove the run line and "7 answers changed". | Titles are cut to one line, and nothing shows that a row opens its detail and evidence. |
| Developments | Merge into the feed above. | Two lists of developments with different labels make the user ask which one to read. |
| Direction of travel | Remove. | "Rising" and "20 this week, 14.7 a week before" count developments per week; the user cannot tell what is counted or what to do about it. Trends belong to cross-entity roll-ups, a Could have. |
| Focus areas | Remove from the dashboard. | Labels are cut off ("Common iss…"), names such as Outliers, Peer moves and Contagion need explaining, and cells show state changes rather than findings. |
| Single focus area, such as Enforcement or Incidents | Remove. | Same state vocabulary. A "Stable, no sources" card spends space saying nothing happened. |
| Watchlist | Change. Each entity shows its count of new high-priority developments and its top development in full. Remove the Watch badge, the inline add field (entities are chosen in dashboard settings) and the "Adverse:" line. | The "Adverse:" line labels commentary and good news as adverse, such as DBS economists on the Middle East and OCBC profit up 22%. The Singapore banks dashboard also shows the watchlist twice. |
| Upcoming | Keep. Rename to "Upcoming dates" and show the full label. | Clear as is. |
| Indicator, such as loan-to-deposit ratio | Remove from dashboards. The numbers stay on the entity page's Data tab. | The title is cut off, and "Stable" adds another meaning of status. |
| Custom question | Remove for the MVP. | It asks the user to write a prompt, against the primary job. Custom definitions are a Could have. |

### Building dashboards

- Replace Add widget, Edit mode, the widget gallery and the Small, Medium and Large sizes with one fixed layout. Customisable layout is a Could have.
- New dashboard becomes: pick entities and topics, then name it. Remove Generate (describing a dashboard to Claude). Onboarding by role, a Should have, builds the first dashboard.
- Before any session, delete the test dashboards from the demo store: "test", "main test", "Verify P6 Build OCBC", and the two "… and 2 more" dashboards.

### Entity page

- **Tabs.** Merge Overview and Developments into one page: the summary, then the prioritised feed. Keep the Data tab and remove the Connections tab.
- **Summary.** Keep the paragraph, rewritten as what changed in plain words; today it reads "Geographic exposure moved to Watch from Stable". Remove the counts line and the "More adverse: 0 focus areas at Needs attention, 3 at Watch…" line.
- **Focus areas:** remove, with "Add a focus area" and custom focus areas. The summary paragraph and the prioritised feed carry the findings, and development categories (strategy, financial, market) remain as the feed filter.
- **What changed since last review** block on the Developments tab, with its run rows: remove. The New marker on the feed carries this.
- **DBS / Peers toggle:** remove. Peers appear as affected entities on each development instead.
- **Key data and the Data tab:** keep, since which numbers users want is a question for the testing sessions. Remove the Stable and Watch states on series, and show MAS table codes only in the source line.
- **Connections tab and full graph:** remove from the entity page. The hop toggle, node and link filters, force graph, "In view" list and Peers grid are free exploration, a Could have. Relationships move into each development as "Also affects OCBC, UOB", with the route and source, per section 7. Keep the full graph page reachable by link for the TCRD session only.
- **Mini connections graph on Overview:** remove. It shows related topics and peers as boxes without saying why they matter.
- **Mark reviewed:** replace with "new since your last visit", tracked automatically. An infrequent user will not remember to mark pages reviewed.
- **Read, flag and dismiss**, which today appear only on hover: opening a development marks it read, and the flag goes, since follow-up flags are a Won't have. Dismiss stays, as a visible action.
- **Following:** remove. The dashboard is the one way to choose what to monitor.
- **Notes**, on the entity page and in the evidence drawer: remove for the MVP. They are close to case management, a Won't have.

### Development detail (evidence drawer)

- Replace "Tagged to", with its confidence percentages, "tagged by Jev" or "tagged by Claude", and Wrong buttons, with "Why this matters": each affected entity, direct or indirect, the route, one or two sentences and the source. Tagging stays as a back-end step (Should have) and is not shown.
- If relevance feedback is needed for the evaluation set, use one "Not relevant" action on the development.
- Replace "Significant · strategy" and "Materiality: medium confidence" with the priority label, the adverse flag and tone, and the source type.
- Keep the sources and highlighted excerpts as they are. They are the clearest part of the product.

### Developments list

- The Status column becomes Priority, and the list sorts by it.
- Filters: replace Materiality with Priority, add Adverse and tone, set Date to day, week and month, and keep Source as source type (news, analyst, official). Remove Jurisdiction unless the FMD session asks for it. Keep Category.

### Shell

- **Run status and Runs popover:** remove, with Run now. These are developer controls, and the list shows the run of 24 Sep four times. Show "Updated 24 Sep" instead.
- **Alerts bell:** remove for the MVP. It repeats the dashboard feed for followed subjects, and with Needs attention on most items it always shows a high count.
- **Coach-mark tour:** turn off for the testing sessions, since the pass condition is that screens explain themselves. Two of its five steps teach Mark reviewed and Generate, which go.
- **Sidebar:** "Groups" is not explained. Show groups such as Singapore banks and Central banks as headings under Entities, leaving Entities and Topics.

### Data issues a new user will read as product faults

- Old events appear as current: a 2012 ECB announcement shows as Needs attention on 18 Sep.
- Duplicates: DBS's outlook on tokenised finance spending appears as two developments, 21 Aug and 7 Sep (development clustering, Must have).
- Adverse is applied to commentary and good news (section 8).
- A Swiss parliament vote on UBS capital ranks first on the Singapore banks dashboard (relevance).

## 13. Review log

| # | Section | Comment | Decision | Status |
|---|---|---|---|---|
| 1 | Problems | Bennett Tong or Ella Choi: make "cross-entity" the event-entity relationship, which is already a Must have. | Response reworded to event-entity relationships. Roll-ups kept as a Could have. | Applied |
| 2 | Scope | Bennett Tong: demote custom priority definitions to Could have; the model should set priority by default. | Kept as Could have, with model-set priority as the default. The uncaptured reply agreed. | Applied |
| 3 | Scope | Bennett Tong asked what entity and topic tagging means. Ella Choi: tagging each article or artefact to an entity or topic, to improve retrieval. | Definition added. | Answered |
| 4 | Scope | Bennett Tong: the default dashboard may be lower priority, depending on persona. Ella Choi: keep as Should have, since effort is low and the product promises a preloaded start. | Kept as Should have, and Bennett's persona point taken: the default follows the role chosen at onboarding. | Applied |
| 5 | Scope | Bennett Tong: add a chronology of events, since a long event breaks into sub-events in sequence. | Event chronology added as a Could have. Clustering itself moved to Must have, since the priority feed and change detection depend on it. | Applied |
| 6 | Metrics | Bennett Tong: repeat use overlaps with WAU; measure frequency of use instead. | Replaced with frequency of use. | Applied |

### PM review of the prototype, 7 October 2026

| # | Topic | Decision | Section |
|---|---|---|---|
| 7 | Target user | Design for a first-time, infrequent, unbriefed user, in plain language. | 1 |
| 8 | Social media | News first, social media second. Moved to Should have, with early warning and reaction treated separately. | 5, 7 |
| 10 | Indirect impact | The core hypothesis to test. Mock it for the sessions. Vendors are the first route; geographic and sector exposure come later. Superseded by 15. | 5, 7 |
| 11 | Data sources | "Data sources are key", and internal data in particular, is a hypothesis on hold (KIV) to break down further. | 5 |
| 12 | Relationships | Every link needs a type. Relationships appear as small graph snippets backing a claim. Free exploration of the full graph and the event view are Could haves, most useful to TCRD. | 6, 7 |
| 13 | Testing | Do not explain during the session; give the real answer at the end. | 11 |
| 14 | Prototype | Remove or hide features outside the Must haves, use one status vocabulary, and never cut off a finding. | 12 |
| 15 | Indirect impact | Indirect impact is a key Phase 1 feature, since it is USP point 2. Exposure, dependency and structure relationships, collected from public sources, move to Must have; geographic and sector exposure is no longer a Could have. The sessions use real public data instead of a mock. | 5, 7, 8, 10 |
| 16 | Adverse news | Replaces an earlier definition from a misread transcript. Adverse marks the cause of harm to the entity: events at it (downtime, fraud) and harmful trends or changes that bear directly on it (fraud cases rising, a rule that raises its costs). Commentary, outlooks, market reactions and follow-up reporting are not adverse, even when negative in tone. The original failure: DBS economists' negative 2026 outlook was tagged adverse for DBS. Promotional news gets the lowest priority. | 7, 8, 12 |
