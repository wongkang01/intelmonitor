"""Detectors: developments from data (structured-data-plan.md, F3).

Rules in api/seed/detectors.yaml watch the measured series. `detect` evaluates them over what was
known by the end of a date and returns each event: a condition that starts holding (a level
crossing, a spell off the peg lasting long enough, a move beyond a size, a release changing by
more than a size), keyed by its detector, series and first period. `store_detections` writes each
event once as a source document in the data collection, with a sentence written by code and one
finding tagged to the series' primary subjects, so the run's merge, materiality, answers, triage,
alerts and search take it like any other development. Only the rule's materiality differs:
developments.py reads it from the seed instead of asking Jev.
"""

import bisect
import json
import math
import sqlite3
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from intelmonitor.ingest.models import WINDOW_DAYS, Window
from intelmonitor.ingest.parse import content_hash, document_id, domain_of
from intelmonitor.pipeline.indicators import change_basis, compute_indicators, window_start
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.wording import day, fx_move, peg_side, period, value
from intelmonitor.seed import (
    DetectorDef,
    Deviation,
    DeviationDetector,
    MoveDetector,
    MoveDirection,
    MoveWindow,
    ReleaseDetector,
    SeriesDef,
    ThresholdDetector,
    load_detectors,
    load_series,
)
from intelmonitor.store.db import get_meta
from intelmonitor.store.series import Observation, read_observations, read_revisions

# A move in standard deviations needs at least this many earlier changes to measure against.
MIN_SIGMA_CHANGES = 30

Direction = Literal["positive", "negative", "neutral"]


@dataclass(frozen=True)
class Point:
    """An observation as known by the end of the evaluation date, and when that value became known:
    its availability, or its latest revision by then when later than that."""

    obs: Observation
    known_at: datetime


@dataclass(frozen=True)
class Detection:
    """One event: `detector` fired on `series` at `trigger`, the condition first met at `start`."""

    detector: DetectorDef
    series: SeriesDef
    start: date
    trigger: Point
    known_at: datetime  # when every value it rests on was known: the document's publication
    statement: str
    adverse: float
    direction: Direction
    holds: bool  # the condition still holds at the series' latest point

    @property
    def event_date(self) -> date:
        """A market value's own date; for a monthly or quarterly release, the day it came out."""
        if self.series.frequency == "daily":
            return self.trigger.obs.period
        return self.known_at.date()

    @property
    def document_key(self) -> str:
        """The document's canonical URL: one per event, so reruns write nothing new."""
        return f"detector://{self.detector.id}/{self.series.id}/{self.start.isoformat()}"


def materiality_level(detector: DetectorDef) -> int:
    """The rule's materiality as a level index, 0 Trivial to 4 Critical."""
    return [name.lower() for name in MATERIALITY_LEVELS].index(detector.materiality)


def points(conn: sqlite3.Connection, series_id: str, as_of: date) -> list[Point]:
    """The series' observations known by the end of `as_of`, each with when its value was known."""
    revised: dict[date, datetime] = {}
    for r in read_revisions(conn, series_id, as_of):
        revised[r.period] = max(r.revised_at, revised.get(r.period, r.revised_at))
    return [
        Point(o, max(o.available_at, revised.get(o.period, o.available_at)))
        for o in read_observations(conn, series_id, as_of)
    ]


# ---- evaluation


def _runs(hits: list[bool]) -> list[tuple[int, int]]:
    """First and last index of each run of consecutive hits."""
    out: list[tuple[int, int]] = []
    first: int | None = None
    for i, hit in enumerate(hits):
        if hit and first is None:
            first = i
        elif not hit and first is not None:
            out.append((first, i - 1))
            first = None
    if first is not None:
        out.append((first, len(hits) - 1))
    return out


def _change(s: SeriesDef, new: float, old: float) -> float | None:
    """Points for series in %, percent otherwise; None from a zero."""
    if change_basis(s) == "points":
        return new - old
    return (new / old - 1) * 100 if old else None


def _size(s: SeriesDef, change: float) -> str:
    if change_basis(s) == "points":
        return f"{abs(change):.{s.decimals}f} points"
    return f"{abs(change):.2f}%"


def _when(d: DetectorDef, p: Point) -> bool:
    """Whether the detector's `when` condition, if any, holds at the point."""
    return d.when is None or d.when.holds(p.obs.value)


def _ways(direction: MoveDirection, change: float) -> bool:
    return direction == "either" or (change > 0) == (direction == "up")


