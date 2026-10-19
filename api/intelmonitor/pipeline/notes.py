"""Step 9, after the indicators: a note per subject per run on why its series moved, for the Data
tab (docs/archive/structured-data-plan.md, F6). Notes read no focus areas (phase1-plan.md, item B).

Code computes what each of the subject's series did over the run's week, from the previous run's
date (or seven days before the first run) to the run date: the note's facts. One Claude call per
subject writes a headline and a short note from them, citing the week's developments by number. As
in answers, the note may quote numbers only from the facts and the developments, and tells FX
moves by the SGD's side; a note that breaks either is asked again once. A week reaching back
before the first document is told so, so the note says what no document can explain. The facts
are stored with the note, so the Data tab shows what the note was given. Developments the source
gate holds back as unconfirmed (pipeline/corroboration.py) are left out, as the brief that reads
the note's headline leaves them out.
"""

import asyncio
import json
import re
import sqlite3
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.answers import (
    RunDevelopment,
    answer_problems,
    load_run_developments,
    scope,
)
from intelmonitor.pipeline.corroboration import shown_developments
from intelmonitor.pipeline.facts import mapped_series
from intelmonitor.pipeline.indicators import change_basis, months_before
from intelmonitor.pipeline.inference import ClaudeRefused, Inference, StepFailed
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.subjects import Subject, all_subjects, monitored_subjects, questions_for
from intelmonitor.pipeline.wording import day, fx_currency, fx_move, peg_side, period, value
from intelmonitor.seed import Deviation, DeviationRule, SeriesDef, load_series
from intelmonitor.store.documents import first_document_day
from intelmonitor.store.series import Observation, read_observations

# Most developments listed in one note prompt, most material and most recent first.
NOTE_MAX_DEVELOPMENTS = 40
# "Highest since" is worth saying only when the since-date is at least this far back.
RECORD_MIN_DAYS = 28


class DayMove(BaseModel):
    """A daily series' largest move from one point to the next within the week."""

    period: date
    from_value: float
    value: float
    change: float = Field(description="In the series' change basis: points for %, else percent")


class Record(BaseModel):
    """The latest value is the highest (or lowest) since `since`: the last earlier period with a
    value at least as high (as low), or the start of the stored history."""

    kind: Literal["high", "low"]
    since: date
    whole_history: bool


class SeriesMove(BaseModel):
    """What one series did in the week to a run, as code computed it for the run's note."""

    series_id: str
    since: date = Field(description="The week's start: the previous run's date")
    latest: Observation | None
    start: Observation | None = Field(description="The latest value known by the end of `since`")
    base: Observation | None = Field(
        default=None,
        description="What change compares latest with: start, or for a year-to-date total the "
        "same period a year earlier; null in notes stored before it was kept",
    )
    change: float | None = Field(description="Latest against base, in the change basis")
    largest_day: DayMove | None = Field(description="Daily series other than pegs")
    record: Record | None
    widest: Observation | None = Field(description="Peg series: furthest from the peg in the week")
    released: bool = Field(description="Monthly and quarterly: a new period came out in the week")
    rule: DeviationRule | None = Field(description="An alert threshold on the series")
    text: str = Field(description="The sentence the note prompt gets")


class NoteDraft(BaseModel):
    headline: str
    body: str
    development_ids: list[str]
    series_id: str


NOTE_SYSTEM = (
    "You write short notes for a financial supervisor's monitoring dashboard on why a subject's "
    "measured series moved in a week. Notes are plain and exact, and claim only what the facts and "
    "developments provided support."
)


def note_series(subject_id: str) -> list[SeriesDef]:
    """The series a subject's note and Trend view cover: its own listed series, else the listed
    series it has as context (a bank's system-wide figures), in catalogue order."""
    listed = [s for s in mapped_series(subject_id) if s.listed]
    own = [s for s in listed if subject_id in s.subjects.primary]
    return own or listed


def _in_basis(s: SeriesDef, new: float, old: float) -> float | None:
    if change_basis(s) == "points":
        return new - old
    return (new / old - 1) * 100 if old else None


def _moved(s: SeriesDef, change: float) -> str:
    """A change in words: "up 3.00%", "down 0.4 points", or the SGD's side for FX."""
    if moved := fx_move(s, change):
        return moved
    if change_basis(s) == "points":
        size = f"{abs(change):.{s.decimals}f} points"
        flat = round(change, s.decimals) == 0
    else:
        size = f"{abs(change):.2f}%"
        flat = round(change, 2) == 0
    return "unchanged" if flat else f"{'up' if change > 0 else 'down'} {size}"


