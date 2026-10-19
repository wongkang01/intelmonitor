"""Gold cases for the impact step (phase1-plan.md, item I), set by hand: a made-up development per
case goes through the real step (relationship store, candidates, routes, one Claude call) and the
affected entities, their order and their evidence grades are checked.

- A BCS outage reaches the FAST banks.
- Hong Kong property news reaches DBS, OCBC and UOB in order of weight, direct links first.
- Singapore home prices reach DBS, OCBC and UOB through their housing loans, never through their
  Singapore loans: a bank's home country is no exposure route.
- A MAS rule reaches no bank: not through its Singapore loans (home, and loans carry only
  economic and market news), nor through supervision.
- An HKMA rule reaches DBS and OCBC through their Hong Kong subsidiaries, and not UOB through its
  Greater China loans: a regulator's rule binds the units in its place, not the lenders to it.
- An Azure outage reaches OCBC, and a Microsoft 365 outage reaches DBS, the banks whose links the
  store holds, each with that link's evidence grade (replaces the Maybank case, decision S2).
- An AWS product launch reaches nobody: a link alone is not an impact.

The cases run in their own store, eval-runs/.../db/impact.db, synced from
api/seed/relationships.yaml, so the app's store is never touched and repeat runs replay the
recorded calls:
`uv run python -m intelmonitor.eval impact`. Writes impact_cases.json in the eval directory."""

import json
from datetime import date

from pydantic import BaseModel, Field

from intelmonitor.eval.common import EVAL_DIR
from intelmonitor.pipeline.impact import Impact, ImpactInput, SourceFinding, judge
from intelmonitor.pipeline.inference import Inference
from intelmonitor.pipeline.screen import Category
from intelmonitor.relationships import Evidence, Relationship, sync_relationships
from intelmonitor.store.db import connect

STORE = EVAL_DIR / "db" / "impact.db"


class ImpactCase(BaseModel):
    id: str
    title: str
    category: Category
    targets: dict[str, str] = Field(description="Subject id: role")
    findings: list[str]
    affected: list[str] = Field(description="Must be affected; in this order when `ordered`")
    ordered: bool = False
    not_affected: list[str] = Field(default_factory=list[str])
    routes: dict[str, str] = Field(
        default_factory=dict[str, str], description="Subject id: text its route must contain"
    )
    link_evidence: dict[str, str] = Field(
        default_factory=dict[str, str],
        description="Subject id: relationship id whose evidence grade the impact must carry",
    )
    reason: str


CASES = [
    ImpactCase(
        id="bcs-outage-fast-banks",
        title="A system outage at Banking Computer Services halted FAST and GIRO transfers",
        category="incident",
        targets={"bcs": "affected"},
        findings=[
            "Banking Computer Services, which operates the FAST and GIRO clearing systems, had a "
            "system outage on 2 October 2026 that left FAST transfers failing for about four "
            "hours across Singapore banks.",
            "Customers of several banks reported failed PayNow and FAST payments during the "
            "outage, and GIRO deductions were delayed to the next day.",
        ],
        affected=["dbs", "ocbc", "uob"],
        reason="DBS, OCBC and UOB take part in FAST and GIRO, which depend on BCS",
    ),
    ImpactCase(
        id="hong-kong-property-three-banks",
        title="Hong Kong home prices posted their sharpest monthly fall since 2008",
        category="market",
        targets={"hong-kong": "affected", "building-construction": "affected"},
        findings=[
            "Hong Kong home prices fell 4.1 per cent in September 2026, the sharpest monthly drop "
            "since 2008, as higher interest rates and a supply glut weighed on demand.",
            "Office and retail property values in Hong Kong fell a further 6 per cent in the "
            "quarter, and developers cut prices on new launches.",
        ],
        affected=["dbs", "ocbc", "uob"],
        ordered=True,
        routes={"dbs": "Hong Kong", "ocbc": "Hong Kong", "uob": "Greater China"},
        reason="Hong Kong loans are 12.2% of DBS's and 9.3% of OCBC's; UOB reports only Greater "
        "China (13.5%), a region-level figure ranked after the direct links (D5b)",
    ),
    ImpactCase(
        id="azure-outage-ocbc",
        title="A Microsoft Azure outage in Southeast Asia took down hosted services for hours",
        category="incident",
        targets={"microsoft-azure": "affected"},
        findings=[
            "Microsoft Azure's Southeast Asia region had a major outage on 5 October 2026, taking "
            "down compute and storage services for customers for about six hours.",
        ],
        affected=["ocbc"],
        link_evidence={"ocbc": "ocbc:depends_on:microsoft-azure"},
        reason="OCBC's stored cloud dependency is on Azure",
    ),
    ImpactCase(
        id="m365-outage-dbs",
        title="A global Microsoft 365 outage cut off email, Teams and Outlook for most of a day",
        category="incident",
        targets={"microsoft-365": "affected"},
        findings=[
            "A global Microsoft 365 outage on 6 October 2026 left enterprise users unable to use "
            "Outlook, Teams and Exchange Online for about nine hours.",
        ],
        affected=["dbs"],
        link_evidence={"dbs": "dbs:depends_on:microsoft-365"},
        reason="DBS's stored dependency is on Microsoft 365, not Azure (decision S9)",
    ),
    ImpactCase(
        id="aws-launch-no-impact",
        title="AWS launched a new AI model hosting service",
        category="strategy",
        targets={"aws": "actor"},
        findings=[
            "Amazon Web Services launched a managed service for hosting large AI models on "
            "7 October 2026, available first in its US regions.",
        ],
        affected=[],
        not_affected=["dbs", "uob", "singtel"],
        reason="A product launch does not flow through a bank's cloud dependency",
    ),
    ImpactCase(
        id="singapore-home-prices-housing-loans",
        title="Singapore private home prices fell for a second quarter",
        category="market",
        targets={"singapore": "affected", "housing": "affected"},
        findings=[
            "Singapore private home prices fell 3.2 per cent in the third quarter of 2026, a "
            "second quarterly decline, as new launches went unsold and mortgage rates stayed "
            "high.",
            "HDB resale prices were flat in the quarter, and developers cut prices at several "
            "new condominium launches.",
        ],
        affected=["dbs", "ocbc", "uob"],
        routes={"dbs": "housing", "ocbc": "housing", "uob": "housing"},
        reason="Housing is 17.8% of DBS's loans, 20.7% of OCBC's and 23.8% of UOB's; their "
        "Singapore loans are home exposures and carry no impact",
    ),
    ImpactCase(
        id="mas-rule-no-bank",
        title="MAS consulted on revised corporate governance guidelines for financial institutions",
        category="regulatory",
        targets={"mas": "actor", "singapore": "affected"},
        findings=[
            "The Monetary Authority of Singapore on 6 October 2026 published a consultation on "
            "revised corporate governance guidelines for banks, insurers and capital markets "
            "firms in Singapore, including board independence and risk committee rules.",
        ],
        affected=[],
        not_affected=["dbs", "ocbc", "uob"],
        reason="Singapore is the banks' home, and loans carry no regulatory news; MAS's own "
        "rules reach a bank only when extraction names it",
    ),
    ImpactCase(
        id="hkma-rule-hong-kong-units",
        title="HKMA raised capital requirements on property lending by Hong Kong banks",
        category="regulatory",
        targets={"hkma": "actor", "hong-kong": "affected"},
        findings=[
            "The Hong Kong Monetary Authority on 6 October 2026 raised risk weights on commercial "
            "real estate loans for all authorized institutions in Hong Kong, effective January "
            "2027, requiring banks there to hold more capital against property lending.",
        ],
        affected=["dbs", "ocbc"],
        not_affected=["uob"],
        routes={"dbs": "operates in Hong Kong", "ocbc": "operates in Hong Kong"},
        reason="DBS and OCBC own Hong Kong banks the rule binds; UOB's only link is its Greater "
        "China loans, which carry no regulatory news",
    ),
]


