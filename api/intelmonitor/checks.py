"""`im check`: checks the walkthrough runs in scratch stores, with no model calls and no network.

`im check series` replays a backfill and a daily fetch from cached responses only
(structured-data-plan.md, F1): no request may reach a source, the fetch after the backfill adds
and revises nothing, and the replayed observations match the app's store.

`im check past-run` recomputes Run 1 in a copy of the app's store, which holds a week of later
documents, detections and observations, replaying only recorded model calls: nothing it stores may
use what became known after its date, and it must match the stored run.

`im check depeg` fires the peg rule and the depeg detector on fixture prices. No stored price
breaches a peg (structured-data-plan.md, F2 and F3), so the walkthrough runs this to see both
firing paths: USDC more than 0.5% below its peg for 48 hours makes the Peg answer Needs attention
whatever the model says, and the depeg detector's event becomes a development of its own at the
rule's materiality.
"""

import json
import re
import sqlite3
import tempfile
from collections.abc import Generator, Mapping
from contextlib import closing, contextmanager
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.collect import DEFAULT_FLOOR, SeriesFetchResult, fetch_series
from intelmonitor.ingest.series.derive import derive
from intelmonitor.pipeline.answers import SubjectAnswers, answer_subject, load_run_developments
from intelmonitor.pipeline.detectors import store_detections
from intelmonitor.pipeline.developments import build_developments
from intelmonitor.pipeline.facts import FixedState, SeriesFact, subject_facts
from intelmonitor.pipeline.inference import Inference, JevAnswers, JevQuestion
from intelmonitor.pipeline.notes import SeriesMove
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.run import compute_run, run_dates
from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.seed import Deviation, load_series
from intelmonitor.store.db import connect, set_meta
from intelmonitor.store.series import (
    Observation,
    read_observations,
    save_observations,
    sync_catalogue,
)

# The series fetch replayed: the store's backfill and fetches of 28 Sep 2026 (SGT) cached every
# response a fetch at this moment asks for in data/raw/.
REPLAY_TODAY = date(2026, 9, 28)
REPLAY_AT = datetime(2026, 9, 28, 0, 30, tzinfo=UTC)
# Replayed and stored observations are compared over the periods the runs cover.
COMPARE_FROM, COMPARE_TO = date(2026, 7, 1), date(2026, 9, 24)
# Fixture checks of the per-100 conversion: MAS quotes these per 100 units (F1, failure mode 7).
PER_100 = ["fx.sgd.myr", "fx.sgd.thb"]
PER_100_DAY = date(2026, 9, 18)
MAX_DIFFERENCES = 20

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
    materiality_rule: str | None = Field(description="The detector whose rule set the level")
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


async def depeg_check() -> DepegCheck:
    """Runs the detectors, the development merge and the answer step over the fixture prices in a
    scratch store."""
    with _scratch() as conn:
        return await _depeg_check(conn)


async def _depeg_check(conn: sqlite3.Connection) -> DepegCheck:
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
                materiality_rule=_stored(conn, run_id, d.id)["materiality_rule"],
                needs_attention=bool(_stored(conn, run_id, d.id)["needs_attention"]),
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


def _stored(conn: sqlite3.Connection, run_id: str, development_id: str) -> sqlite3.Row:
    return conn.execute(
        "SELECT * FROM developments WHERE run_id = ? AND id = ?", (run_id, development_id)
    ).fetchone()


def _quiet(_: str) -> None:
    pass


@contextmanager
def _scratch(copy_of: sqlite3.Connection | None = None) -> Generator[sqlite3.Connection]:
    """A store in a temporary directory, deleted afterwards: empty, or a copy of `copy_of`."""
    with tempfile.TemporaryDirectory(prefix="im-check-") as tmp:
        path = Path(tmp) / "check.db"
        if copy_of is not None:
            with closing(sqlite3.connect(path)) as copy:
                copy_of.backup(copy)
        with closing(connect(path)) as conn:
            yield conn


class FetchReplay(BaseModel):
    added: int
    revised: int
    failures: dict[str, str] = Field(description="Series id: why it failed")
    network: int = Field(description="Requests that reached a source")
    cached: int = Field(description="Requests served from data/raw/")
    missed: int = Field(description="Requests with no cached response")


