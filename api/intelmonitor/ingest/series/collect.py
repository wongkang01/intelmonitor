"""`im series fetch` and `im series backfill`: fetch every series in api/seed/series.yaml, store
new and revised observations, then recompute the derived series.

MAS tables, FRED, DefiLlama and Yahoo Finance return full history in one call, so every fetch
rereads history from the floor and picks up revisions anywhere in it. CoinGecko returns the last
365 days. MAS exchange and interest rates are the per-day sources: a fetch asks for each weekday
since the oldest of the series' latest periods (at least the last RECENT_DAYS days); a longer span,
as in a backfill or for a series with no data yet, takes the whole table in one call. Manual series
reread api/seed/collected/market-figures.yaml, with no network call, and store each figure's source.
"""

import sqlite3
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from pydantic import BaseModel

from intelmonitor.config import get_settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series import coingecko, defillama, fred, manual, mas_stats, yahoo
from intelmonitor.ingest.series.derive import derive
from intelmonitor.ingest.series.models import Fetched, Window
from intelmonitor.seed import (
    CoinGeckoSource,
    DefiLlamaSource,
    DerivedSource,
    FredSource,
    ManualSource,
    MasSource,
    YahooSource,
    derived_inputs,
    load_series,
)
from intelmonitor.store.db import get_meta, set_meta
from intelmonitor.store.series import (
    latest_periods,
    read_observations,
    save_observations,
    save_sources,
    sync_catalogue,
)

DEFAULT_FLOOR = date(2021, 7, 1)
RECENT_DAYS = 14
# Daily market series whose latest point became available longer ago than this are stale (plan
# failure mode 6). CoinGecko and DefiLlama date points by the UTC day, whatever the local date, and
# trade every day. Exchanges close for weekends and holidays; China's Golden Week and Lunar New
# Year close Shanghai for up to 9 days in a row.
STALE_AFTER = {
    "coingecko": timedelta(days=1),
    "defillama": timedelta(days=1),
    "yahoo": timedelta(days=10),
}
MARKET_SOURCES = tuple(STALE_AFTER)


@dataclass
class SeriesFetchResult:
    today: date
    floor: date
    added: Counter[str] = field(default_factory=Counter[str])  # rows per series
    revised: Counter[str] = field(default_factory=Counter[str])
    failures: dict[str, str] = field(default_factory=dict[str, str])  # series id: reason
    stale: dict[str, date] = field(default_factory=dict[str, date])  # series id: latest period
    network: dict[str, int] = field(default_factory=dict[str, int])  # calls per namespace
    cached: dict[str, int] = field(default_factory=dict[str, int])

    def summary(self) -> "FetchSummary":
        return FetchSummary(
            today=self.today,
            floor=self.floor,
            fetched_at=datetime.now(UTC),
            added=sum(self.added.values()),
            revised=sum(self.revised.values()),
            failures=self.failures,
            stale=self.stale,
            network=self.network,
            cached=self.cached,
        )


class FetchSummary(BaseModel):
    """The latest fetch, kept in meta `series_last_fetch` for the pipeline report."""

    today: date
    floor: date
    fetched_at: datetime
    added: int
    revised: int
    failures: dict[str, str]
    stale: dict[str, date]
    network: dict[str, int]
    cached: dict[str, int]


