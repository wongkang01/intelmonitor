"""Yahoo Finance (no key): daily closes of listed banks, an issuer and the region's equity indices.

One chart call per symbol returns every daily bar from the floor to now. A bar is dated by its
exchange's local day and is known at that exchange's regular close, read from the response's
trading period, so a run backfilled to a date never sees a close from later that day. The bar for
a session still trading has a live price, not a close, and is dropped.

Closes are not adjusted for dividends: adjusted history shifts with every dividend, which the
store would record as revisions of every past value. A bank's ex-dividend day is a drop of a few
percent, under the share-price detectors' sizes.

The endpoint is unofficial and its terms are loose; it suits the POC, and a licensed feed
(Bloomberg) would replace it in production. The current UTC hour goes into the cache key, as for
FRED, so a close arrives with the first fetch after it.
"""

from collections.abc import Mapping
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from intelmonitor.config import Settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.models import Fetched, SourceError, Window, day_start, get_json
from intelmonitor.seed import YahooSource
from intelmonitor.store.series import Observation

NAMESPACE = "yahoo"
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"


class _Period(BaseModel):
    end: int  # unix seconds: today's regular close


class _TradingPeriod(BaseModel):
    regular: _Period


class _Meta(BaseModel):
    currency: str | None = None
    exchangeTimezoneName: str
    currentTradingPeriod: _TradingPeriod


class _Quote(BaseModel):
    close: list[float | None] = []


class _Indicators(BaseModel):
    quote: list[_Quote]


class _Result(BaseModel):
    meta: _Meta
    timestamp: list[int] = []
    indicators: _Indicators


class _Chart(BaseModel):
    result: list[_Result] | None


class _Response(BaseModel):
    chart: _Chart


def fetch(
    http: CachedHttp, settings: Settings, sources: Mapping[str, YahooSource], window: Window
) -> Fetched:
    del settings  # no key
    fetched = Fetched()
    for series_id, source in sources.items():
        try:
            response = get_json(
                http,
                NAMESPACE,
                URL.format(symbol=source.symbol),
                _Response,
                params={
                    "period1": str(int(day_start(window.floor).timestamp())),
                    "period2": str(int(window.now.timestamp())),
                    "interval": "1d",
                },
                headers={"User-Agent": "Mozilla/5.0"},  # the API refuses a plain client name
                vary=f"{window.now:%Y-%m-%dT%H} UTC",
            )
            if not response.chart.result:
                raise SourceError("no chart in the response")
            result = response.chart.result[0]
            quotes = result.indicators.quote
            if not quotes or len(quotes[0].close) != len(result.timestamp):
                raise SourceError("closes and timestamps do not line up")
        except SourceError as e:
            fetched.fail([series_id], f"Yahoo Finance {source.symbol}: {e}")
            continue
        zone = ZoneInfo(result.meta.exchangeTimezoneName)
        close = datetime.fromtimestamp(result.meta.currentTradingPeriod.regular.end, zone).time()
        by_day: dict[date, Observation] = {}  # a repeated bar for a day keeps the later one
        for ts, price in zip(result.timestamp, quotes[0].close, strict=True):
            if price is None:
                continue
            day = datetime.fromtimestamp(ts, zone).date()
            known = datetime.combine(day, time(close.hour, close.minute), zone).astimezone(UTC)
            if known > window.now:
                continue  # the session has not closed
            by_day[day] = Observation(period=day, value=price, available_at=known)
        fetched.observations[series_id] = sorted(by_day.values(), key=lambda o: o.period)
    return fetched