def _record(history: list[Observation], latest: Observation, rising: bool) -> Record | None:
    earlier = [o for o in history if o.period < latest.period]
    if not earlier:
        return None
    beaten = [
        o for o in earlier if (o.value >= latest.value if rising else o.value <= latest.value)
    ]
    kind: Literal["high", "low"] = "high" if rising else "low"
    if not beaten:
        return Record(kind=kind, since=earlier[0].period, whole_history=True)
    since = beaten[-1].period
    if (latest.period - since).days < RECORD_MIN_DAYS:
        return None
    return Record(kind=kind, since=since, whole_history=False)


def series_move(
    conn: sqlite3.Connection,
    s: SeriesDef,
    by_id: dict[str, SeriesDef],
    since: date,
    as_of: date,
    rule: DeviationRule | None,
) -> SeriesMove:
    """What one series did from the end of `since` to the end of `as_of`, from what was known by
    then: the latest value against the one known at the week's start (a year-to-date total against
    the same period a year earlier), the week's largest daily move, whether the latest is a high or
    low since some date, and for a peg its furthest point."""
    history = read_observations(conn, s.id, as_of)
    before = read_observations(conn, s.id, since)
    latest = history[-1] if history else None
    start = before[-1] if before else None
    if latest is None:
        return SeriesMove(
            series_id=s.id, since=since, latest=None, start=None, base=None, change=None,
            largest_day=None, record=None, widest=None, released=False, rule=rule,
            text=f"{s.name}: no data available by {day(as_of)}.",
        )  # fmt: skip
    daily = s.frequency == "daily"
    # A year-to-date total restarts each January: it compares with the same period a year earlier.
    base = start
    if s.year_to_date and start is not None:
        year_ago = months_before(latest.period, 12)
        base = next((o for o in reversed(history) if o.period <= year_ago), None)
    change = _in_basis(s, latest.value, base.value) if base else None
    parts: list[str] = []
    at = "on" if daily else "for"
    largest: DayMove | None = None
    record: Record | None = None
    widest: Observation | None = None
    if isinstance(s.source, Deviation):
        spell = [o for o in history if o.period > since] or [latest]
        widest = max(spell, key=lambda o: abs(o.value))
        parts.append(f"latest {peg_side(s, s.source, by_id, latest.value)} on {day(latest.period)}")
        parts.append(
            f"furthest from the peg since {day(since)}: "
            f"{peg_side(s, s.source, by_id, widest.value)} on {day(widest.period)}"
        )
    else:
        if daily:
            week = [o for o in history if start is None or o.period > start.period]
            chain = [start, *week] if start else week
            for a, b in zip(chain, chain[1:], strict=False):
                c = _in_basis(s, b.value, a.value)
                if c is not None and (largest is None or abs(c) > abs(largest.change)):
                    largest = DayMove(period=b.period, from_value=a.value, value=b.value, change=c)
            # One step is the week's whole change: no separate largest day.
            if len(chain) <= 2:
                largest = None
        if change and not s.year_to_date:
            record = _record(history, latest, rising=change > 0)
        flag = " (preliminary)" if latest.preliminary else ""
        stated = f"{value(s, latest.value)} {at} {period(latest.period, s.frequency)}{flag}"
        if start is None:
            parts.append(f"{stated}; nothing was known by {day(since)}")
        elif not daily and start.period == latest.period:
            parts.append(f"no new release since {day(since)}; latest {stated}")
        elif base is None:
            parts.append(f"new release: {stated}; no figure for a year earlier")
        else:
            prefix = "" if daily else "new release: "
            moved = _moved(s, change) if change is not None else "changed"
            since_words = (
                f"since {day(since)}"
                if daily
                else "on the same period a year earlier"
                if s.year_to_date
                else "on the previous period"
            )
            parts.append(
                f"{prefix}{stated}, {moved} {since_words} (from {value(s, base.value)} {at} "
                f"{period(base.period, s.frequency)})"
            )
        if largest is not None:
            parts.append(
                f"largest daily move {_moved(s, largest.change)} on {day(largest.period)} "
                f"(from {value(s, largest.from_value)} to {value(s, largest.value)})"
            )
        if record is not None:
            what = "highest" if record.kind == "high" else "lowest"
            parts.append(
                f"the {what} in the stored history since {period(record.since, s.frequency)}"
                if record.whole_history
                else f"the {what} since {day(record.since)}"
            )
    if rule:
        off = "off the peg" if isinstance(s.source, Deviation) else "from zero"
        parts.append(
            f"the alert threshold is more than {rule.beyond:g}% {off} for {rule.for_hours} hours"
        )
    return SeriesMove(
        series_id=s.id,
        since=since,
        latest=latest,
        start=start,
        base=base,
        change=change,
        largest_day=largest,
        record=record,
        widest=widest,
        released=not daily and start is not None and latest.period != start.period,
        rule=rule,
        text=f"{s.name}: {'; '.join(parts)}.",
    )