class CheckedValue(BaseModel):
    series_id: str
    unit: str
    period: date
    value: float | None


class SeriesCheck(BaseModel):
    today: date
    fetched_at: datetime
    backfill: FetchReplay = Field(description="Every series from the floor, into an empty store")
    fetch: FetchReplay = Field(description="The daily fetch that follows the backfill")
    catalogue: int = Field(description="Series in api/seed/series.yaml")
    series: int = Field(description="Series with observations after the backfill")
    observations: int
    per_100: list[CheckedValue] = Field(description="SGD per one unit, from quotes per 100")
    compared: int = Field(description="Observations compared with the app's store")
    differences: list[str] = Field(description="Where they differ, first few")


def _replay(result: SeriesFetchResult, http: CachedHttp) -> FetchReplay:
    return FetchReplay(
        added=sum(result.added.values()),
        revised=sum(result.revised.values()),
        failures=result.failures,
        network=sum(http.network.values()),
        cached=sum(http.cached.values()),
        missed=sum(http.missed.values()),
    )


def series_check() -> SeriesCheck:
    """Backfills every series into a scratch store from cached responses, fetches again as the
    daily fetch would, and compares the observations with the app's store as known that day."""
    with _scratch() as conn, closing(connect()) as store:
        return _series_check(conn, store)


def _series_check(conn: sqlite3.Connection, store: sqlite3.Connection) -> SeriesCheck:
    runs: list[FetchReplay] = []
    for backfill_from in (DEFAULT_FLOOR, None):
        http = CachedHttp(offline=True)
        result = fetch_series(
            conn, REPLAY_TODAY, backfill_from=backfill_from, http=http, now=REPLAY_AT, log=_quiet
        )
        runs.append(_replay(result, http))

    seed = load_series()
    compared, differences, series, observations = 0, list[str](), 0, 0
    for s in seed.series:
        replayed = read_observations(conn, s.id, REPLAY_TODAY)
        series += bool(replayed)
        observations += len(replayed)
        stored = {o.period: o.value for o in read_observations(store, s.id, REPLAY_TODAY)}
        for o in replayed:
            if not COMPARE_FROM <= o.period <= COMPARE_TO:
                continue
            compared += 1
            if stored.get(o.period) != o.value:
                differences.append(
                    f"{s.id} {o.period}: {o.value} replayed, {stored.get(o.period)} stored"
                )
    by_id = {s.id: s for s in seed.series}
    per_100 = [
        CheckedValue(
            series_id=i,
            unit=by_id[i].unit,
            period=PER_100_DAY,
            value=next(
                (o.value for o in read_observations(conn, i) if o.period == PER_100_DAY), None
            ),
        )
        for i in PER_100
    ]
    return SeriesCheck(
        today=REPLAY_TODAY,
        fetched_at=REPLAY_AT,
        backfill=runs[0],
        fetch=runs[1],
        catalogue=len(seed.series),
        series=series,
        observations=observations,
        per_100=per_100,
        compared=compared,
        differences=differences[:MAX_DIFFERENCES],
    )


class LateRows(BaseModel):
    """Rows of the recomputed run that use something known only after its date."""

    sources: int = Field(description="Development sources published after the date")
    indicators: int = Field(description="Run indicators on observations available after it")
    facts: int = Field(description="Observations stated in the answers' facts")
    notes: int = Field(description="Observations stated in the notes' facts")


class PastRunCheck(BaseModel):
    as_of: date
    log: list[str] = Field(description="The run's step lines")
    later_documents: int = Field(description="Documents in the store published after the date")
    later_observations: int = Field(description="Observations available after the date")
    later_detections: int = Field(description="Detections in the store known after the date")
    detections: int = Field(description="Detections among the run's development sources")
    developments: int
    answers: int
    notes: int
    indicators: int
    late: LateRows
    differences: list[str] = Field(
        description="Where the recomputed run differs from the stored one"
    )


