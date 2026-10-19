"""Gold cases for extraction roles, adverse and priority (phase1-plan.md, item A), set by hand from
prd.md rather than built by Opus: the three DBS findings behind the Adverse answer of the week in
section 9, none adverse to DBS and the share move Low, and the Swiss vote on UBS capital from
section 12, not High for the Singapore banks. The adverse flag's own cases, run through the
extraction prompt, are in adverse_cases.py.

Checked against a store's latest complete run, read only and with no model calls, the app's store
by default: `uv run python -m intelmonitor.eval cases [store path]`. The run must have been
computed with roles. Writes cases.json in the eval directory."""

import json
import sqlite3
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.eval.common import EVAL_DIR
from intelmonitor.pipeline.params import PRIORITY_LABELS
from intelmonitor.store.db import DB_PATH

Priority = Literal["High", "Medium", "Low"]


class AdverseCase(BaseModel):
    """A finding that must not be adverse to the subject, nor make its development adverse."""

    id: str
    document_ids: list[str]
    match: list[str] = Field(description="Text the finding's statement or a quote contains")
    subject_id: str
    reason: str


class PriorityCase(BaseModel):
    """A development whose priority must not pass `highest` for the subjects, or for any of its
    subjects when none are given."""

    id: str
    document_ids: list[str]
    match: list[str] = Field(description="Empty: any finding of the documents")
    subject_ids: list[str]
    highest: Priority
    reason: str


# The Straits Times market wrap of 20 September is stored twice, under two URLs, and the extraction
# may put a statement in either copy.
_ST_WRAP = ["0bcf9d2a967ec327", "1530c1f6f8a5346d"]

ADVERSE_CASES = [
    AdverseCase(
        id="dbs-economists-middle-east",
        document_ids=_ST_WRAP,
        match=["Middle East"],
        subject_id="dbs",
        reason="DBS economists' view on the Middle East crisis is commentary, not the cause of "
        "harm to DBS",
    ),
    AdverseCase(
        id="dbs-share-move",
        document_ids=_ST_WRAP,
        match=["76.86"],
        subject_id="dbs",
        reason="A 0.18% share move in a weekly market wrap is a market reaction, not adverse",
    ),
    AdverseCase(
        id="dbs-profit-rise",
        document_ids=["15318a0fa093f5ba", "8a3ae517d4e1e649"],
        match=["9 per cent", "9%"],
        subject_id="dbs",
        reason="A 9% rise in quarterly net profit is good news, not adverse",
    ),
]

PRIORITY_CASES = [
    PriorityCase(
        id="dbs-share-move-low",
        document_ids=_ST_WRAP,
        match=["76.86"],
        subject_ids=[],
        highest="Low",
        reason="A 0.18% share move in a weekly market wrap is routine",
    ),
    PriorityCase(
        id="ubs-capital-vote",
        document_ids=["ed7d0023d140a394"],
        match=[],
        subject_ids=["dbs", "ocbc", "uob"],
        highest="Medium",
        reason="A Swiss parliamentary vote on UBS's capital rules has no route to the Singapore "
        "banks",
    ),
]


class CaseResult(BaseModel):
    id: str
    run_id: str
    ok: bool
    findings: list[str] = Field(description="The matching findings, with their roles")
    detail: str
    reason: str


def _matching(
    conn: sqlite3.Connection, document_ids: list[str], match: list[str]
) -> list[sqlite3.Row]:
    rows = conn.execute(
        f"SELECT * FROM findings WHERE document_id IN ({', '.join('?' for _ in document_ids)}) "
        "ORDER BY id",
        document_ids,
    ).fetchall()
    words = [m.lower() for m in match]

    def text(r: sqlite3.Row) -> str:
        return " ".join([r["statement"], *(q["text"] for q in json.loads(r["quotes"]))]).lower()

    return [r for r in rows if not words or any(w in text(r) for w in words)]


def _development(conn: sqlite3.Connection, run_id: str, finding_id: str) -> str | None:
    row = conn.execute(
        "SELECT development_id FROM development_sources WHERE run_id = ? AND finding_id = ?",
        (run_id, finding_id),
    ).fetchone()
    return None if row is None else str(row["development_id"])