def _rule(subject: Subject, s: SeriesDef) -> DeviationRule | None:
    """The series' alert threshold: the first deviation rule the seed's questions set on it."""
    return next((r for q in questions_for(subject) for r in q.rules if r.applies_to(s.id)), None)


def week_developments(
    devs: list[RunDevelopment], ids: set[str], since: date, as_of: date
) -> list[RunDevelopment]:
    """The week's developments for the subject: with a source published in the week, most
    material first."""
    week = [d for d in devs if ids & set(d.subjects) and since < d.last_published <= as_of]
    week.sort(key=lambda d: (-d.level, -d.last_published.toordinal(), d.id))
    return week[:NOTE_MAX_DEVELOPMENTS]


def note_prompt(
    subject: Subject,
    as_of: date,
    since: date,
    first_documents: date | None,
    context: bool,
    moves: list[SeriesMove],
    devs: list[RunDevelopment],
    problems: list[str],
) -> str:
    parts = [
        f"Subject: {subject.description}.",
        f"As of {day(as_of)}. The week runs from {day(since)} to {day(as_of)}.",
    ]
    if first_documents is None or since < first_documents:
        start = f"before {day(first_documents)}" if first_documents else "yet"
        parts.append(
            f"No documents were collected {start}: say that no development can explain a move "
            "made before then, rather than guess."
        )
    if context:
        parts.append(
            "The series are context, not the subject's own figures: system-wide figures for the "
            "Singapore banking system, or market-wide ones. Say so where the note names them."
        )
    parts += ["", "Facts about the series, computed by code:"]
    parts += [f"S:{m.series_id} | {m.text}" for m in moves]
    parts += ["", "Developments tagged to the subject with a source published in the week:"]
    parts += [
        f"D:{d.id} | {d.title} | last source {day(d.last_published)} | "
        f"{MATERIALITY_LEVELS[d.level]}"
        for d in devs
    ] or ["none"]
    if problems:
        parts += ["", "Your previous note broke these rules; write it again without them:"]
        parts += [f"- {p}" for p in problems]
    parts += [
        "",
        """Write:
- headline: one sentence of at most 18 words saying what moved most and whether a development
  in the week lines up with it.
- body: at most 90 words. Say what moved, by how much and when, and which developments line up
  with it in time; cite each one right after the claim it supports, as [D:<id>]. Timing is not
  cause: where a development lines up, say the data shows the timing. Where no development
  explains a move, say so plainly. If the series held, say so.
- Numbers: quote only numbers the facts or developments give, as they give them; never compute,
  convert or estimate new ones. State a level with its unit as the facts give it ("0.3132 SGD
  per MYR", "USD 75.87bn").
- Exchange rates: tell every move by the SGD's side, as the facts do ("SGD weakened 0.55%
  against the MYR"). Never say a rate went up or down, never write pairs such as SGD/MYR.
- development_ids: the ids you cited, without the "D:" prefix, in the order cited.
- series_id: the series the headline is about, without the "S:" prefix.""",
    ]
    return "\n".join(parts)


_CITE = re.compile(r"\s?\[((?:D:)?[\w-]+(?:\s*,\s*(?:D:)?[\w-]+)*)\]")


def number_citations(body: str, eligible: set[str]) -> tuple[str, list[str]]:
    """Replaces [D:<id>] citations with [1], [2] in order of first use, drops citations of
    developments not listed for the week, and returns the body with the cited ids in order."""
    cited: list[str] = []

    def replace(m: re.Match[str]) -> str:
        ids = [i.strip().removeprefix("D:") for i in m.group(1).split(",")]
        kept = [i for i in dict.fromkeys(ids) if i in eligible]
        for i in kept:
            if i not in cited:
                cited.append(i)
        return "".join(f"[{cited.index(i) + 1}]" for i in kept)

    return _CITE.sub(replace, body).strip(), cited


