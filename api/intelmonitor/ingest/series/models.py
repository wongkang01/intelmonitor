"""Shapes shared by the series adapters and the fetch that runs them.

Every adapter has the same interface: `fetch(http, settings, sources, window) -> Fetched`, where
`sources` maps series ids to that adapter's source specs from api/seed/series.yaml. An adapter
never raises for a bad source: a missing or rejected key, an error or HTML page instead of JSON, or
a response that fails validation becomes a failure for the series that request serves, and the
other series carry on.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

from pydantic import BaseModel, ValidationError

from intelmonitor.ingest.http import CachedHttp, FetchError
from intelmonitor.store.series import Observation


@dataclass(frozen=True)
class Window:
    floor: date  # earliest period kept (`im series backfill --from`)
    start: date  # earliest period this fetch must cover; per-day requests start here
    today: date  # the local fetch date; MAS and FRED requests carry it, so a new day is a new key
    now: datetime  # UTC fetch time: market sources date their points by the UTC day

    @property
    def utc_today(self) -> date:
        return self.now.date()


@dataclass
class Fetched:
    observations: dict[str, list[Observation]] = field(default_factory=dict[str, list[Observation]])
    failures: dict[str, str] = field(default_factory=dict[str, str])  # series id: reason

    def fail(self, series_ids: Iterable[str], reason: str) -> None:
        for series_id in series_ids:
            self.failures[series_id] = reason


# Data APIs get a plain client name: FRED stalls requests that carry the browser user agent
# CachedHttp sends to official web pages.
USER_AGENT = "intelmonitor/0.1"


class SourceError(Exception):
    """A request that gave no usable data. The message says why, for the fetch log."""


class KeyRejected(SourceError):
    """The source refused the API key; later requests with the same key are skipped."""


def get_json[M: BaseModel](
    http: CachedHttp,
    namespace: str,
    url: str,
    model: type[M],
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    secret_params: dict[str, str] | None = None,
    vary: str | None = None,
) -> M:
    """GET a JSON response and validate it. Errors are never cached, so a fixed key or an outage
    that ends is picked up by the next fetch; a 200 HTML page is retried and then a failure."""
    try:
        response = http.get(
            namespace,
            url,
            params=params,
            headers={"User-Agent": USER_AGENT, **(headers or {})},
            secret_params=secret_params,
            vary=vary,
            expect_json=True,
            cache_errors=False,
        )
    except FetchError as e:
        raise SourceError(str(e)) from e
    if response.status in (401, 403) or (
        response.status == 400 and b"api_key" in response.content  # FRED's answer to a bad key
    ):
        raise KeyRejected(f"key rejected (HTTP {response.status})")
    if not response.ok:
        raise SourceError(f"HTTP {response.status}: {response.text()[:200]}")
    try:
        return model.model_validate_json(response.content)
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise SourceError(f"unexpected response: {first['msg']} at {where}") from e


def day_start(day: date) -> datetime:
    """Midnight UTC at the start of a day."""
    return datetime.combine(day, time(), UTC)


def after(day: date, days: int) -> datetime:
    """Midnight UTC `days` days after a day: when a value published with that lag is known."""
    return day_start(day + timedelta(days=days))
