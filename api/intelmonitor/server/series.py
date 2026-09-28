"""Measured series: one series' observations and revisions, and a subject's indicators
(structured-data-plan.md, F1). The catalogue comes from api/seed/series.yaml."""

import sqlite3
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.ingest.parse import document_id
from intelmonitor.pipeline.detectors import Detection, live_events, materiality_level
from intelmonitor.pipeline.facts import FixedState, SeriesFact, subject_facts
from intelmonitor.pipeline.indicators import Indicator, compute_indicators, months_before
from intelmonitor.pipeline.params import MATERIALITY_LEVELS, NEEDS_ATTENTION_LEVEL, RUN_SPACING_DAYS
from intelmonitor.pipeline.subjects import questions_for
from intelmonitor.seed import Deviation, SeriesDef, load_series, providers, source_label
from intelmonitor.server.models import SeriesFactView, SeriesInfo, SubjectRef
from intelmonitor.server.queries import NotFoundError, subject, subject_ref
from intelmonitor.store.series import Observation, Revision, read_observations, read_revisions

# primary: the subject's own series. context: system-wide or market-wide context for it.
SeriesRole = Literal["primary", "context"]


class SeriesSubject(BaseModel):
    subject: SubjectRef
    role: SeriesRole


class SeriesDetail(BaseModel):
    series: SeriesInfo
    subjects: list[SeriesSubject]
    observations: list[Observation] = Field(description="By period, at their current value")
    revisions: list[Revision] = Field(description="Of periods in the range, in the order made")


# From the detector rules on the series (api/seed/detectors.yaml): needs_attention when a live
# event's rule is Significant or above, watch for a lower one, else stable.
IndicatorStatus = Literal["stable", "watch", "needs_attention"]


class LinePoint(BaseModel):
    period: date
    value: float


class IndicatorEvent(BaseModel):
    """A detector event behind an indicator's status."""

    statement: str = Field(description="The sentence code wrote for it")
    materiality_label: str = Field(description="Its rule's level, e.g. Notable")
    known_on: date = Field(description="When every value it rests on was known")
    development_id: str | None = Field(
        description="The development carrying it in the latest run by the date, if any"
    )


class SubjectIndicator(Indicator):
    series: SeriesInfo
    role: SeriesRole
    status: IndicatorStatus
    events: list[IndicatorEvent] = Field(
        description="Detector events known since the previous run, or still holding at the "
        "latest point, worst first"
    )
    line: list[LinePoint] = Field(
        description="Observations over the 12 months to the date, as known by then; none for "
        "a series not listed"
    )


class SubjectIndicators(BaseModel):
    subject: SubjectRef
    as_of: date
    indicators: list[SubjectIndicator] = Field(
        description="Primary series first, then context, each in catalogue order"
    )


class SubjectFacts(BaseModel):
    """What the subject's standing answers are told about their series as of a date."""

    subject: SubjectRef
    as_of: date
    facts: list[SeriesFactView] = Field(description="In catalogue order")
    fixed_states: list[FixedState] = Field(description="Rules that fire, per question")


_ROLES: list[SeriesRole] = ["primary", "context"]


def _members(s: SeriesDef, role: SeriesRole) -> list[str]:
    return s.subjects.primary if role == "primary" else s.subjects.context


def series_info(s: SeriesDef) -> SeriesInfo:
    by_id = {d.id: d for d in load_series().series}
    return SeriesInfo(
        id=s.id,
        name=s.name,
        short_name=s.short_name or s.name,
        group=s.group,
        scope=s.scope,
        listed=s.listed,
        unit=s.unit,
        frequency=s.frequency,
        decimals=s.decimals,
        bad_direction=s.bad_direction,
        baseline=0.0 if isinstance(s.source, Deviation) else None,
        source=s.source_name,
        source_label=source_label(s, by_id),
        providers=list(dict.fromkeys(providers(s, by_id))),
        source_url=s.source_url,
    )


def series_detail(
    conn: sqlite3.Connection, series_id: str, start: date | None, end: date | None
) -> SeriesDetail:
    """A series' observations with periods from `start` to `end` (both optional, inclusive) and
    the revisions of those periods."""
    s = next((s for s in load_series().series if s.id == series_id), None)
    if s is None:
        raise NotFoundError(f"series {series_id}")

    def within(period: date) -> bool:
        return (start is None or period >= start) and (end is None or period <= end)

    subjects = [SeriesSubject(subject=subject_ref(i), role="primary") for i in s.subjects.primary]
    subjects += [SeriesSubject(subject=subject_ref(i), role="context") for i in s.subjects.context]
    return SeriesDetail(
        series=series_info(s),
        subjects=subjects,
        observations=[o for o in read_observations(conn, series_id) if within(o.period)],
        revisions=[r for r in read_revisions(conn, series_id) if within(r.period)],
    )


