"""CoinGecko (demo key): daily USD prices of stablecoins.

One range call per coin covers the last 365 days, the most the demo plan allows; a range over 90
days comes back as one point a day at 00:00 UTC. The range ends at the end of the fetch date, so a
new day is a new cache key. Any intraday point is dropped so every period is one instant.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel

from intelmonitor.config import Settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.models import (
    Fetched,
    KeyRejected,
    SourceError,
    Window,
    day_start,
    get_json,
)
from intelmonitor.seed import CoinGeckoSource
from intelmonitor.store.series import Observation

NAMESPACE = "coingecko"
URL = "https://api.coingecko.com/api/v3/coins/{coin}/market_chart/range"
HISTORY_DAYS = 364  # the demo plan answers 401 for a range starting more than 365 days back
_DAY_MS = 86_400_000


class _Response(BaseModel):
    prices: list[tuple[int, float]]  # [unix ms, price]


def fetch(
    http: CachedHttp, settings: Settings, sources: Mapping[str, CoinGeckoSource], window: Window
) -> Fetched:
    fetched = Fetched()
    if not settings.coingecko_api_key:
        fetched.fail(sources, "COINGECKO_API_KEY is not set")
        return fetched
    start = max(window.floor, window.today - timedelta(days=HISTORY_DAYS))
    end = day_start(window.today) + timedelta(days=1, seconds=-1)
    for series_id, source in sources.items():
        try:
            response = get_json(
                http,
                NAMESPACE,
                URL.format(coin=source.coin),
                _Response,
                params={
                    "vs_currency": "usd",
                    "from": str(int(day_start(start).timestamp())),
                    "to": str(int(end.timestamp())),
                },
                headers={"x-cg-demo-api-key": settings.coingecko_api_key},
            )
        except KeyRejected as e:
            done = fetched.observations.keys() | fetched.failures.keys()
            fetched.fail([sid for sid in sources if sid not in done], f"CoinGecko: {e}")
            break
        except SourceError as e:
            fetched.fail([series_id], f"CoinGecko {source.coin}: {e}")
            continue
        observations: list[Observation] = []
        for ms, price in response.prices:
            if ms % _DAY_MS:
                continue
            at = datetime.fromtimestamp(ms / 1000, UTC)
            observations.append(Observation(period=at.date(), value=price, available_at=at))
        fetched.observations[series_id] = observations
    return fetched
