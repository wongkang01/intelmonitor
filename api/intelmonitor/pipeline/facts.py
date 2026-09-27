"""Facts: what a subject's measured series say as of a date, as sentences and numbers written by
code for the answer prompt (structured-data-plan.md, F2), and the states rules fix.

`subject_facts` is the one entry point: the pipeline gives its result to the answer prompt and
stores it per run, and `GET /subjects/{id}/facts` serves it for any date. Questions link to series
by patterns in questions.yaml, matched against the series mapped to the subject in series.yaml.
Everything is read from what was available by the end of the date, so a run backfilled to a past
date never states a later value.
"""

import re
import sqlite3
from datetime import date, timedelta

from pydantic import BaseModel, Field

from intelmonitor.pipeline.indicators import (
    ChangeWindow,
    Indicator,
    IndicatorChange,
    IndicatorState,
    compute_indicators,
)
from intelmonitor.seed import (
    Deviation,
    DeviationRule,
    Frequency,
    QuestionDef,
    RuleState,
    SeriesDef,
    linked_series,
    load_series,
)
from intelmonitor.store.series import Observation, read_observations


class SeriesFact(BaseModel):
    series_id: str
    question_ids: list[str] = Field(description="The subject's questions that use the series")
    state: IndicatorState
    window_start: date | None = Field(
        description="Daily series: low and high are over the periods after this, to the date"
    )
    latest: Observation | None
    low: Observation | None
    high: Observation | None
    changes: list[IndicatorChange] = Field(description="The changes the text states")
    text: str = Field(description="The sentence the answer prompt gets")


class FixedState(BaseModel):
    """A rule fired: the question's state is at least `state`, whatever the model says."""

    question_id: str
    series_id: str
    state: RuleState
    start: date = Field(description="First period of the longest spell beyond the threshold")
    end: date = Field(description="Last period of that spell")
    hours: int
    text: str


class SubjectFacts(BaseModel):
    as_of: date
    facts: list[SeriesFact] = Field(description="In catalogue order")
    fixed_states: list[FixedState]

    def for_question(self, question_id: str) -> list[SeriesFact]:
        return [f for f in self.facts if question_id in f.question_ids]

    def fixed(self, question_id: str) -> list[FixedState]:
        return [f for f in self.fixed_states if f.question_id == question_id]


def mapped_series(subject_id: str) -> list[SeriesDef]:
    """The series mapped to a subject, primary or context, in catalogue order."""
    return [
        s
        for s in load_series().series
        if subject_id in s.subjects.primary or subject_id in s.subjects.context
    ]


def subject_facts(
    conn: sqlite3.Connection,
    subject_id: str,
    questions: list[QuestionDef],
    as_of: date,
    revised_since: date | None = None,
) -> SubjectFacts:
    """The facts of every series the questions link for the subject, from what was available by
    the end of `as_of`, and the states their rules fix. A daily series' low and high cover the
    longest lookback of the questions using it. Revisions count after `revised_since` (default:
    the 31 days before the date)."""
    mapped = mapped_series(subject_id)
    ids = [s.id for s in mapped]
    users: dict[str, list[QuestionDef]] = {}
    for q in questions:
        for series_id in linked_series(q, ids):
            users.setdefault(series_id, []).append(q)
    by_id = {s.id: s for s in load_series().series}
    linked = [i for i in ids if i in users]
    indicators = compute_indicators(conn, linked, as_of, revised_since)
    facts: list[SeriesFact] = []
    fixed: list[FixedState] = []
    for series_id in linked:
        s = by_id[series_id]
        history = read_observations(conn, series_id, as_of)
        days = max(q.lookback_days for q in users[series_id])
        facts.append(
            series_fact(s, by_id, history, indicators[series_id], as_of, days, users[series_id])
        )
        if indicators[series_id].state in ("no_data", "stale"):
            continue  # no rule fires on missing or stale data
        for q in users[series_id]:
            for rule in q.rules:
                if rule.applies_to(series_id) and (
                    firing := apply_rule(rule, s, by_id, history, as_of, q)
                ):
                    fixed.append(firing)
    return SubjectFacts(as_of=as_of, facts=facts, fixed_states=fixed)


# ---- rules


