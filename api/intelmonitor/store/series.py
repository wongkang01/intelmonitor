"""Series, their subjects, observations and revisions (structured-data-plan.md, Data model)."""

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime

from pydantic import BaseModel

from intelmonitor.seed import DerivedSource, SeriesSeed


class Observation(BaseModel):
    """One value of a series for one period, normalised to the series' unit."""

    period: date  # period end
    value: float
    preliminary: bool = False
    available_at: datetime  # UTC; when the value could first have been known


class Revision(BaseModel):
    """A stored value that a later fetch changed."""

    period: date
    old_value: float
    new_value: float
    revised_at: datetime  # UTC; the fetch that saw the new value


def sync_catalogue(conn: sqlite3.Connection, seed: SeriesSeed) -> None:
    """Rewrites the series and series_subjects tables from the seed."""
    conn.execute("DELETE FROM series")
    conn.execute("DELETE FROM series_subjects")
    for s in seed.series:
        derived = s.source.model_dump_json() if isinstance(s.source, DerivedSource) else None
        conn.execute(
            "INSERT INTO series (id, source, name, unit, frequency, decimals, bad_direction, "
            "source_url, derived_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                s.id,
                s.source_name,
                s.name,
                s.unit,
                s.frequency,
                s.decimals,
                s.bad_direction,
                s.source_url,
                derived,
            ),
        )
        roles = [(subject, "primary") for subject in s.subjects.primary]
        roles += [(subject, "context") for subject in s.subjects.context]
        conn.executemany(
            "INSERT INTO series_subjects (series_id, subject_id, role) VALUES (?, ?, ?)",
            [(s.id, subject, role) for subject, role in roles],
        )
    conn.commit()


def differs(old: float, new: float, decimals: int) -> bool:
    """True when a fetched value is a real change: visible at the series' precision and more than
    float noise (sources recompute history and return the same value with different last digits)."""
    delta = abs(old - new)
    return delta >= 0.5 * 10**-decimals and delta > 1e-6 * max(abs(old), abs(new))


@dataclass(frozen=True)
class Saved:
    added: int
    revised: int


def save_observations(
    conn: sqlite3.Connection,
    series_id: str,
    decimals: int,
    observations: Iterable[Observation],
    fetched_at: datetime,
) -> Saved:
    """Stores new periods and applies changed values, writing a revision row for each change. A
    stored period keeps its first available_at: a revision does not make the value known earlier.
    A preliminary flag that clears without a value change is updated without a revision."""
    stored = {
        r["period"]: (float(r["value"]), bool(r["preliminary"]))
        for r in conn.execute(
            "SELECT period, value, preliminary FROM observations WHERE series_id = ?", (series_id,)
        )
    }
    at = fetched_at.isoformat()
    added = revised = 0
    for o in observations:
        period = o.period.isoformat()
        old = stored.get(period)
        if old is None:
            conn.execute(
                "INSERT INTO observations (series_id, period, value, preliminary, available_at, "
                "fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
                (series_id, period, o.value, o.preliminary, o.available_at.isoformat(), at),
            )
            stored[period] = (o.value, o.preliminary)
            added += 1
        elif differs(old[0], o.value, decimals):
            conn.execute(
                "UPDATE observations SET value = ?, preliminary = ?, fetched_at = ? "
                "WHERE series_id = ? AND period = ?",
                (o.value, o.preliminary, at, series_id, period),
            )
            conn.execute(
                "INSERT INTO observation_revisions (series_id, period, old_value, new_value, "
                "revised_at) VALUES (?, ?, ?, ?, ?)",
                (series_id, period, old[0], o.value, at),
            )
            stored[period] = (o.value, o.preliminary)
            revised += 1
        elif old[1] != o.preliminary:
            conn.execute(
                "UPDATE observations SET preliminary = ? WHERE series_id = ? AND period = ?",
                (o.preliminary, series_id, period),
            )
            stored[period] = (old[0], o.preliminary)
    conn.commit()
    return Saved(added, revised)


def read_observations(
    conn: sqlite3.Connection, series_id: str, as_of: date | None = None
) -> list[Observation]:
    """A series' observations by period. With as_of, only what was known by the end of that day:
    observations available on or before it, at the value they had before any later revision."""
    if as_of is None:
        rows = conn.execute(
            "SELECT period, value, preliminary, available_at FROM observations "
            "WHERE series_id = ? ORDER BY period",
            (series_id,),
        ).fetchall()
        return [Observation.model_validate(dict(r)) for r in rows]
    day = as_of.isoformat()
    rows = conn.execute(
        "SELECT period, value, preliminary, available_at FROM observations "
        "WHERE series_id = ? AND substr(available_at, 1, 10) <= ? ORDER BY period",
        (series_id, day),
    ).fetchall()
    # The value before the first revision made after as_of.
    earlier = {
        r["period"]: float(r["old_value"])
        for r in conn.execute(
            "SELECT period, old_value FROM observation_revisions WHERE series_id = ? "
            "AND substr(revised_at, 1, 10) > ? ORDER BY revised_at DESC, id DESC",
            (series_id, day),
        )
    }
    return [
        Observation.model_validate({**dict(r), "value": earlier.get(r["period"], r["value"])})
        for r in rows
    ]


def read_revisions(
    conn: sqlite3.Connection, series_id: str, as_of: date | None = None
) -> list[Revision]:
    """A series' revisions in the order they were made; with as_of, only those made by the end of
    that day."""
    rows = conn.execute(
        "SELECT period, old_value, new_value, revised_at FROM observation_revisions "
        "WHERE series_id = ? AND (? IS NULL OR substr(revised_at, 1, 10) <= ?) "
        "ORDER BY revised_at, id",
        (series_id, as_of and as_of.isoformat(), as_of and as_of.isoformat()),
    ).fetchall()
    return [Revision.model_validate(dict(r)) for r in rows]


def latest_periods(conn: sqlite3.Connection) -> dict[str, date]:
    """Each stored series' latest period."""
    return {
        r["series_id"]: date.fromisoformat(r["period"])
        for r in conn.execute(
            "SELECT series_id, max(period) AS period FROM observations GROUP BY series_id"
        )
    }