class ImpactCaseResult(BaseModel):
    id: str
    ok: bool
    problems: list[str]
    impacts: list[dict[str, object]]
    reason: str


def _input(case: ImpactCase) -> ImpactInput:
    """The case as a development at Significant (High) for its targets."""
    return ImpactInput(
        id=f"case-{case.id}",
        title=case.title,
        category=case.category,
        targets={s: (role, 3) for s, role in case.targets.items()},
        findings=[
            SourceFinding(
                id=f"case-{case.id}-{n}",
                statement=text,
                quote=text,
                document_id="",
                domain="example.com",
                published=date(2026, 10, 7).isoformat(),
            )
            for n, text in enumerate(case.findings)
        ],
    )


def check(case: ImpactCase, impacts: list[Impact], links: dict[str, Relationship]) -> list[str]:
    by_subject = {i.subject_id: i for i in impacts}
    problems = [f"{s} not affected" for s in case.affected if s not in by_subject]
    problems += [f"{s} affected" for s in case.not_affected if s in by_subject]
    if case.ordered:
        order = [i.subject_id for i in impacts if i.subject_id in case.affected]
        if order != case.affected:
            problems.append(f"order {order}, expected {case.affected}")
    for s, text in case.routes.items():
        if s in by_subject and text not in by_subject[s].route:
            problems.append(f"{s} route {by_subject[s].route!r} lacks {text!r}")
    for s, rel_id in case.link_evidence.items():
        if s not in by_subject:
            continue
        impact = by_subject[s]
        expected: Evidence = links[rel_id].evidence
        if rel_id not in impact.path.relationship_ids:
            problems.append(f"{s} route rests on {impact.path.relationship_ids}, not {rel_id}")
        if impact.path.evidence != expected:
            problems.append(f"{s} evidence {impact.path.evidence}, link has {expected}")
    return problems


async def run() -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect(STORE)
    data = sync_relationships(conn)
    links = {r.id: r for r in data.relationships}
    inf = Inference(conn, "eval-impact")
    results: list[ImpactCaseResult] = []
    for case in CASES:
        impacts = await judge(inf, conn, _input(case))
        problems = check(case, impacts, links)
        results.append(
            ImpactCaseResult(
                id=case.id,
                ok=not problems,
                problems=problems,
                impacts=[
                    {
                        "subject": i.subject_id,
                        "direction": i.direction,
                        "route": i.route,
                        "why": i.why,
                        "confidence": i.confidence,
                        "evidence": i.path.evidence,
                        "relationship_ids": i.path.relationship_ids,
                    }
                    for i in impacts
                ],
                reason=case.reason,
            )
        )
    (EVAL_DIR / "impact_cases.json").write_text(
        json.dumps([r.model_dump() for r in results], indent=2)
    )
    lines = [
        f"Impact cases ({inf.calls} Claude calls, {inf.cache_hits} replayed)",
        "",
        "| Case | Result | Affected, in order | Problems |",
        "|---|---|---|---|",
    ]
    lines += [
        f"| {r.id} | {'pass' if r.ok else 'FAIL'} | "
        f"{', '.join(str(i['subject']) for i in r.impacts) or 'none'} | "
        f"{'; '.join(r.problems)} |"
        for r in results
    ]
    print("\n".join(lines))