def _subjects(conn: sqlite3.Connection, run_id: str, development_id: str) -> dict[str, sqlite3.Row]:
    return {
        r["subject_id"]: r
        for r in conn.execute(
            "SELECT * FROM development_subjects WHERE run_id = ? AND development_id = ?",
            (run_id, development_id),
        )
    }


def _described(r: sqlite3.Row) -> str:
    return f"{r['id']} {r['roles']}: {r['statement']}"


def check_adverse(conn: sqlite3.Connection, run_id: str, case: AdverseCase) -> CaseResult:
    found = _matching(conn, case.document_ids, case.match)
    adverse: list[str] = []
    for r in found:
        role = json.loads(r["roles"]).get(case.subject_id)
        if role and role["adverse"]:
            adverse.append(f"finding {r['id']} is adverse to {case.subject_id}")
        dev = _development(conn, run_id, r["id"])
        linked = _subjects(conn, run_id, dev).get(case.subject_id) if dev else None
        if linked is not None and linked["adverse"]:
            adverse.append(f"development {dev} is adverse to {case.subject_id}")
    return CaseResult(
        id=case.id,
        run_id=run_id,
        ok=not adverse,
        findings=[_described(r) for r in found],
        detail="; ".join(adverse) or ("not adverse" if found else "no matching finding"),
        reason=case.reason,
    )


def check_priority(conn: sqlite3.Connection, run_id: str, case: PriorityCase) -> CaseResult:
    found = _matching(conn, case.document_ids, case.match)
    allowed = max(i for i, label in enumerate(PRIORITY_LABELS) if label == case.highest)
    levels: list[str] = []
    over: list[str] = []
    for dev in dict.fromkeys(d for r in found if (d := _development(conn, run_id, r["id"]))):
        for sid, s in _subjects(conn, run_id, dev).items():
            label = PRIORITY_LABELS[int(s["priority_level"])]
            levels.append(f"{dev} {sid}: {label} ({s['role']})")
            if (not case.subject_ids or sid in case.subject_ids) and s["priority_level"] > allowed:
                over.append(f"{dev} is {label} for {sid}")
    return CaseResult(
        id=case.id,
        run_id=run_id,
        ok=bool(found) and not over,  # a case with nothing to check must not pass
        findings=[_described(r) for r in found],
        detail="; ".join(over or levels) or ("no subjects" if found else "no matching finding"),
        reason=case.reason,
    )


def _scored(conn: sqlite3.Connection, run_id: str) -> bool:
    """Whether the run's findings carry roles, so its developments were scored per subject."""
    roles = "SELECT 1 FROM pragma_table_info('findings') WHERE name = 'roles'"
    return (
        conn.execute(roles).fetchone() is not None
        and conn.execute(
            "SELECT 1 FROM development_sources s JOIN findings f ON f.id = s.finding_id "
            "WHERE s.run_id = ? AND f.roles != '{}' LIMIT 1",
            (run_id,),
        ).fetchone()
        is not None
    )


def run(path: Path = DB_PATH) -> None:
    # Read only, so opening a snapshot from before roles and priority does not migrate it.
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id FROM runs WHERE status = 'complete' ORDER BY as_of DESC LIMIT 1"
    ).fetchone()
    if row is None:
        raise SystemExit(f"no complete run in {path}")
    run_id = str(row["id"])
    if not _scored(conn, run_id):
        raise SystemExit(f"run {run_id} of {path} predates roles and per-subject priority")
    results = [check_adverse(conn, run_id, c) for c in ADVERSE_CASES]
    results += [check_priority(conn, run_id, c) for c in PRIORITY_CASES]
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    (EVAL_DIR / "cases.json").write_text(json.dumps([r.model_dump() for r in results], indent=2))
    lines = [
        f"Gold cases on run {run_id} of {path}",
        "",
        "| Case | Result | Detail |",
        "|---|---|---|",
    ]
    lines += [f"| {r.id} | {'pass' if r.ok else 'FAIL'} | {r.detail} |" for r in results]
    print("\n".join(lines))
