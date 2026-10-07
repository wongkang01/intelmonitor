"""MAS statistics APIs: Monthly Statistical Bulletin tables I.18, I.12A and I.5B, daily exchange
rates and daily domestic interest rates (SORA). Each API has its own key, sent in the `keyid`
header.

A table URL without a filter returns the whole table in one call (the gateway answers malformed
OData queries with an HTML page, so none is sent). Rows carry `create_date`, and `p_ind: "P"` while
preliminary. Exchange rates are SGD per unit, or per 100 units for fields ending in _100; values
are stored per unit. A SORA value is published on the next business day at 9am SGT, as its row's
`published_date` says.
"""

import calendar
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError

from intelmonitor.config import Settings
from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.series.models import (
    Fetched,
    SourceError,
    Window,
    after,
    get_json,
)
from intelmonitor.seed import MasSource, MasTable
from intelmonitor.store.series import Observation

NAMESPACE = "mas-stats"
_SGT = ZoneInfo("Asia/Singapore")
# Daily tables for a span this short are fetched one day per call; longer spans take the whole
# table (exchange rates 3 MB since 2003, interest rates 7 MB since 1987) in one call.
_PER_DAY_MAX_DAYS = 45
# A day's rates may be missing or preliminary for a few days, so those days are refetched daily.
_RECENT_DAYS = 7


@dataclass(frozen=True)
class _Table:
    path: str
    key: Callable[[Settings], str]
    key_name: str
    period: Literal["month", "quarter", "day"]
    lag_days: int  # usual days from period end to publication


_MSB = "server/monthly_statistical_bulletin"
TABLES: dict[MasTable, _Table] = {
    "i18": _Table(
        f"{_MSB}/table_i_18_commercial_banks_non_bank_loan_to_deposit_ratios_ltd/views/"
        "table_i_18_commercial_banks_non_bank_loan_to_deposit_ratios_ltd",
        lambda s: s.mas_bank_liquidity_api_key,
        "MAS_BANK_LIQUIDITY_API_KEY",
        "month",
        31,
    ),
    "i12a": _Table(
        f"{_MSB}/table_i_12a_commercial_banks_non_performing_loans_by_sector_npl/views/"
        "table_i_12a_commercial_banks_non_performing_loans_by_sector_npl",
        lambda s: s.mas_bank_asset_quality_api_key,
        "MAS_BANK_ASSET_QUALITY_API_KEY",
        "quarter",
        62,
    ),
    "i5b": _Table(
        f"{_MSB}/table_i_5b_commercial_banks_loans_and_advances_to_non_residents_by_industry/"
        "views/table_i_5b_commercial_banks_loans_and_advances_to_non_residents_by_industry",
        lambda s: s.mas_bank_exposure_api_key,
        "MAS_BANK_EXPOSURE_API_KEY",
        "month",
        31,
    ),
    "fx": _Table(
        "server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily/views/"
        "exchange_rates_end_of_period_daily",
        lambda s: s.mas_exchange_rates_api_key,
        "MAS_EXCHANGE_RATES_API_KEY",
        "day",
        1,
    ),
    "sora": _Table(
        "server/monthly_statistical_bulletin_non610mssql/domestic_interest_rates_daily/views/"
        "domestic_interest_rates_daily",
        lambda s: s.mas_sora_key,
        "MAS_SORA_KEY",
        "day",
        1,
    ),
}
_PUBLISHED_AT = time(9)  # SGT: SORA's publication time


class _Row(BaseModel):
    """A bulletin table row. Value fields vary by table and are read by name from the extras."""

    model_config = ConfigDict(extra="allow")
    year: int
    month: int | None = None
    quarter: int | None = None
    create_date: datetime
    p_ind: str | None


class _TableResponse(BaseModel):
    name: str
    elements: list[_Row]


class _DayRow(BaseModel):
    """A row of a daily table: exchange rates ("1" while preliminary) or interest rates (1)."""

    model_config = ConfigDict(extra="allow")
    end_of_day: date
    preliminary: str | int
    published_date: datetime | None = None  # interest rates only

    def known_at(self, lag_days: int) -> datetime:
        if self.published_date is None:
            return after(self.end_of_day, lag_days)
        day = self.published_date.date()
        return datetime.combine(day, _PUBLISHED_AT, _SGT).astimezone(UTC)


class _DayResponse(BaseModel):
    name: str
    elements: list[_DayRow]