def apply_rule(
    rule: DeviationRule,
    s: SeriesDef,
    by_id: dict[str, SeriesDef],
    history: list[Observation],
    as_of: date,
    q: QuestionDef,
) -> FixedState | None:
    """The longest spell of observations in a row beyond the threshold that reaches into the
    question's lookback, if it lasts at least the rule's hours from its first to its last point."""
    since = as_of - timedelta(days=q.lookback_days)
    spells: list[list[Observation]] = []
    current: list[Observation] = []
    for o in history:
        if abs(o.value) > rule.beyond:
            current.append(o)
            continue
        if current:
            spells.append(current)
        current = []
    if current:
        spells.append(current)

    def hours(spell: list[Observation]) -> int:
        return (spell[-1].period - spell[0].period).days * 24

    reaching = [sp for sp in spells if sp[-1].period > since and hours(sp) >= rule.for_hours]
    if not reaching:
        return None
    spell = max(reaching, key=lambda sp: (hours(sp), sp[-1].period))
    worst = max(spell, key=lambda o: abs(o.value))
    source = s.source
    if isinstance(source, Deviation):
        beyond = f"more than {rule.beyond:.{s.decimals}f}% off the peg"
        furthest = _peg_side(s, source, by_id, worst.value)
    else:
        beyond = f"beyond ±{_value(s, rule.beyond)}"
        furthest = _value(s, worst.value)
    text = (
        f"{s.name}: {beyond} for {hours(spell)} hours, {_day(spell[0].period)} to "
        f"{_day(spell[-1].period)}; furthest {furthest} on {_day(worst.period)}."
    )
    return FixedState(
        question_id=q.id,
        series_id=s.id,
        state=rule.state,
        start=spell[0].period,
        end=spell[-1].period,
        hours=hours(spell),
        text=text,
    )


# ---- sentences


_FX_UNIT = re.compile(r"SGD per ([A-Z]{3})")

_WINDOW_PHRASE: dict[ChangeWindow, str] = {
    "1w": "on the week",
    "1m": "on the month",
    "3m": "over 3 months",
    "1y": "on the year",
}


def _num(v: float, decimals: int) -> str:
    return f"{v:,.{decimals}f}"


def _value(s: SeriesDef, v: float) -> str:
    """A value in the series' unit: 70.3%, USD 73.21bn, SGD 1,234m, 0.3128 SGD per MYR."""
    match s.unit:
        case "%":
            return f"{v:.{s.decimals}f}%"
        case "index":
            return _num(v, s.decimals)
        case "SGD m":
            return f"SGD {v:,.0f}m"
        case "USD" | "SGD" if abs(v) >= 1e9:
            return f"{s.unit} {v / 1e9:,.2f}bn"
        case "USD" | "SGD" if abs(v) >= 1e6:
            return f"{s.unit} {v / 1e6:,.1f}m"
        case "USD" | "SGD":
            return f"{s.unit} {_num(v, s.decimals)}"
        case _:
            return f"{_num(v, s.decimals)} {s.unit}"


