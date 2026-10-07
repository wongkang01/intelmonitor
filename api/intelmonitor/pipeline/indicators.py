"""Indicators: what each series says as of a date. Its latest value, the change over fixed
windows, where the latest value sits in its history, and a state (structured-data-plan.md, F1).

`compute_indicators` serves `GET /subjects/{id}/indicators`; `store_run_indicators` writes what a
run saw to run_indicators. Both read only what was available by the end of the date, so a run
backfilled to a past date never sees a later value or revision.
"""

import calendar
import json
import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.ingest.series.collect import MARKET_SOURCES, STALE_AFTER
from intelmonitor.ingest.series.models import day_start
from intelmonitor.seed import DerivedSource, Frequency, SeriesDef, derived_inputs, load_series
from intelmonitor.store.series import Observation, Revision, read_observations, read_revisions

ChangeWindow = Literal["1w", "1m", "3m", "1y"]
# A window shorter than a series' frequency says nothing, so it is left out rather than showing
# a longer change under its label.
_WINDOWS: dict[Frequency, list[ChangeWindow]] = {
    "daily": ["1w", "1m", "3m", "1y"],
    "monthly": ["1m", "3m", "1y"],
    "quarterly": ["3m", "1y"],
}
ALL_WINDOWS: list[ChangeWindow] = _WINDOWS["daily"]
# Without a previous run, revisions made this many days before the date count as recent.
REVISION_WINDOW = timedelta(days=31)

# Worst first. no_data: nothing available by the date (a skipped source, or before the history).
# stale: a market feed whose latest point is more than a day old, or a series derived from one.
# revised: a value revised since the previous run. preliminary: the latest value is flagged
# preliminary by its source.
IndicatorState = Literal["no_data", "stale", "revised", "preliminary", "current"]
# Changes of a series in percent are in percentage points; other series change in percent.
ChangeBasis = Literal["points", "percent"]


class IndicatorChange(BaseModel):
    window: ChangeWindow
    since: date | None = Field(
        description="The period compared with: the last one on or before the window's start"
    )
    from_value: float | None
    change: float | None = Field(
        description="In the indicator's change_basis; null when the window does not apply to the "
        "series' frequency, reaches before its history, or starts from zero"
    )


class Indicator(BaseModel):
    latest: Observation | None
    change_basis: ChangeBasis
    changes: list[IndicatorChange] = Field(description="1w, 1m, 3m and 1y, in that order")
    percentile: float | None = Field(
        description="Percent of the history below the latest value, ties counting half"
    )
    history_start: date | None
    history_count: int
    state: IndicatorState
    revisions: list[Revision] = Field(
        description="Revisions made since the previous run, or in the 31 days to the date"
    )


def change_basis(s: SeriesDef) -> ChangeBasis:
    return "points" if s.unit == "%" else "percent"


def months_before(d: date, months: int) -> date:
    """The same day `months` earlier, clamped to that month's end; a month end maps to a month
    end, so monthly periods (30 Sep, 31 Aug) line up."""
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    last = calendar.monthrange(y, m + 1)[1]
    at_end = d.day == calendar.monthrange(d.year, d.month)[1]
    return date(y, m + 1, last if at_end else min(d.day, last))


def window_start(latest: date, window: ChangeWindow) -> date:
    match window:
        case "1w":
            return latest - timedelta(days=7)
        case "1m":
            return months_before(latest, 1)
        case "3m":
            return months_before(latest, 3)
        case "1y":
            return months_before(latest, 12)


def _stale(
    s: SeriesDef,
    by_id: dict[str, SeriesDef],
    history: Callable[[str], list[Observation]],
    at: datetime,
) -> bool:
    """A market feed that stopped: a daily CoinGecko, DefiLlama or Yahoo Finance series whose
    latest point became available longer before `at` than its source allows, or a series derived
    from one. A derived series takes its staleness from its market inputs, not from its own latest
    point: XSGD in SGD has no value on days without a MAS rate, a gap like the rate's own, while
    its price feed is current."""
    if isinstance(s.source, DerivedSource):
        return any(_stale(by_id[i], by_id, history, at) for i in derived_inputs(s.source))
    if s.source_name not in MARKET_SOURCES or s.frequency != "daily":
        return False
    observations = history(s.id)
    return bool(observations) and at - observations[-1].available_at > STALE_AFTER[s.source_name]