# Exchange rates come as strings, table values as numbers; both validate as floats.
_value: TypeAdapter[float | None] = TypeAdapter(float | None)


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _period(row: _Row, table: _Table) -> date:
    if table.period == "month" and row.month is not None:
        return _month_end(row.year, row.month)
    if table.period == "quarter" and row.quarter is not None:
        return _month_end(row.year, row.quarter * 3)
    raise SourceError(f"row {row.year} has no {table.period}")


def _available_at(period: date, created: datetime, lag_days: int) -> datetime:
    """The row's create date, unless it is too late to be the first release: MAS reloads whole
    tables (every row said 2026-08-31 when probed), so an old row's create date is the reload,
    not its publication. Those rows get period end plus the table's usual lag."""
    created_utc = created.replace(tzinfo=created.tzinfo or _SGT).astimezone(UTC)
    if created_utc.date() <= period + timedelta(days=2 * lag_days):
        return created_utc
    return after(period, lag_days)


type _Rows = list[tuple[date, bool, datetime, dict[str, object] | None]]


def _number(extra: dict[str, object] | None, field: str) -> float | None:
    """A field's value; None when the source left it empty. A missing field is a schema change."""
    if extra is None or field not in extra:
        raise SourceError(f"field {field} is missing")
    try:
        return _value.validate_python(extra[field])
    except ValidationError as e:
        raise SourceError(f"field {field} is not a number") from e


def _collect(fetched: Fetched, sources: Mapping[str, MasSource], rows: _Rows, floor: date) -> None:
    """Turns (period, preliminary, available_at, fields) rows into each series' observations."""
    for series_id, source in sources.items():
        observations: list[Observation] = []
        try:
            for period, preliminary, available_at, extra in rows:
                value = _number(extra, source.field)
                if period >= floor and value is not None:
                    observations.append(
                        Observation(
                            period=period,
                            value=value / source.per,
                            preliminary=preliminary,
                            available_at=available_at,
                        )
                    )
        except SourceError as e:
            fetched.fail([series_id], str(e))
            continue
        fetched.observations[series_id] = observations


def _day_rows(http: CachedHttp, url: str, headers: dict[str, str], window: Window) -> list[_DayRow]:
    """The whole table for a long span, else one call per weekday from window.start to today.
    Recent days carry the fetch date in their cache key, so a day not yet published is asked
    again tomorrow; older days stay cached."""
    if (window.today - window.start).days > _PER_DAY_MAX_DAYS:
        response = get_json(
            http, NAMESPACE, url, _DayResponse, headers=headers, vary=window.today.isoformat()
        )
        return response.elements
    rows: list[_DayRow] = []
    day = window.start
    while day <= window.today:
        if day.weekday() < 5:
            recent = (window.today - day).days < _RECENT_DAYS
            response = get_json(
                http,
                NAMESPACE,
                url,
                _DayResponse,
                params={"end_of_day": day.isoformat()},
                headers=headers,
                vary=window.today.isoformat() if recent else None,
            )
            rows += response.elements
        day += timedelta(days=1)
    return rows


def fetch(
    http: CachedHttp, settings: Settings, sources: Mapping[str, MasSource], window: Window
) -> Fetched:
    fetched = Fetched()
    for table_id, table in TABLES.items():
        wanted = {sid: s for sid, s in sources.items() if s.table == table_id}
        if not wanted:
            continue
        key = table.key(settings)
        if not key:
            fetched.fail(wanted, f"{table.key_name} is not set")
            continue
        url = f"{settings.mas_api_base_url}/{table.path}"
        headers = {"keyid": key}
        try:
            if table.period == "day":
                rows: _Rows = [
                    (
                        d.end_of_day,
                        str(d.preliminary) == "1",
                        d.known_at(table.lag_days),
                        d.model_extra,
                    )
                    for d in _day_rows(http, url, headers, window)
                ]
            else:
                response = get_json(
                    http,
                    NAMESPACE,
                    url,
                    _TableResponse,
                    headers=headers,
                    vary=window.today.isoformat(),
                )
                rows = []
                for r in response.elements:
                    period = _period(r, table)
                    available = _available_at(period, r.create_date, table.lag_days)
                    rows.append((period, r.p_ind == "P", available, r.model_extra))
        except SourceError as e:
            fetched.fail(wanted, f"MAS {table_id.upper()}: {e}")
            continue
        _collect(fetched, wanted, sorted(rows, key=lambda r: r[0]), window.floor)
    return fetched