def fetch_series(
    conn: sqlite3.Connection,
    today: date,
    *,
    backfill_from: date | None = None,
    http: CachedHttp | None = None,
    now: datetime | None = None,
    log: Callable[[str], None] = print,
) -> SeriesFetchResult:
    """Fetches every series up to `today`. `backfill_from` sets the floor, the earliest period
    kept, and fetches everything from it; later fetches keep that floor. A source that fails
    (plan failure modes 1 to 3) fails only its own series, which the result lists. `now`, the UTC
    fetch time, defaults to the clock; a replay of cached responses passes the original one."""
    settings = get_settings()
    http = http or CachedHttp()
    seed = load_series()
    sync_catalogue(conn, seed)
    if backfill_from is not None:
        set_meta(conn, "series_floor", backfill_from.isoformat())
    stored_floor = get_meta(conn, "series_floor")
    floor = date.fromisoformat(stored_floor) if stored_floor else DEFAULT_FLOOR
    result = SeriesFetchResult(today=today, floor=floor)
    fetched_at = now or datetime.now(UTC)
    decimals = {s.id: s.decimals for s in seed.series}

    def store(name: str, fetched: Fetched) -> None:
        for series_id, observations in fetched.observations.items():
            saved = save_observations(
                conn, series_id, decimals[series_id], observations, fetched_at
            )
            result.added[series_id] += saved.added
            result.revised[series_id] += saved.revised
        for series_id, sources in fetched.sources.items():
            save_sources(conn, series_id, sources)
        result.failures.update(fetched.failures)
        for reason, n in Counter(fetched.failures.values()).items():
            log(f"{name}: {n} series failed: {reason}")
        added = sum(result.added[s] for s in fetched.observations)
        log(f"{name}: {len(fetched.observations)} series, {added} rows added")

    mas = {s.id: s.source for s in seed.series if isinstance(s.source, MasSource)}
    fred_sources = {s.id: s.source for s in seed.series if isinstance(s.source, FredSource)}
    cg = {s.id: s.source for s in seed.series if isinstance(s.source, CoinGeckoSource)}
    llama = {s.id: s.source for s in seed.series if isinstance(s.source, DefiLlamaSource)}
    stocks = {s.id: s.source for s in seed.series if isinstance(s.source, YahooSource)}
    collected = [s for s in seed.series if isinstance(s.source, ManualSource)]

    # MAS daily tables from the oldest daily series' latest period, or the floor when one is empty.
    start = floor
    if backfill_from is None:
        latest = latest_periods(conn)
        start = today - timedelta(days=RECENT_DAYS)
        for series_id, source in mas.items():
            if mas_stats.TABLES[source.table].period == "day":
                start = min(start, latest.get(series_id, floor))
        start = max(start, floor)
    window = Window(floor=floor, start=start, today=today, now=fetched_at)
    log(f"series: fetch to {today}, history from {floor}, MAS daily tables from {start}")

    if mas:
        store("mas", mas_stats.fetch(http, settings, mas, window))
    if fred_sources:
        store("fred", fred.fetch(http, settings, fred_sources, window))
    if cg:
        store("coingecko", coingecko.fetch(http, settings, cg, window))
    if llama:
        store("defillama", defillama.fetch(http, settings, llama, window))
    if stocks:
        store("yahoo", yahoo.fetch(http, settings, stocks, window))
    if collected:
        store("manual", manual.fetch(collected, window))

    # Derived series in seed order; each is saved at once, since a later one may use it.
    derived_failures: Counter[str] = Counter()
    for s in seed.series:
        if not isinstance(s.source, DerivedSource):
            continue
        names = derived_inputs(s.source)
        inputs = [read_observations(conn, name) for name in names]
        if empty := [name for name, obs in zip(names, inputs, strict=True) if not obs]:
            result.failures[s.id] = f"no data in {', '.join(empty)}"
            derived_failures[result.failures[s.id]] += 1
            continue
        saved = save_observations(conn, s.id, s.decimals, derive(s.source, inputs), fetched_at)
        result.added[s.id] += saved.added
        result.revised[s.id] += saved.revised
    for reason, n in derived_failures.items():
        log(f"derived: {n} series failed: {reason}")

    for s in seed.series:
        if s.source_name in MARKET_SOURCES and (stored := read_observations(conn, s.id)):
            if fetched_at - stored[-1].available_at > STALE_AFTER[s.source_name]:
                result.stale[s.id] = stored[-1].period
    if result.stale:
        log(f"stale: {', '.join(f'{k} ({v})' for k, v in result.stale.items())}")

    result.network = dict(sorted(http.network.items()))
    result.cached = dict(sorted(http.cached.items()))
    log(
        f"series: {sum(result.added.values())} rows added, {sum(result.revised.values())} "
        f"revised, {len(result.failures)} series failed"
    )
    log(f"requests: {sum(http.network.values())} external, {sum(http.cached.values())} cached")
    log(f"external by source: {result.network}")
    set_meta(conn, "series_last_fetch", result.summary().model_dump_json())
    return result