def indicator(
    s: SeriesDef,
    history: list[Observation],
    revisions: list[Revision],
    stale: bool,
) -> Indicator:
    """One series' indicator from what was known: its observations by period, the revisions to
    report, and whether its market feed is stale."""
    basis = change_basis(s)
    if not history:
        return Indicator(
            latest=None,
            change_basis=basis,
            changes=[
                IndicatorChange(window=w, since=None, from_value=None, change=None)
                for w in ALL_WINDOWS
            ],
            percentile=None,
            history_start=None,
            history_count=0,
            state="no_data",
            revisions=revisions,
        )
    latest = history[-1]
    changes: list[IndicatorChange] = []
    for w in ALL_WINDOWS:
        start = window_start(latest.period, w)
        ref = next((o for o in reversed(history) if o.period <= start), None)
        if w not in _WINDOWS[s.frequency] or ref is None:
            changes.append(IndicatorChange(window=w, since=None, from_value=None, change=None))
            continue
        if basis == "points":
            change = latest.value - ref.value
        else:
            change = (latest.value / ref.value - 1) * 100 if ref.value else None
        changes.append(
            IndicatorChange(window=w, since=ref.period, from_value=ref.value, change=change)
        )
    below = sum(o.value < latest.value for o in history)
    ties = sum(o.value == latest.value for o in history)
    if stale:
        state: IndicatorState = "stale"
    elif revisions:
        state = "revised"
    elif latest.preliminary:
        state = "preliminary"
    else:
        state = "current"
    return Indicator(
        latest=latest,
        change_basis=basis,
        changes=changes,
        percentile=(below + ties / 2) / len(history) * 100,
        history_start=history[0].period,
        history_count=len(history),
        state=state,
        revisions=revisions,
    )


def compute_indicators(
    conn: sqlite3.Connection,
    series_ids: Iterable[str],
    as_of: date,
    revised_since: date | None = None,
) -> dict[str, Indicator]:
    """Each series' indicator from what was available by the end of `as_of`: the value it had
    then, the revisions made after `revised_since` (default: in the REVISION_WINDOW before), and
    staleness measured at the end of the day, or now if that is earlier."""
    by_id = {s.id: s for s in load_series().series}
    since = revised_since or as_of - REVISION_WINDOW
    at = min(day_start(as_of + timedelta(days=1)), datetime.now(UTC))
    histories: dict[str, list[Observation]] = {}

    def history(series_id: str) -> list[Observation]:
        if series_id not in histories:
            histories[series_id] = read_observations(conn, series_id, as_of)
        return histories[series_id]

    out: dict[str, Indicator] = {}
    for series_id in series_ids:
        s = by_id[series_id]
        revisions = [
            r for r in read_revisions(conn, series_id, as_of) if r.revised_at.date() > since
        ]
        out[series_id] = indicator(s, history(series_id), revisions, _stale(s, by_id, history, at))
    return out


def store_run_indicators(
    conn: sqlite3.Connection, run_id: str, as_of: date, previous_as_of: date | None
) -> Counter[IndicatorState]:
    """Writes every series' indicator as of the run date to run_indicators, replacing the run's
    earlier rows in one transaction; a series with no data by then gets no row. Revisions count
    from the previous run's date. Returns the count per state, no_data included."""
    ids = [s.id for s in load_series().series]
    computed = compute_indicators(conn, ids, as_of, previous_as_of)
    with conn:
        conn.execute("DELETE FROM run_indicators WHERE run_id = ?", (run_id,))
        for series_id, ind in computed.items():
            if ind.latest is None:
                continue
            detail = ind.model_dump(mode="json", exclude={"latest", "state"})
            conn.execute(
                "INSERT INTO run_indicators (run_id, series_id, period, value, change, state, "
                "detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    series_id,
                    ind.latest.period.isoformat(),
                    ind.latest.value,
                    json.dumps({c.window: c.change for c in ind.changes}),
                    ind.state,
                    json.dumps(detail),
                ),
            )
    return Counter(ind.state for ind in computed.values())
