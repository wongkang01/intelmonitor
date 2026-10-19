"""Hand-collected market figures, read from api/seed/collected/market-figures.yaml with no network
call: SGX and HKEX monthly statistics, the MAS asset management survey, EQDP placements, FX
turnover and bond market figures.

Each manual series in api/seed/series.yaml reads the figures filed under its own id. A period is
YYYY-MM, YYYY-Qn or YYYY, matching the series' frequency, and is stored at its period end. A figure
counts as known `lag_days` after its period end, and no later than the day the file was collected;
a fetch dated before that leaves it out, as Yahoo leaves out a session that has not closed. Each
figure keeps its source: the URL, the publication, the verbatim quote, and whether the value was
read from a chart, which the file marks with text in [square brackets].
"""

import re
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path

import yaml
from pydantic import BaseModel, ValidationError

from intelmonitor.config import SEED_DIR
from intelmonitor.ingest.series.models import Fetched, Window, day_start
from intelmonitor.seed import Frequency, ManualSource, SeriesDef
from intelmonitor.store.series import Observation, ObservationSource

FIGURES = SEED_DIR / "collected" / "market-figures.yaml"


class _Figure(BaseModel):
    period: str | int  # YAML reads a bare year as a number
    value: float
    source_url: str
    quote: str | None = None


class _Series(BaseModel):
    id: str
    frequency: Frequency
    source_name: str
    observations: list[_Figure]


class MarketFigures(BaseModel):
    """The collected file; its tickers and gaps are notes for people and are not read."""

    collected: date
    series: list[_Series]


_PERIOD: dict[Frequency, re.Pattern[str]] = {
    "monthly": re.compile(r"(\d{4})-(\d{2})"),
    "quarterly": re.compile(r"(\d{4})-Q([1-4])"),
    "yearly": re.compile(r"(\d{4})"),
}


def period_end(period: str, frequency: Frequency) -> date | None:
    """The last day of a collected period ("2026-08", "2026-Q2", "2025"), or None when the period
    is not written for the frequency."""
    pattern = _PERIOD.get(frequency)
    m = pattern.fullmatch(period) if pattern else None
    if m is None:
        return None
    year = int(m.group(1))
    match frequency:
        case "monthly":
            month = int(m.group(2))
        case "quarterly":
            month = int(m.group(2)) * 3
        case _:
            month = 12
    if not 1 <= month <= 12:
        return None
    return date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)


def fetch(series: Sequence[SeriesDef], window: Window, path: Path = FIGURES) -> Fetched:
    """The observations and sources of each manual series in `series`, as known at the fetch."""
    fetched = Fetched()
    manual = [(s, s.source) for s in series if isinstance(s.source, ManualSource)]
    try:
        figures = MarketFigures.model_validate(yaml.safe_load(path.read_text()))
    except (OSError, yaml.YAMLError, ValidationError) as e:
        fetched.fail([s.id for s, _ in manual], f"{path.name} unreadable: {e}")
        return fetched
    collected = {f.id: f for f in figures.series}
    for s, source in manual:
        filed = collected.get(s.id)
        if filed is None:
            fetched.fail([s.id], f"not in {path.name}")
            continue
        if filed.frequency != s.frequency:
            fetched.fail([s.id], f"{filed.frequency} in {path.name}, {s.frequency} in the seed")
            continue
        observations: list[Observation] = []
        sources: list[ObservationSource] = []
        for f in filed.observations:
            end = period_end(str(f.period), s.frequency)
            if end is None:
                fetched.fail([s.id], f"period {f.period} is not {s.frequency}")
                break
            known = day_start(min(end + timedelta(days=source.lag_days), figures.collected))
            if known > window.now:
                continue
            observations.append(Observation(period=end, value=f.value, available_at=known))
            sources.append(
                ObservationSource(
                    period=end,
                    url=f.source_url,
                    title=filed.source_name,
                    quote=f.quote,
                    chart_reading="[" in (f.quote or ""),
                )
            )
        else:
            fetched.observations[s.id] = sorted(observations, key=lambda o: o.period)
            fetched.sources[s.id] = sources
    return fetched
