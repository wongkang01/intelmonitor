"""Measured series: one series' observations and revisions, and a subject's indicators
(structured-data-plan.md, F1). The catalogue comes from api/seed/series.yaml."""

import sqlite3
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.facts import FixedState, SeriesFact, subject_facts
from intelmonitor.pipeline.indicators import Indicator, compute_indicators
from intelmonitor.pipeline.subjects import questions_for
from intelmonitor.seed import SeriesDef, load_series
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


class SubjectIndicator(Indicator):
    series: SeriesInfo
    role: SeriesRole


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
    return SeriesInfo(
        id=s.id,
        name=s.name,
        unit=s.unit,
        frequency=s.frequency,
        decimals=s.decimals,
        bad_direction=s.bad_direction,
        source=s.source_name,
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


def subject_indicators(conn: sqlite3.Connection, subject_id: str, as_of: date) -> SubjectIndicators:
    """The indicators of every series mapped to the subject, from what was available by the end
    of `as_of`."""
    subject(subject_id)
    seed = load_series().series
    mapped: list[tuple[SeriesDef, SeriesRole]] = [
        (s, role) for role in _ROLES for s in seed if subject_id in _members(s, role)
    ]
    computed = compute_indicators(conn, [s.id for s, _ in mapped], as_of)
    return SubjectIndicators(
        subject=subject_ref(subject_id),
        as_of=as_of,
        indicators=[
            SubjectIndicator(**computed[s.id].model_dump(), series=series_info(s), role=role)
            for s, role in mapped
        ],
    )


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