def _references(pts: list[Point], window: MoveWindow) -> list[Point | None]:
    """Each point's reference: the previous point, or the last one on or before the window's
    start (gaps compare with the last value there was, never with zero)."""
    if window == "previous":
        return [None, *pts[:-1]]
    periods = [p.obs.period for p in pts]
    out: list[Point | None] = []
    for p in pts:
        at = bisect.bisect_right(periods, window_start(p.obs.period, window)) - 1
        out.append(pts[at] if at >= 0 else None)
    return out


def _tone(s: SeriesDef, change: float) -> tuple[float, Direction]:
    """Adverse and direction from the series' bad direction and which way it went."""
    if s.bad_direction == "none" or change == 0:
        return 0.0, "neutral"
    if (change > 0) == (s.bad_direction == "up"):
        return 1.0, "negative"
    return 0.0, "positive"


def _at(s: SeriesDef) -> str:
    return "on" if s.frequency == "daily" else "for"


def _stated(s: SeriesDef, p: Point) -> str:
    """A value with its period: 3.88% on 17 Sep 2026, 70.3% for Jul 2026 (preliminary)."""
    flag = " (preliminary)" if p.obs.preliminary else ""
    return f"{value(s, p.obs.value)} {_at(s)} {period(p.obs.period, s.frequency)}{flag}"


def _released(s: SeriesDef, p: Point) -> str:
    return "" if s.frequency == "daily" else f"; released {day(p.known_at.date())}"


_WINDOW_PHRASE: dict[MoveWindow, str] = {
    "previous": "",
    "1w": " on the week",
    "1m": " on the month",
    "3m": " over 3 months",
    "1y": " on the year",
}


def _threshold(d: ThresholdDetector, s: SeriesDef, pts: list[Point]) -> list[Detection]:
    level = d.above if d.above is not None else d.below
    assert level is not None  # the seed requires one of them
    rising = d.above is not None
    hits = [
        _when(d, p) and ((p.obs.value > level) if rising else (p.obs.value < level)) for p in pts
    ]
    out: list[Detection] = []
    for first, last in _runs(hits):
        if first == 0:
            continue  # the history starts beyond the level: no crossing seen
        before, p = pts[first - 1], pts[first]
        adverse, direction = _tone(s, p.obs.value - before.obs.value)
        crossed = f"rose above {value(s, level)}" if rising else f"fell below {value(s, level)}"
        statement = (
            f"{s.name} {crossed} to {_stated(s, p)}, from {_stated(s, before)}{_released(s, p)}."
        )
        known = max(before.known_at, p.known_at)
        holds = last == len(pts) - 1
        out.append(Detection(d, s, p.obs.period, p, known, statement, adverse, direction, holds))
    return out


def _deviation(
    d: DeviationDetector, s: SeriesDef, by_id: dict[str, SeriesDef], pts: list[Point]
) -> list[Detection]:
    source = s.source
    assert isinstance(source, Deviation)  # the seed requires a deviation series
    out: list[Detection] = []
    for first, last in _runs([_when(d, p) and abs(p.obs.value) > d.beyond for p in pts]):
        start = pts[first].obs.period
        at = next(
            (
                i
                for i in range(first, last + 1)
                if (pts[i].obs.period - start).days * 24 >= d.for_hours
            ),
            None,
        )
        if at is None:
            continue  # the spell ended too soon
        p = pts[at]
        hours = (p.obs.period - start).days * 24
        statement = (
            f"{s.name} by more than {d.beyond:.{s.decimals}f}% for {hours} hours, from "
            f"{day(start)} to {day(p.obs.period)}; "
            f"{peg_side(s, source, by_id, p.obs.value)} on {day(p.obs.period)}."
        )
        known = max(q.known_at for q in pts[first : at + 1])
        holds = last == len(pts) - 1
        out.append(Detection(d, s, start, p, known, statement, 1.0, "negative", holds))
    return out


