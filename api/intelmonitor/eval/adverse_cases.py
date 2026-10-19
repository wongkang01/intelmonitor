"""Gold cases for the adverse flag (prd.md section 8, decision W7), set by hand: a short made-up
article per case goes through the real extraction prompt and verification (one Claude call each),
and each checked subject's role, adverse flag and tone are compared with the expected ones.

- DBS economists forecasting slower growth make DBS a commentator, not adverse, and the forecast
  is not adverse for Singapore either.
- DBS shares falling after an outage is a reaction, not adverse.
- Digital banking down for five hours is adverse to DBS.
- Phishing scams against DBS customers doubling is adverse to DBS.
- Higher MAS capital requirements for D-SIBs are adverse to DBS, OCBC and UOB, tone negative.
- A 9% profit rise is not adverse to DBS, tone positive.

The cases run in their own store, eval-runs/.../db/adverse.db, so the app's store is never
touched and repeat runs replay the recorded calls:
`uv run python -m intelmonitor.eval adverse`. Writes adverse_cases.json in the eval directory."""

import json
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from intelmonitor.eval.common import EVAL_DIR
from intelmonitor.pipeline.extract import (
    EXTRACT_SYSTEM,
    Extraction,
    Finding,
    Role,
    Tone,
    extract_prompt,
    verify,
)
from intelmonitor.pipeline.inference import Inference
from intelmonitor.store.db import connect
from intelmonitor.store.documents import SourceDocument

STORE = EVAL_DIR / "db" / "adverse.db"


class Expected(BaseModel):
    roles: list[Role] = Field(description="Any of these roles passes")
    adverse: bool
    tone: Tone | None = None


class AdverseExtractionCase(BaseModel):
    id: str
    title: str
    text: str
    subjects: list[str] = Field(description="The subjects screening tagged, listed in the prompt")
    match: list[str] = Field(
        default_factory=list[str],
        description="Text the statement of the finding under test contains; empty: every finding",
    )
    expected: dict[str, Expected] = Field(
        description="Subject id: what every matching finding that involves it must say; at "
        "least one must involve it"
    )
    reason: str


ANY_ROLE: list[Role] = ["affected", "actor", "commentator", "mentioned"]

CASES = [
    AdverseExtractionCase(
        id="dbs-economists-outlook",
        title="DBS economists cut Singapore's 2026 growth forecast on the Middle East crisis",
        text="DBS Group Research economists on Oct 6 cut their forecast for Singapore's 2026 "
        "economic growth to 1.8 per cent from 2.4 per cent, saying the Middle East crisis will "
        'keep oil prices high and weigh on trade in the coming quarters. "Risks to the outlook '
        'remain tilted to the downside," the economists wrote in a note to clients. They expect '
        "manufacturing and trade-related services to slow most.",
        subjects=["dbs", "singapore"],
        expected={
            "dbs": Expected(roles=["commentator"], adverse=False),
            "singapore": Expected(roles=ANY_ROLE, adverse=False),
        },
        reason="An outlook from the bank's own economists describes harm caused elsewhere; DBS "
        "only comments on it, and a forecast is not adverse for the country either",
    ),
    AdverseExtractionCase(
        id="dbs-shares-after-outage",
        title="DBS shares slip as investors weigh digital banking outage",
        text="DBS shares fell 2 per cent to $38.10 on Tuesday, the worst performer among the "
        "three local banks, as investors weighed Monday's disruption to its digital banking "
        "services, which the bank has since restored. Analysts at Maybank Securities said the "
        "sell-off was an overreaction and kept their buy call on the stock.",
        subjects=["dbs"],
        match=["share", "2 per cent", "2%"],
        expected={"dbs": Expected(roles=ANY_ROLE, adverse=False)},
        reason="A share move after the outage is a market reaction; the outage finding is the "
        "adverse one",
    ),
    AdverseExtractionCase(
        id="dbs-digital-banking-down",
        title="DBS digital banking down for five hours",
        text="DBS and POSB customers could not log in to digibank or make PayNow transfers for "
        "about five hours on Oct 5, the bank said, after a fault in a data centre system. "
        "Services were restored at about 3pm. DBS apologised to customers and said it would "
        "investigate the cause and report to the Monetary Authority of Singapore.",
        subjects=["dbs", "tech-outages"],
        expected={"dbs": Expected(roles=["affected"], adverse=True)},
        reason="An outage at the bank is the cause of harm to it",
    ),
    AdverseExtractionCase(
        id="dbs-phishing-doubled",
        title="Phishing scams targeting DBS customers double",
        text="Phishing scams targeting DBS customers doubled in the third quarter, with 1,240 "
        "cases reported against 610 in the previous three months, the police said on Oct 6. "
        "Victims lost at least $8.2 million after clicking on links in fake SMS messages that "
        "impersonated the bank. DBS said it is blocking the fake sites and reminded customers "
        "never to share one-time passwords.",
        subjects=["dbs", "cyber-threats"],
        expected={"dbs": Expected(roles=["affected"], adverse=True)},
        reason="A harmful trend that bears directly on the bank's customers is adverse to it",
    ),
    AdverseExtractionCase(
        id="mas-dsib-capital",
        title="MAS raises capital requirements for D-SIBs from 2027",
        text="The Monetary Authority of Singapore said on Oct 7 it will raise the additional "
        "capital buffer for domestic systemically important banks by one percentage point from "
        "Jan 1, 2027. DBS, OCBC and UOB, the three banks designated as D-SIBs, will have to hold "
        "more common equity against their risk-weighted assets, which analysts said could "
        "limit dividend growth.",
        subjects=["mas", "dbs", "ocbc", "uob", "banking-regulation"],
        expected={
            "mas": Expected(roles=["actor"], adverse=False),
            **{
                bank: Expected(roles=["affected"], adverse=True, tone="negative")
                for bank in ("dbs", "ocbc", "uob")
            },
        },
        reason="A new rule that raises the banks' costs bears directly on each of them",
    ),
    AdverseExtractionCase(
        id="dbs-profit-rise",
        title="DBS third-quarter net profit rises 9%",
        text="DBS reported third-quarter net profit of $3.1 billion on Oct 7, up 9 per cent from "
        "a year earlier, as wealth management fees and trading income rose. Return on equity "
        "was 18.2 per cent, and the bank kept its full-year guidance.",
        subjects=["dbs"],
        expected={"dbs": Expected(roles=["affected"], adverse=False, tone="positive")},
        reason="Good news is never adverse",
    ),
]