def _day(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


def _period(d: date, frequency: Frequency) -> str:
    match frequency:
        case "daily":
            return _day(d)
        case "monthly":
            return f"{d:%b %Y}"
        case "quarterly":
            return f"Q{(d.month - 1) // 3 + 1} {d.year}"


def _change(s: SeriesDef, ind: Indicator, c: IndicatorChange) -> str | None:
    if c.change is None or c.since is None or c.from_value is None:
        return None
    if ind.change_basis == "points":
        size = f"{abs(c.change):.{s.decimals}f} points"
        flat = round(c.change, s.decimals) == 0
    else:
        size = f"{abs(c.change):.2f}%"
        flat = round(c.change, 2) == 0
    move = "unchanged" if flat else f"{'up' if c.change > 0 else 'down'} {size}"
    note = ""
    if not flat and (quoted := _FX_UNIT.fullmatch(s.unit)):
        # Which way is which is easy to get backwards in prose, so each change says it.
        note = f"SGD {'weaker' if c.change > 0 else 'stronger'} against the {quoted.group(1)}; "
    since = _period(c.since, s.frequency)
    at = "on" if s.frequency == "daily" else "for"
    return f"{move} {_WINDOW_PHRASE[c.window]} ({note}from {_value(s, c.from_value)} {at} {since})"


def _rank(s: SeriesDef, history: list[Observation], latest: Observation, start: date) -> str:
    """Where the latest value sits in the history, as counts rather than a rounded percentile."""
    lower = sum(o.value < latest.value for o in history)
    higher = sum(o.value > latest.value for o in history)
    since = f"the {len(history):,} values since {_period(start, s.frequency)}"
    if lower == 0:
        return f"the lowest of {since}"
    if higher == 0:
        return f"the highest of {since}"
    return f"above {lower:,} of {since}"


def _peg_side(s: SeriesDef, source: Deviation, by_id: dict[str, SeriesDef], v: float) -> str:
    """A deviation value as the price and its side of the target: 0.9987 USD (0.13% below)."""
    target = by_id[source.input]
    price = source.target * (1 + v / 100)
    rounded = round(abs(v), s.decimals)
    side = (
        "at the peg"
        if rounded == 0
        else f"{rounded:.{s.decimals}f}% {'below' if v < 0 else 'above'}"
    )
    return f"{_num(price, target.decimals)} {target.unit} ({side})"


def series_fact(
    s: SeriesDef,
    by_id: dict[str, SeriesDef],
    history: list[Observation],
    ind: Indicator,
    as_of: date,
    window_days: int,
    questions: list[QuestionDef],
) -> SeriesFact:
    """One series' fact from its observations known by the end of `as_of` and its indicator."""
    question_ids = [q.id for q in questions]
    if ind.latest is None:
        return SeriesFact(
            series_id=s.id,
            question_ids=question_ids,
            state="no_data",
            window_start=None,
            latest=None,
            low=None,
            high=None,
            changes=[],
            text=f"{s.name}: no data available by {_day(as_of)}.",
        )
    latest = ind.latest
    daily = s.frequency == "daily"
    start = as_of - timedelta(days=window_days) if daily else None
    window = [o for o in history if start is not None and o.period > start]
    low = min(window, key=lambda o: o.value) if window else None
    high = max(window, key=lambda o: o.value) if window else None
    parts: list[str] = []
    if ind.state == "stale":
        parts.append(f"stale: no point since {_day(latest.period)}")
    source = s.source
    changes = [c for c in ind.changes if c.change is not None]
    if isinstance(source, Deviation):
        # A peg: how far it strayed in the window, as prices, then the latest.
        if window and low and high:
            furthest = max(abs(o.value) for o in window)
            parts.append(
                f"within {furthest:.{s.decimals}f}% of the peg in the {window_days} days to "
                f"{_day(as_of)}; lowest {_peg_side(s, source, by_id, low.value)} on "
                f"{_day(low.period)}, highest {_peg_side(s, source, by_id, high.value)} on "
                f"{_day(high.period)}"
            )
        parts.append(f"latest {_peg_side(s, source, by_id, latest.value)} on {_day(latest.period)}")
        changes = []
    else:
        at = "on" if daily else "for"
        flags: list[str] = []
        if latest.preliminary:
            flags.append("preliminary")
        if not daily:
            flags.append(f"available from {_day(latest.available_at.date())}")
        flagged = f" ({', '.join(flags)})" if flags else ""
        parts.append(
            f"{_value(s, latest.value)} {at} {_period(latest.period, s.frequency)}{flagged}"
        )
        stated = [text for c in changes if (text := _change(s, ind, c))]
        if stated:
            parts.append(", ".join(stated))
        if window and low and high and len(window) > 1:
            span = f"in the {window_days} days to {_day(as_of)}"
            if _value(s, low.value) == _value(s, high.value):
                parts.append(f"{span} it held at {_value(s, low.value)}")
            else:
                parts.append(
                    f"{span} it ranged from {_value(s, low.value)} ({_day(low.period)}) to "
                    f"{_value(s, high.value)} ({_day(high.period)})"
                )
        if ind.history_start is not None:
            parts.append(_rank(s, history, latest, ind.history_start))
    for r in ind.revisions:
        parts.append(
            f"revised: {_period(r.period, s.frequency)} from {_value(s, r.old_value)} to "
            f"{_value(s, r.new_value)} on {_day(r.revised_at.date())}"
        )
    return SeriesFact(
        series_id=s.id,
        question_ids=question_ids,
        state=ind.state,
        window_start=start,
        latest=latest,
        low=low,
        high=high,
        changes=changes,
        text=f"{s.name}: {'; '.join(parts)}.",
    )
