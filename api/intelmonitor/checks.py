"""`im check depeg`: the peg rule and the depeg detector fired on fixture prices in a scratch
store, through the pipeline's own steps, with no model calls or network.

No stored price breaches a peg (structured-data-plan.md, F2 and F3), so the walkthrough runs this
to see both firing paths: USDC more than 0.5% below its peg for 48 hours makes the Peg answer
Needs attention whatever the model says, and the depeg detector's event becomes a development of
its own at the rule's materiality.
"""

import json
import re
import sqlite3
import tempfile
from collections.abc import Mapping
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

from intelmonitor.ingest.series.derive import derive
from intelmonitor.pipeline.answers import SubjectAnswers, answer_subject, load_run_developments
from intelmonitor.pipeline.detectors import store_detections
from intelmonitor.pipeline.developments import build_developments
from intelmonitor.pipeline.facts import FixedState, subject_facts
from intelmonitor.pipeline.inference import Inference, JevAnswers, JevQuestion
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.seed import Deviation, load_series
from intelmonitor.store.db import connect, set_meta
from intelmonitor.store.series import Observation, save_observations, sync_catalogue

AS_OF = date(2026, 9, 10)
SUBJECT = "circle"
PRICE, PEG = "cg.usdc.price", "derived.usdc.peg"
# 60 days at the peg, then three days 0.70%, 0.85% and 0.75% below it: a 48-hour spell.
BREACH = [0.9930, 0.9915, 0.9925]


class ModelCallError(RuntimeError):
    pass


class CannedAnswers(Inference):
    """Answers every question Stable with no sources, as a model that missed the depeg would, so
    only a rule can raise the Peg state. Any other model call fails the check."""

    async def jev(
        self,
        stage: str,
        input_ref: str,
        state: str,
        questions: Mapping[str, JevQuestion],
        confidence_of: str | None = None,
    ) -> JevAnswers:
        raise ModelCallError(f"the check made a Jev call: {stage} {input_ref}")

    async def claude[T: BaseModel](
        self, stage: str, input_ref: str, prompt: str, schema: type[T], system: str
    ) -> T:
        if schema is not SubjectAnswers:
            raise ModelCallError(f"the check made a Claude call: {stage} {input_ref}")
        ids = re.findall(r"^- question_id: (\S+)$", prompt, re.MULTILINE)
        return schema.model_validate(
            {
                "answers": [
                    {
                        "question_id": i,
                        "summary": "No peg deviation or redemption pressure reported.",
                        "state": "stable",
                        "development_ids": [],
                        "series_ids": [],
                    }
                    for i in ids
                ]
            }
        )


class CheckedDevelopment(BaseModel):
    title: str
    materiality_label: str
    needs_attention: bool
    sources: int


class CheckedAnswer(BaseModel):
    question_id: str
    state: str
    summary: str
    state_rules: list[str]


class DepegCheck(BaseModel):
    as_of: date
    prices: list[Observation] = Field(description="The fixture: USDC's daily price in USD")
    detections: list[str] = Field(description="The detection documents' sentences")
    developments: list[CheckedDevelopment]
    fixed_states: list[FixedState]
    peg: CheckedAnswer = Field(description="The stored Peg answer, after the rules")


def _prices() -> list[Observation]:
    days = [AS_OF - timedelta(days=n) for n in reversed(range(63))]
    values = [1.0] * (len(days) - len(BREACH)) + BREACH
    return [
        Observation(period=d, value=v, available_at=datetime.combine(d, time(), UTC))
        for d, v in zip(days, values, strict=True)
    ]


async def depeg_check(store: Path | None = None) -> DepegCheck:
    """Runs the detectors, the development merge and the answer step over the fixture prices in a
    scratch store (a new temporary file unless `store` is given)."""
    path = store or Path(tempfile.mkdtemp(prefix="im-check-")) / "check.db"
    conn = connect(path)
    seed = load_series()
    sync_catalogue(conn, seed)
    set_meta(conn, "t0", AS_OF.isoformat())
    by_id = {s.id: s for s in seed.series}
    peg_source = by_id[PEG].source
    assert isinstance(peg_source, Deviation)
    fetched = datetime.now(UTC)
    prices = _prices()
    save_observations(conn, PRICE, by_id[PRICE].decimals, prices, fetched)
    save_observations(conn, PEG, by_id[PEG].decimals, derive(peg_source, [prices]), fetched)

    run_id = AS_OF.isoformat()
    inf = CannedAnswers(conn, run_id)
    store_detections(conn, AS_OF)
    await build_developments(inf, conn, run_id, AS_OF)
    subject = all_subjects()[SUBJECT]
    devs = load_run_developments(conn, run_id)
    await answer_subject(inf, conn, run_id, AS_OF, subject, devs, {}, None)

    facts = subject_facts(conn, SUBJECT, questions_for(subject), AS_OF)
    peg = conn.execute(
        "SELECT * FROM question_answers WHERE run_id = ? AND subject_id = ? AND question_id = ?",
        (run_id, SUBJECT, "issuer.peg"),
    ).fetchone()
    return DepegCheck(
        as_of=AS_OF,
        prices=prices,
        detections=[r["text"].split("\n")[0] for r in _documents(conn)],
        developments=[
            CheckedDevelopment(
                title=d.title,
                materiality_label=MATERIALITY_LEVELS[d.level],
                needs_attention=_needs_attention(conn, run_id, d.id),
                sources=d.sources,
            )
            for d in devs
        ],
        fixed_states=facts.fixed_states,
        peg=CheckedAnswer(
            question_id=peg["question_id"],
            state=peg["state"],
            summary=peg["summary"],
            state_rules=json.loads(peg["state_rules"]),
        ),
    )


def _documents(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT text FROM source_documents WHERE collection = 'data' ORDER BY published_at"
    ).fetchall()


def _needs_attention(conn: sqlite3.Connection, run_id: str, development_id: str) -> bool:
    row = conn.execute(
        "SELECT needs_attention FROM developments WHERE run_id = ? AND id = ?",
        (run_id, development_id),
    ).fetchone()
    return bool(row["needs_attention"])
