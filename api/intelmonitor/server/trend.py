"""A monitor page's Trend view (docs/archive/structured-data-plan.md, F6): the subject's series over
the 12 months to the latest run, the developments marked on them, each run's note on why they moved,
and the standing questions' states per run."""

import json
from datetime import date, timedelta

from pydantic import BaseModel, Field

from intelmonitor.pipeline.indicators import months_before
from intelmonitor.pipeline.notes import SeriesMove, note_series
from intelmonitor.pipeline.params import RUN_SPACING_DAYS
from intelmonitor.server.models import (
    DevelopmentSummary,
    LinePoint,
    RunRef,
    SeriesInfo,
    State,
    SubjectRef,
)
from intelmonitor.server.queries import Queries, expand, load_developments, subject, subject_ref
from intelmonitor.server.series import series_info
from intelmonitor.server.widgets import MarkedDevelopment, documents_from, marked
from intelmonitor.store.series import read_observations

TREND_MONTHS = 12


class TrendSeries(BaseModel):
    series: SeriesInfo
    line: list[LinePoint] = Field(
        description="Observations over the 12 months to the run date, as known by then"
    )


class DatedDevelopment(BaseModel):
    development: DevelopmentSummary = Field(description="As it stood in the note's run")
    on: date = Field(
        description="Where it sits on the chart: its event date when within the chart's 12 "
        "months, else its first publication"
    )


class RunNote(BaseModel):
    """A run's note on why the subject's series moved in the week to the run."""

    headline: str
    body: str = Field(description="[n] cites developments[n - 1]")
    series_id: str | None = Field(description="The series the headline is about")
    developments: list[DatedDevelopment] = Field(description="Cited, in citation order")
    facts: list[SeriesMove] = Field(description="What code computed for the note, per series")


class TrendRun(BaseModel):
    run: RunRef
    since: date = Field(description="The week's start: the previous run's date")
    note: RunNote | None = Field(description="None when the run wrote no note for the subject")


class QuestionTrend(BaseModel):
    question_id: str
    label: str
    custom: bool
    states: list[State | None] = Field(
        description="Its state in each run, aligned with runs; null where it has no answer"
    )
    summaries: list[str | None] = Field(description="Its answer in each run, aligned with runs")


class SubjectTrend(BaseModel):
    subject: SubjectRef
    run: RunRef
    start: date = Field(description="The chart's start, 12 months before the run date")
    documents_from: date = Field(description="The first document's day: none before it")
    series: list[TrendSeries] = Field(
        description="The subject's own listed series, else its listed context ones, in "
        "catalogue order"
    )
    developments: list[MarkedDevelopment] = Field(
        description="The subject's Needs attention and Watch developments dated in the 12 "
        "months, newest first"
    )
    runs: list[TrendRun] = Field(
        description="Complete runs within the 12 months, oldest first; the last is the latest"
    )
    questions: list[QuestionTrend] = Field(description="Built-in questions, then kept custom ones")


def has_trend(subject_id: str) -> bool:
    return bool(note_series(subject_id))


def _dated(d: DevelopmentSummary, start: date, end: date) -> DatedDevelopment:
    on = d.event_date if d.event_date and start <= d.event_date <= end else d.first_published
    return DatedDevelopment(development=d, on=on)


def trend(q: Queries, subject_id: str) -> SubjectTrend:
    """The Trend view as of the latest run."""
    subject(subject_id)
    as_of = q.run.as_of
    start = months_before(as_of, TREND_MONTHS)
    runs = [
        RunRef(id=r["id"], as_of=r["as_of"], previous_run_id=r["previous_run_id"])
        for r in q.conn.execute(
            "SELECT id, as_of, previous_run_id FROM runs WHERE status = 'complete' "
            "AND as_of >= ? AND as_of <= ? ORDER BY as_of",
            (start.isoformat(), as_of.isoformat()),
        )
    ]
    notes = {
        r["run_id"]: r
        for r in q.conn.execute("SELECT * FROM run_notes WHERE subject_id = ?", (subject_id,))
    }
    scope = expand([subject_id])
    trend_runs: list[TrendRun] = []
    for run in runs:
        row = notes.get(run.id)
        note: RunNote | None = None
        if row is not None:
            cited: list[str] = json.loads(row["development_ids"])
            devs = q.devs if run.id == q.run.id else load_developments(q.conn, run)
            note = RunNote(
                headline=row["headline"],
                body=row["body"],
                series_id=row["series_id"],
                # Each at its priority for this subject, as its feed shows it.
                developments=[
                    _dated(devs.scoped(devs.by_id[i], scope), start, as_of)
                    for i in cited
                    if i in devs.by_id
                ],
                facts=[SeriesMove.model_validate(m) for m in json.loads(row["moves"])],
            )
        previous = run.previous_run_id
        since = (
            date.fromisoformat(row["since"])
            if row
            else date.fromisoformat(previous)
            if previous
            else run.as_of - timedelta(days=RUN_SPACING_DAYS)
        )
        trend_runs.append(TrendRun(run=run, since=since, note=note))
    answers = [q.answer_rows(r.id, subject_id) for r in runs]
    return SubjectTrend(
        subject=subject_ref(subject_id),
        run=q.run,
        start=start,
        documents_from=documents_from(q, as_of),
        series=[
            TrendSeries(
                series=series_info(s),
                line=[
                    LinePoint(period=o.period, value=o.value, preliminary=o.preliminary)
                    for o in read_observations(q.conn, s.id, as_of)
                    if o.period >= start
                ],
            )
            for s in note_series(subject_id)
        ],
        developments=marked(q, subject_id, as_of),
        runs=trend_runs,
        questions=[
            QuestionTrend(
                question_id=d.id,
                label=d.label,
                custom=d.custom,
                states=[a[d.id]["state"] if d.id in a else None for a in answers],
                summaries=[a[d.id]["summary"] if d.id in a else None for a in answers],
            )
            for d in q.question_defs(subject_id)
        ],
    )