def _move(d: MoveDetector, s: SeriesDef, pts: list[Point]) -> list[Detection]:
    refs = _references(pts, d.window)
    changes = [
        _change(s, p.obs.value, r.obs.value) if r else None for p, r in zip(pts, refs, strict=True)
    ]
    hits: list[bool] = []
    sigmas: list[float | None] = []
    n, total, squares = 0, 0.0, 0.0  # earlier changes, for the standard deviation
    for p, c in zip(pts, changes, strict=True):
        k: float | None = None
        if c is None or not _when(d, p):
            hit = False
        elif d.beyond is not None:
            hit = abs(c) > d.beyond and _ways(d.direction, c)
        else:
            sd = math.sqrt(max(squares / n - (total / n) ** 2, 0.0)) if n else 0.0
            k = abs(c) / sd if n >= MIN_SIGMA_CHANGES and sd > 0 else None
            hit = k is not None and d.sigmas is not None and k > d.sigmas and _ways(d.direction, c)
        hits.append(hit)
        sigmas.append(k)
        if c is not None:
            n, total, squares = n + 1, total + c, squares + c * c
    out: list[Detection] = []
    for first, last in _runs(hits):
        p, ref, c, k = pts[first], refs[first], changes[first], sigmas[first]
        assert ref is not None and c is not None  # a hit has both
        noted = f" ({k:.1f} standard deviations of its moves)" if k is not None else ""
        if moved := fx_move(s, c):
            statement = (
                f"{moved}{_WINDOW_PHRASE[d.window]}, to {_stated(s, p)}{noted}, from "
                f"{_stated(s, ref)}{_released(s, p)}."
            )
        else:
            statement = (
                f"{s.name} {'up' if c > 0 else 'down'} {_size(s, c)}{_WINDOW_PHRASE[d.window]} to "
                f"{_stated(s, p)}{noted}, from {_stated(s, ref)}{_released(s, p)}."
            )
        adverse, direction = _tone(s, c)
        known = max(ref.known_at, p.known_at)
        holds = last == len(pts) - 1
        out.append(Detection(d, s, p.obs.period, p, known, statement, adverse, direction, holds))
    return out


def _release(d: ReleaseDetector, s: SeriesDef, pts: list[Point]) -> list[Detection]:
    out: list[Detection] = []
    for before, p in zip(pts, pts[1:], strict=False):
        c = _change(s, p.obs.value, before.obs.value)
        if c is None or abs(c) <= d.beyond or not _ways(d.direction, c) or not _when(d, p):
            continue  # each release is its own event, so no runs here
        statement = (
            f"{s.name} {'up' if c > 0 else 'down'} {_size(s, c)} to {_stated(s, p)}, from "
            f"{_stated(s, before)}{_released(s, p)}."
        )
        adverse, direction = _tone(s, c)
        known = max(before.known_at, p.known_at)
        holds = p is pts[-1]  # the latest release is the one that moved
        out.append(Detection(d, s, p.obs.period, p, known, statement, adverse, direction, holds))
    return out


def evaluate(
    d: DetectorDef, s: SeriesDef, by_id: dict[str, SeriesDef], pts: list[Point]
) -> list[Detection]:
    """Every event of one detector over one series' points, oldest first."""
    match d:
        case ThresholdDetector():
            return _threshold(d, s, pts)
        case DeviationDetector():
            return _deviation(d, s, by_id, pts)
        case MoveDetector():
            return _move(d, s, pts)
        case ReleaseDetector():
            return _release(d, s, pts)


def _events(
    conn: sqlite3.Connection, as_of: date, series_ids: Collection[str] | None = None
) -> list[Detection]:
    """Every seeded detector's events over the series (default all), from what was known by the
    end of `as_of`. A series with no data or a stale market price as of the date fires nothing."""
    by_id = {s.id: s for s in load_series().series}
    pairs = load_detectors().matching(list(by_id))
    if series_ids is not None:
        pairs = [(d, i) for d, i in pairs if i in series_ids]
    usable = {
        i
        for i, ind in compute_indicators(conn, {i for _, i in pairs}, as_of).items()
        if ind.state not in ("no_data", "stale")
    }
    cache: dict[str, list[Point]] = {}
    out: list[Detection] = []
    for d, series_id in pairs:
        if series_id not in usable:
            continue
        pts = cache.get(series_id)
        if pts is None:
            pts = cache[series_id] = points(conn, series_id, as_of)
        out += evaluate(d, by_id[series_id], by_id, pts)
    return sorted(out, key=lambda e: (e.known_at, e.detector.id, e.series.id))


def detect(conn: sqlite3.Connection, as_of: date, since: date) -> list[Detection]:
    """Every seeded detector's events known between the start of `since` and the end of `as_of`,
    from what was known by then."""
    return [e for e in _events(conn, as_of) if e.known_at.date() >= since]


def live_events(
    conn: sqlite3.Connection, series_ids: Collection[str], as_of: date, after: date
) -> list[Detection]:
    """The events that set the series' indicator signals as of `as_of`: those known after the end
    of `after` (the previous run's date), and older ones whose condition still holds at the
    series' latest point, such as a level still above its threshold."""
    return [e for e in _events(conn, as_of, series_ids) if e.holds or e.known_at.date() > after]


# ---- documents


def describe(d: DetectorDef, s: SeriesDef) -> str:
    """The rule in words, for the document text."""
    if d.when is None:
        return _rule(d, s)
    if d.when.below is not None:
        return f"{_rule(d, s)}, while the level is below {value(s, d.when.below)}"
    assert d.when.at_least is not None
    return f"{_rule(d, s)}, while the level is at least {value(s, d.when.at_least)}"