class AdverseCaseResult(BaseModel):
    id: str
    ok: bool
    problems: list[str]
    findings: list[str] = Field(description="Every finding, with its roles")
    reason: str


def _document(case: AdverseExtractionCase) -> SourceDocument:
    published = datetime(2026, 10, 7, tzinfo=UTC)
    return SourceDocument(
        id=f"case-{case.id}",
        source="eval",
        collection="news",
        doc_type="news",
        classification="public",
        url=f"https://example.com/{case.id}",
        canonical_url=f"https://example.com/{case.id}",
        domain="example.com",
        title=case.title,
        published_at=published,
        text=f"{case.title}\n\n{case.text}",
        content_hash=case.id,
        ingested_at=published,
    )


def check(case: AdverseExtractionCase, findings: list[Finding]) -> list[str]:
    words = [m.lower() for m in case.match]

    def matches(f: Finding) -> bool:
        return not words or any(w in f.statement.lower() for w in words)

    problems: list[str] = []
    tested = [f for f in findings if matches(f)]
    for sid, want in case.expected.items():
        involved = [(f, f.roles[sid]) for f in tested if sid in f.roles]
        if not involved:
            problems.append(f"no matching finding involves {sid}")
        for f, got in involved:
            if got.role not in want.roles:
                problems.append(f"{f.id}: {sid} is {got.role}, expected {' or '.join(want.roles)}")
            if got.adverse != want.adverse:
                problems.append(f"{f.id}: {sid} adverse is {got.adverse}")
            if want.tone and got.tone != want.tone:
                problems.append(f"{f.id}: {sid} tone is {got.tone}, expected {want.tone}")
    return problems


def _described(f: Finding) -> str:
    roles = ", ".join(
        f"{s} {r.role}{' adverse' if r.adverse else ''} {r.tone}" for s, r in f.roles.items()
    )
    return f"{f.id} [{roles}]: {f.statement}"


async def run() -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect(STORE)
    inf = Inference(conn, "eval-adverse")
    results: list[AdverseCaseResult] = []
    for case in CASES:
        doc = _document(case)
        extraction = await inf.claude(
            "extract",
            f"doc:{doc.id}",
            extract_prompt(doc, case.subjects),
            Extraction,
            EXTRACT_SYSTEM,
        )
        findings = verify(doc, set(case.subjects), extraction)
        problems = check(case, findings)
        results.append(
            AdverseCaseResult(
                id=case.id,
                ok=not problems,
                problems=problems,
                findings=[_described(f) for f in findings],
                reason=case.reason,
            )
        )
    (EVAL_DIR / "adverse_cases.json").write_text(
        json.dumps([r.model_dump() for r in results], indent=2)
    )
    lines = [
        f"Adverse cases ({inf.calls} Claude calls, {inf.cache_hits} replayed)",
        "",
        "| Case | Result | Findings | Problems |",
        "|---|---|---|---|",
    ]
    lines += [
        f"| {r.id} | {'pass' if r.ok else 'FAIL'} | {'<br>'.join(r.findings) or 'none'} | "
        f"{'; '.join(r.problems)} |"
        for r in results
    ]
    print("\n".join(lines))
