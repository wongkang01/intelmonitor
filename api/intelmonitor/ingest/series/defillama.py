"""DefiLlama stablecoins (no key): circulating supply per coin, per chain, and for all coins.

One call per coin returns its full daily history, total and per chain, in the coin's peg currency;
one more returns the market total in USD. Points are dated 00:00 UTC. The current UTC day's own
point is still moving, so it is dropped, and a day's point counts as known at the end of that UTC
day. Neither URL takes a date, so the UTC fetch date goes into the cache key only: a response
fetched on one UTC day is never read as final on the next.
"""

from collections.abc import Mapping
from datetime import UTC, datetime

from pydantic import BaseModel, Field, RootModel

from intelmonitor.config import Settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.models import Fetched, SourceError, Window, after, get_json
from intelmonitor.seed import DefiLlamaSource
from intelmonitor.store.series import Observation

NAMESPACE = "defillama"
COIN_URL = "https://stablecoins.llama.fi/stablecoin/{id}"
ALL_URL = "https://stablecoins.llama.fi/stablecoincharts/all"
_DAY_S = 86_400


class _Point(BaseModel):
    date: int  # unix seconds
    circulating: dict[str, float] | None = None


class _Chain(BaseModel):
    tokens: list[_Point]


class _Coin(BaseModel):
    peg_type: str = Field(alias="pegType")
    tokens: list[_Point]
    chain_balances: dict[str, _Chain] = Field(alias="chainBalances")


class _TotalPoint(BaseModel):
    date: int  # unix seconds, sent as a string
    total_circulating_usd: dict[str, float] = Field(alias="totalCirculatingUSD")


class _Totals(RootModel[list[_TotalPoint]]):
    pass


def _vary(window: Window) -> str:
    """The cache key's day. Marked UTC, so no response cached under a local date is reused."""
    return f"{window.utc_today.isoformat()} UTC"


def _observations(points: list[tuple[int, float]], window: Window) -> list[Observation]:
    observations: list[Observation] = []
    for seconds, value in points:
        if seconds % _DAY_S:
            continue
        period = datetime.fromtimestamp(seconds, UTC).date()
        if window.floor <= period < window.utc_today:
            observations.append(
                Observation(period=period, value=value, available_at=after(period, 1))
            )
    return observations


def fetch(
    http: CachedHttp, settings: Settings, sources: Mapping[str, DefiLlamaSource], window: Window
) -> Fetched:
    fetched = Fetched()
    coins: dict[int, _Coin | SourceError] = {}
    for series_id, source in sources.items():
        if source.stablecoin is None:
            try:
                totals = get_json(http, NAMESPACE, ALL_URL, _Totals, vary=_vary(window))
            except SourceError as e:
                fetched.fail([series_id], f"DefiLlama total: {e}")
                continue
            points = [(p.date, sum(p.total_circulating_usd.values())) for p in totals.root]
            fetched.observations[series_id] = _observations(points, window)
            continue
        if source.stablecoin not in coins:
            try:
                coins[source.stablecoin] = get_json(
                    http,
                    NAMESPACE,
                    COIN_URL.format(id=source.stablecoin),
                    _Coin,
                    vary=_vary(window),
                )
            except SourceError as e:
                coins[source.stablecoin] = e
        coin = coins[source.stablecoin]
        if isinstance(coin, SourceError):
            fetched.fail([series_id], f"DefiLlama stablecoin {source.stablecoin}: {coin}")
            continue
        if source.chain is None:
            tokens = coin.tokens
        elif source.chain in coin.chain_balances:
            tokens = coin.chain_balances[source.chain].tokens
        else:
            fetched.fail(
                [series_id], f"DefiLlama stablecoin {source.stablecoin}: no chain {source.chain}"
            )
            continue
        points = [
            (p.date, p.circulating[coin.peg_type])
            for p in tokens
            if p.circulating and coin.peg_type in p.circulating
        ]
        fetched.observations[series_id] = _observations(points, window)
    return fetched