def _rule(d: DetectorDef, s: SeriesDef) -> str:
    basis = "points" if change_basis(s) == "points" else "%"
    ways = {"up": " up", "down": " down", "either": ""}
    match d:
        case ThresholdDetector():
            if d.above is not None:
                return f"the level rises above {value(s, d.above)}"
            assert d.below is not None
            return f"the level falls below {value(s, d.below)}"
        case DeviationDetector():
            return f"more than {d.beyond}% off the peg for at least {d.for_hours} hours"
        case MoveDetector():
            over = "from the previous value" if d.window == "previous" else f"over {d.window}"
            size = (
                f"more than {d.beyond} {basis}"
                if d.beyond is not None
                else f"more than {d.sigmas} standard deviations of its earlier moves"
            )
            return f"a move{ways[d.direction]} of {size} {over}"
        case ReleaseDetector():
            return f"a release moving{ways[d.direction]} more than {d.beyond} {basis} on the last"


def _document_text(e: Detection) -> str:
    d, s = e.detector, e.series
    return (
        f"{e.statement}\n\n"
        f"Detector: {d.name}, which fires on {describe(d, s)}. Materiality set by the rule: "
        f"{MATERIALITY_LEVELS[materiality_level(d)]}.\n"
        f"Series {s.id}: {s.name}, in {s.unit}, {s.frequency}, from {s.source_url}. "
        f"Values as known on {day(e.known_at.date())}."
    )


def corpus_start(conn: sqlite3.Connection, as_of: date) -> date:
    """The start of the document corpus (T0 minus WINDOW_DAYS), so detections cover the same span
    as the news; without a stored T0, WINDOW_DAYS before the date."""
    t0 = get_meta(conn, "t0")
    return Window(date.fromisoformat(t0)).start if t0 else as_of - timedelta(days=WINDOW_DAYS)


@dataclass(frozen=True)
class Detected:
    events: int  # known in the corpus window by the run date
    added: int  # documents written by this call; the rest were already stored
    by_detector: dict[str, int]


def store_detections(conn: sqlite3.Connection, as_of: date) -> Detected:
    """Writes each event known in the corpus window by the end of `as_of` as a data document with
    one finding, unless its document is already stored."""
    events = detect(conn, as_of, corpus_start(conn, as_of))
    added = 0
    now = datetime.now(UTC).isoformat()
    with conn:
        for e in events:
            doc_id = document_id(e.document_key)
            exists = "SELECT 1 FROM source_documents WHERE id = ?"
            if conn.execute(exists, (doc_id,)).fetchone():
                continue
            s = e.series
            text = _document_text(e)
            conn.execute(
                "INSERT INTO source_documents (id, source, collection, doc_type, classification, "
                "url, canonical_url, domain, title, published_at, text, content_hash, "
                "ingested_at) VALUES (?, 'detector', 'data', ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    doc_id,
                    f"{e.detector.kind.capitalize()} detector",
                    s.source_url,
                    e.document_key,
                    domain_of(s.source_url),
                    f"{e.detector.name}: {s.name}",
                    e.known_at.astimezone(UTC).isoformat(),
                    text,
                    content_hash(text),
                    now,
                ),
            )
            quote = {"text": e.statement, "start": 0, "end": len(e.statement)}
            conn.execute(
                "INSERT INTO findings (id, document_id, statement, category, event_date, "
                "subjects, quotes, dates) VALUES (?, ?, ?, ?, ?, ?, ?, '[]')",
                (
                    f"{doc_id}-0",
                    doc_id,
                    e.statement,
                    e.detector.category,
                    e.event_date.isoformat(),
                    json.dumps(s.subjects.primary),
                    json.dumps([quote]),
                ),
            )
            conn.executemany(
                "INSERT INTO document_subjects (document_id, subject_id, confidence, source) "
                "VALUES (?, ?, 1.0, 'detector')",
                [(doc_id, subject) for subject in s.subjects.primary],
            )
            conn.execute(
                "INSERT INTO detections (document_id, detector_id, series_id, start, period, "
                "value, adverse, direction) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    doc_id,
                    e.detector.id,
                    s.id,
                    e.start.isoformat(),
                    e.trigger.obs.period.isoformat(),
                    e.trigger.obs.value,
                    e.adverse,
                    e.direction,
                ),
            )
            added += 1
    counts: dict[str, int] = {}
    for e in events:
        counts[e.detector.id] = counts.get(e.detector.id, 0) + 1
    return Detected(len(events), added, counts)