def _previous_run_date(conn: sqlite3.Connection, as_of: date) -> date:
    """The latest completed run before `as_of`, or RUN_SPACING_DAYS before it without one."""
    row = conn.execute(
        "SELECT max(as_of) FROM runs WHERE status = 'complete' AND as_of < ?",
        (as_of.isoformat(),),
    ).fetchone()
    return date.fromisoformat(row[0]) if row[0] else as_of - timedelta(days=RUN_SPACING_DAYS)


def _event_views(
    conn: sqlite3.Connection, events: list[Detection], as_of: date
) -> dict[str, list[IndicatorEvent]]:
    """Each series' events, worst first, with the development that carries each one in the latest
    run by the date."""
    run = conn.execute(
        "SELECT max(id) FROM runs WHERE status = 'complete' AND as_of <= ?", (as_of.isoformat(),)
    ).fetchone()[0]
    out: dict[str, list[IndicatorEvent]] = {}
    worst_first = sorted(
        events, key=lambda e: (-materiality_level(e.detector), -e.known_at.timestamp())
    )
    for e in worst_first:
        row = conn.execute(
            "SELECT development_id FROM development_sources WHERE run_id = ? AND finding_id = ?",
            (run, f"{document_id(e.document_key)}-0"),
        ).fetchone()
        out.setdefault(e.series.id, []).append(
            IndicatorEvent(
                statement=e.statement,
                materiality_label=MATERIALITY_LEVELS[materiality_level(e.detector)],
                known_on=e.known_at.date(),
                development_id=row[0] if row else None,
            )
        )
    return out


def _status(events: list[IndicatorEvent]) -> IndicatorStatus:
    if not events:
        return "stable"
    worst = MATERIALITY_LEVELS.index(events[0].materiality_label)
    return "needs_attention" if worst >= NEEDS_ATTENTION_LEVEL else "watch"


def subject_indicators(conn: sqlite3.Connection, subject_id: str, as_of: date) -> SubjectIndicators:
    """The indicators of every series mapped to the subject, from what was available by the end
    of `as_of`: each with its status from the detector events known since the previous run or
    still holding, and its line over the 12 months to the date."""
    subject(subject_id)
    seed = load_series().series
    mapped: list[tuple[SeriesDef, SeriesRole]] = [
        (s, role) for role in _ROLES for s in seed if subject_id in _members(s, role)
    ]
    ids = [s.id for s, _ in mapped]
    computed = compute_indicators(conn, ids, as_of)
    events = _event_views(
        conn, live_events(conn, ids, as_of, _previous_run_date(conn, as_of)), as_of
    )
    start = months_before(as_of, 12)
    indicators: list[SubjectIndicator] = []
    for s, role in mapped:
        own = events.get(s.id, [])
        indicators.append(
            SubjectIndicator(
                **computed[s.id].model_dump(),
                series=series_info(s),
                role=role,
                status=_status(own),
                events=own,
                line=[
                    LinePoint(period=o.period, value=o.value)
                    for o in (read_observations(conn, s.id, as_of) if s.listed else [])
                    if o.period >= start
                ],
            )
        )
    return SubjectIndicators(subject=subject_ref(subject_id), as_of=as_of, indicators=indicators)


def facts_as_of(conn: sqlite3.Connection, subject_id: str, as_of: date) -> SubjectFacts:
    """The facts a run as of `as_of` gives the subject's answers, from what was available by the
    end of that day, and the states rules fix."""
    subj = subject(subject_id)
    computed = subject_facts(conn, subject_id, questions_for(subj), as_of)
    by_id = {s.id: s for s in load_series().series}
    return SubjectFacts(
        subject=subject_ref(subject_id),
        as_of=as_of,
        facts=[
            SeriesFactView(series=series_info(by_id[f.series_id]), fact=f) for f in computed.facts
        ],
        fixed_states=computed.fixed_states,
    )


def cited_series(
    conn: sqlite3.Connection, run_id: str, subject_id: str, series_ids: list[str]
) -> list[SeriesFactView]:
    """The series an answer cites, each with the fact its run gave the answer."""
    by_id = {s.id: s for s in load_series().series}
    stored = {
        r["series_id"]: SeriesFact.model_validate_json(r["fact"])
        for r in conn.execute(
            "SELECT series_id, fact FROM run_facts WHERE run_id = ? AND subject_id = ?",
            (run_id, subject_id),
        )
    }
    return [
        SeriesFactView(series=series_info(by_id[i]), fact=stored[i])
        for i in series_ids
        if i in stored and i in by_id
    ]