def _allowed(moves: list[SeriesMove], week: list[RunDevelopment]) -> str:
    """The text a note may quote numbers from: its facts and the week's developments."""
    return "\n".join([m.text for m in moves] + [d.title for d in week])


def stored_note_problems(row: sqlite3.Row, as_of: date, devs: list[RunDevelopment]) -> list[str]:
    """The rules a stored `run_notes` row breaks under today's checks: numbers found in neither
    the facts it was given nor the week's developments, and, on FX series, pairs and rates said
    to go up or down. `devs` are its run's developments. A note on a subject no longer in the seed
    is not checked."""
    if (subject := all_subjects().get(row["subject_id"])) is None:
        return []
    moves = [SeriesMove.model_validate(m) for m in json.loads(row["moves"])]
    week = week_developments(devs, scope(subject), date.fromisoformat(row["since"]), as_of)
    fx = any(fx_currency(s) for s in note_series(subject.id))
    return answer_problems(f"{row['headline']}\n{row['body']}", _allowed(moves, week), fx)


async def note_subject(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    base_id: str | None,
    subject: Subject,
    devs: list[RunDevelopment],
) -> int:
    """Writes the subject's note for the run. Returns 1 if it still breaks a rule after the
    retry."""
    series = note_series(subject.id)
    by_id = {s.id: s for s in load_series().series}
    since = date.fromisoformat(base_id) if base_id else as_of - timedelta(days=7)
    moves = [series_move(conn, s, by_id, since, as_of, _rule(subject, s)) for s in series]
    week = week_developments(devs, scope(subject), since, as_of)
    allowed = _allowed(moves, week)
    fx = any(fx_currency(s) for s in series)
    context = all(subject.id not in s.subjects.primary for s in series)
    first_documents = first_document_day(conn)
    problems: list[str] = []
    draft: NoteDraft | None = None
    for attempt in range(2):
        prompt = note_prompt(subject, as_of, since, first_documents, context, moves, week, problems)
        ref = f"subject:{subject.id}" + (f":retry{attempt}" if attempt else "")
        draft = await inf.claude("note", ref, prompt, NoteDraft, NOTE_SYSTEM)
        problems = answer_problems(f"{draft.headline}\n{draft.body}", allowed, fx)
        if not problems:
            break
    assert draft is not None
    body, cited = number_citations(draft.body, {d.id for d in week})
    lead = draft.series_id.removeprefix("S:")
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO run_notes (run_id, subject_id, since, headline, body, "
            "development_ids, series_id, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                subject.id,
                since.isoformat(),
                draft.headline.strip(),
                body,
                json.dumps(cited),
                lead if lead in {s.id for s in series} else None,
                json.dumps([m.model_dump(mode="json") for m in moves]),
            ),
        )
    return 1 if problems else 0


async def write_notes(
    inf: Inference, conn: sqlite3.Connection, run_id: str, as_of: date, base_id: str | None
) -> tuple[int, int, int]:
    """Writes a note for every topic and entity with listed series. A subject whose note Claude
    declines is skipped and keeps no note for the run. Returns (notes written, notes that still
    quote a number outside their facts and developments or break the FX wording, subjects
    refused)."""
    shown = shown_developments(conn, run_id)
    devs = [d for d in load_run_developments(conn, run_id) if d.id in shown]
    subjects = [s for s in monitored_subjects().values() if note_series(s.id)]
    failures: list[str] = []
    broken = 0
    refused: list[str] = []

    async def one(subject: Subject) -> None:
        nonlocal broken
        try:
            # Awaited before adding, so concurrent subjects do not overwrite each other's counts.
            still_broken = await note_subject(inf, conn, run_id, as_of, base_id, subject, devs)
            broken += still_broken
        except ClaudeRefused:
            refused.append(subject.id)
        except Exception as error:
            failures.append(f"{subject.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(s) for s in subjects))
    if failures:
        raise StepFailed("note", failures)
    with conn:
        kept = [s.id for s in subjects if s.id not in refused]
        conn.execute(
            f"DELETE FROM run_notes WHERE run_id = ? AND subject_id NOT IN "
            f"({','.join('?' * len(kept))})",
            (run_id, *kept),
        )
    return len(kept), broken, len(refused)
