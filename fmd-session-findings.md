# FMD user session findings

14 October 2026. Shared doc: https://claude.ai/code/artifact/3bbda81a-d691-4055-be1f-29ad9d3bd8b5

## Summary

The participant would not use IntelMonitor in its current form.
He works on sovereign wealth funds and tax incentives, not supervised entities, and found the pages too detailed for someone who checks occasionally.

He pointed us to FPS (Financial Products and Solutions), which covers SGX, FX and markets, as the likely FMD users.
FPS is the next interview.

Several points still apply beyond his role: the brief headline did not match its sources, the weekly cadence was not obvious, "High" was read as popularity, and single-source items were not trusted.

Session on 12 October 2026 with Ethan (FMD Funds team).
Interviewers: Kang Wong, Ella (DKP), Sheena (EKD design).
Sources: interview notes (`fmdinterview.md`) and the Otter transcript, which covers the session up to the end of Task A.

## Participant and current workflow

Most of his week is internal tax work.
External research happens only before sovereign wealth fund meetings, about two or three a quarter.

| Area | What he does | Tools |
| --- | --- | --- |
| Tax incentives (main work) | Processes applications; answers withholding tax and DTA questions from tax advisers and funds | Shared team mailbox back to 2016, Copilot |
| SWF briefs (occasional) | Briefs MD level before meetings with funds planning a Singapore presence: target asset classes, Singapore and APAC interest, AUM, headcount | Global SWF (paid, with its own AI search), Copilot, Google |

Pain points he named:

- Recent, Singapore-specific activity for a fund is hard to find.
  Last week he used an India investment that turned out to be 10 years old, and only noticed after writing the brief.
- Compiling the brief takes the most time.
- Tax advisers repeat questions already answered in the mailbox.
  Copilot often fails to find the earlier replies.
- Integration with MAS systems such as the tax schemes portal and JIPS would help his team more than a news dashboard.

## Feedback on the product

He understood the dashboard's purpose at first look, but the detail overwhelmed him and several labels were misread.

| Part | What he did or said |
| --- | --- |
| First look | Read it correctly: "bird's-eye view of recent trends, comparison of three local banks". Switched to All time and High priority to see the big trends. |
| First look | Did not realise the data updates weekly, or that everything was as of 8 October. Did not see how Top differs from Recent. |
| First look | Read High priority as how much a story is talked about: front page, breaking news, online reaction. It means significance for the entity. |
| First look | Said all-time view mixes in short-term moves, such as a share price drop, that do not reflect the overall trend. |
| Task A: weekly brief | Reframed it as "brief your director on Canadian pension funds this week": he would look across a group, not one entity. |
| Task A | Would copy every entity tab into Copilot and ask for one summary, for lack of time. |
| Task A | Was surprised by the development popup and did not see how the Overview differs from the Developments tab. |
| Task A | The brief headline did not match its sources: RHB and the "1 million" item appear in the sources but not the summary. Too many sources for a new user. |
| Task A | "No material developments at UOB this week" is a sweeping statement. It could hold for one asset class and not another. |
| Task A | Finds Copilot's source count sufficient because it shows the websites it used. |
| Task B: gaining or losing ground | No direct comparison page. Would use Ctrl+F for Singapore on the Hong Kong page and the reverse. |
| Task C: a link between events | Found the item through search; did not use the Related tab. Found the links to bank loans helpful. |
| Task C | Would avoid The Star as a source. One source raises doubts; he wants at least three before trusting an item. |
| Fit and value | Would not use it now. Too detailed for his needs. Expects FPS to find it useful. |

## What he would want instead

His asks centre on less detail, a group view and comparisons across countries and asset classes.

- **Group summary.** One summary across a set of entities (all Canadian pension funds, or all three local banks), instead of one per entity.
- **Asset class breakdown.** Real estate, private equity, public markets and equities.
  He says these categories are fairly standard across FMD.
  They support the pitch that Singapore is a good place for a fund's target asset class.
- **Adverse watch list.** Questionable investments with negative public reaction, office closures, and allegations of liquidation or bankruptcy.
  Used as a watch-area section in a brief, to judge the risk of inviting an entity to Singapore.
- **Trends.** A high-level change such as "fund X raised its real estate allocation by Y% and invested in these regions".
  He said the bold headlines come close.
- **Country comparison.** Drag and drop two jurisdictions, such as Singapore and Hong Kong, including currency.
  Indicators: AUM, number of asset managers, real assets, REITs, data centres and infrastructure, global MNC presence, and investment headcount in Singapore and APAC offices.
- **Brief drafting.** Update an existing brief template with the latest figures, and flag what contradicts or matches past briefs.
- **SWF coverage.** It would only fit his role if it covered sovereign wealth funds with head-to-head comparisons, which needs data like Global SWF's.

## Team discussion after the session

The team questioned whether a static dashboard is the right end product.

- **Overload.** Simplify the interface, or let each role customise its view: TCRD on technology and cyber, FMD on markets.
- **Where the value is.** In presenting data, or in surfacing links between events and entities that a Google or Copilot search does not find.
- **Five-minute value.** Lead with cross-cutting items, such as adverse and High priority developments, so a quick visitor still gets something.
- **Deliverables.** Move towards the output users produce, such as generated briefs, rather than a dashboard they must read.

## Actions and next steps

The first five are small fixes that help any user.
The rest are new scope and should wait for the FPS interview.

| Finding | Proposed action | Type |
| --- | --- | --- |
| Weekly cadence and data date not obvious | Show "Week to 8 Oct" in the top bar or brief header | Quick fix |
| Top vs Recent, Overview vs Developments unclear | Clearer labels and help text | Quick fix |
| Brief headline does not match its sources | Show only the developments behind each headline line, or group sources under the line they support | Quick fix |
| High priority read as popularity | Tooltip saying High means significance for the entity | Quick fix |
| Single-source items not trusted | Show the source count on each development; consider source allow and block lists | Quick fix |
| Group summary across entities | Check whether group pages already show a group brief, and make it the starting point | To check |
| Asset class breakdown, SWF coverage, country comparison, brief drafting | Wait for FPS before deciding | New scope |

- [ ] Interview FPS about how often they monitor markets and which figures they track
- [ ] Decide which quick fixes go in before the TCRD session