def _run_rows(conn: sqlite3.Connection, run_id: str) -> dict[str, set[tuple[object, ...]]]:
    """What a run stored, row by row, to compare a recomputed run with the stored one."""
    queries = {
        "developments": "SELECT id, title, category, event_date, materiality_level, "
        "materiality_rule, needs_attention FROM developments WHERE run_id = ?",
        "sources": "SELECT development_id, finding_id FROM development_sources WHERE run_id = ?",
        "answers": "SELECT subject_id, question_id, state, summary, development_ids, series_ids, "
        "state_rules FROM question_answers WHERE run_id = ?",
        "notes": "SELECT subject_id, headline, body, development_ids, series_id FROM run_notes "
        "WHERE run_id = ?",
        "indicators": "SELECT series_id, period, value, state FROM run_indicators WHERE run_id = ?",
        "facts": "SELECT subject_id, series_id, fact FROM run_facts WHERE run_id = ?",
        "changes": "SELECT base_run_id, kind, subject_id, ref_id, detail FROM run_changes "
        "WHERE run_id = ?",
    }
    return {name: {tuple(r) for r in conn.execute(q, (run_id,))} for name, q in queries.items()}


def _late(conn: sqlite3.Connection, run_id: str, as_of: date) -> LateRows:
    day = as_of.isoformat()

    def known_late(observations: list[Observation | None]) -> int:
        return sum(o is not None and o.available_at.date() > as_of for o in observations)

    facts = [
        SeriesFact.model_validate_json(r["fact"])
        for r in conn.execute("SELECT fact FROM run_facts WHERE run_id = ?", (run_id,))
    ]
    moves = [
        SeriesMove.model_validate(m)
        for r in conn.execute("SELECT moves FROM run_notes WHERE run_id = ?", (run_id,))
        for m in json.loads(r["moves"])
    ]
    return LateRows(
        sources=conn.execute(
            "SELECT count(*) FROM development_sources s JOIN source_documents d "
            "ON d.id = s.document_id WHERE s.run_id = ? AND substr(d.published_at, 1, 10) > ?",
            (run_id, day),
        ).fetchone()[0],
        indicators=conn.execute(
            "SELECT count(*) FROM run_indicators i JOIN observations o "
            "ON o.series_id = i.series_id AND o.period = i.period "
            "WHERE i.run_id = ? AND substr(o.available_at, 1, 10) > ?",
            (run_id, day),
        ).fetchone()[0],
        facts=sum(known_late([f.latest, f.low, f.high]) for f in facts),
        notes=sum(known_late([m.latest, m.start, m.widest]) for m in moves),
    )


async def past_run_check() -> PastRunCheck:
    """Recomputes Run 1 in a copy of the app's store, replaying only recorded model calls, and
    checks it against what the store knew by then and the stored run."""
    with closing(connect()) as store, _scratch(copy_of=store) as conn:
        return await _past_run_check(conn)


async def _past_run_check(conn: sqlite3.Connection) -> PastRunCheck:
    as_of = run_dates(conn)[0]
    run_id = day = as_of.isoformat()
    stored = _run_rows(conn, run_id)
    log: list[str] = []
    await compute_run(as_of, log.append, conn=conn, recorded_only=True)
    recomputed = _run_rows(conn, run_id)
    differences = [
        f"{name}: {len(stored[name] - rows)} stored rows not recomputed, "
        f"{len(rows - stored[name])} new"
        for name, rows in recomputed.items()
        if rows != stored[name]
    ]
    return PastRunCheck(
        as_of=as_of,
        log=log,
        later_documents=conn.execute(
            "SELECT count(*) FROM source_documents WHERE substr(published_at, 1, 10) > ?", (day,)
        ).fetchone()[0],
        later_observations=conn.execute(
            "SELECT count(*) FROM observations WHERE substr(available_at, 1, 10) > ?", (day,)
        ).fetchone()[0],
        later_detections=conn.execute(
            "SELECT count(*) FROM detections k JOIN source_documents d ON d.id = k.document_id "
            "WHERE substr(d.published_at, 1, 10) > ?",
            (day,),
        ).fetchone()[0],
        detections=conn.execute(
            "SELECT count(DISTINCT s.document_id) FROM development_sources s "
            "JOIN detections k ON k.document_id = s.document_id WHERE s.run_id = ?",
            (run_id,),
        ).fetchone()[0],
        developments=len(recomputed["developments"]),
        answers=len(recomputed["answers"]),
        notes=len(recomputed["notes"]),
        indicators=len(recomputed["indicators"]),
        late=_late(conn, run_id, as_of),
        differences=differences,
    )
