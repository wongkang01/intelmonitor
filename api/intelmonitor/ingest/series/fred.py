"""FRED (St. Louis Fed): policy rates, Treasury yields, credit spreads and the VIX.

One call per series returns every observation from the floor to the fetch date. FRED marks a
missing day with the value "."; those days are gaps, not zeros. FRED gives no publication date, so
a value is known `lag_days` after its date.
"""

from collections.abc import Mapping
from datetime import date
from typing import Annotated

from pydantic import BaseModel, BeforeValidator

from intelmonitor.config import Settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.models import (
    Fetched,
    KeyRejected,
    SourceError,
    Window,
    after,
    get_json,
)
from intelmonitor.seed import FredSource
from intelmonitor.store.series import Observation

NAMESPACE = "fred"
URL = "https://api.stlouisfed.org/fred/series/observations"


class _Point(BaseModel):
    date: date
    value: Annotated[float | None, BeforeValidator(lambda v: None if v == "." else v)]


class _Response(BaseModel):
    observations: list[_Point]


def fetch(
    http: CachedHttp, settings: Settings, sources: Mapping[str, FredSource], window: Window
) -> Fetched:
    fetched = Fetched()
    if not settings.fred_api_key:
        fetched.fail(sources, "FRED_API_KEY is not set")
        return fetched
    for series_id, source in sources.items():
        try:
            response = get_json(
                http,
                NAMESPACE,
                URL,
                _Response,
                params={
                    "series_id": source.series,
                    "file_type": "json",
                    "observation_start": window.floor.isoformat(),
                    "observation_end": window.today.isoformat(),
                },
                secret_params={"api_key": settings.fred_api_key},
            )
        except KeyRejected as e:
            done = fetched.observations.keys() | fetched.failures.keys()
            fetched.fail([sid for sid in sources if sid not in done], f"FRED: {e}")
            break
        except SourceError as e:
            fetched.fail([series_id], f"FRED {source.series}: {e}")
            continue
        fetched.observations[series_id] = [
            Observation(period=p.date, value=p.value, available_at=after(p.date, source.lag_days))
            for p in response.observations
            if p.value is not None
        ]
    return fetched
