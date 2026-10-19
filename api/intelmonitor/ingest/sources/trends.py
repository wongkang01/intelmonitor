"""Search trends for the trends table, one snapshot per ingest T0.

- Google trending searches over the past 7 days in Business and Finance, for Singapore and four
  regional geos (SerpApi, one call per geo). Without a SerpApi key, the Trends RSS feed per geo
  stands in; it only shows what is trending at fetch time.
- Google interest over time for tracked subjects in Singapore over the 90 days ending at T0, up
  to 5 terms per call (SerpApi). Values are relative within a call, so a term is compared with its
  own baseline; peers share a call so their levels are comparable too.
- X trends for Singapore (one X trends call).

Each trending term is flagged with the tracked subjects it names. Requests are keyed by T0, so a
rerun of the same ingest is served from the cache. Trending searches and X trends are skipped for
a T0 more than 7 days back, which they cannot describe. The free SerpApi plan has 250 searches a
month; an ingest uses 9.
"""

import json
import re
import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import lru_cache
from xml.etree import ElementTree

from pydantic import BaseModel, Field

from intelmonitor.ingest.http import CachedHttp, FetchError, JSONValue
from intelmonitor.ingest.sources.social import X_TRENDS_USD, XSpend
from intelmonitor.seed import load_subjects

SERPAPI = "https://serpapi.com/search.json"
TRENDS_RSS = "https://trends.google.com.sg/trending/rss"
X_TRENDS = "https://api.x.com/2/trends/by/woeid/{woeid}"
TRENDING_GEOS = ["SG", "MY", "ID", "TH", "HK"]
BUSINESS_AND_FINANCE = "3"
TRENDING_DAYS = 7  # trending searches cover the 7 days before the fetch
INTEREST_DAYS = 90
SINGAPORE_WOEID = 23424948
# Interest over time: one call per group of peers, each term with the subject it stands for.
# Terms are what people type; an ambiguous name gets a qualifier ("FAST transfer").
INTEREST_CALLS: list[list[tuple[str, str]]] = [
    [("dbs", "DBS"), ("ocbc", "OCBC"), ("uob", "UOB"), ("sgx", "SGX"), ("hkex", "HKEX")],
    [
        ("paynow", "PayNow"),
        ("nets", "NETS"),
        ("fast", "FAST transfer"),
        ("visa", "Visa card"),
        ("mastercard", "Mastercard"),
    ],
    [
        ("aws", "AWS"),
        ("microsoft-azure", "Microsoft Azure"),
        ("microsoft-365", "Microsoft 365"),
        ("google-cloud", "Google Cloud"),
        ("oracle-cloud", "Oracle Cloud"),
    ],
    [
        ("singtel", "Singtel"),
        ("crowdstrike", "CrowdStrike"),
        ("equinix", "Equinix"),
        ("mas", "Monetary Authority of Singapore"),
        ("swift", "SWIFT payment"),
    ],
    [("circle", "USDC"), ("straitsx", "XSGD"), ("okx", "OKX"), ("coinbase", "Coinbase")],
]
# Names too common to flag a trending search on their own once case is ignored.
_AMBIGUOUS = {
    "fast",
    "nets",
    "bot",
    "swift",
    "visa",
    "giro",
    "ibg",
    "oci",
    "gcp",
    "m365",
    "hk",
    "circle",
}


@lru_cache
def _trend_matchers() -> list[tuple[str, re.Pattern[str]]]:
    """Case-insensitive matchers for trending searches (typed in lower case): entity names and
    aliases, except countries (nearly every Singapore search names Singapore) and common words,
    and topic names and keywords."""
    seed = load_subjects()
    named = [(t.id, [t.name, *t.keywords]) for t in seed.topics]
    named += [(e.id, [e.name, *e.aliases]) for e in seed.entities if e.kind != "country"]
    matchers: list[tuple[str, re.Pattern[str]]] = []
    for subject_id, terms in named:
        kept = [re.escape(t) for t in terms if t.lower() not in _AMBIGUOUS]
        if kept:
            matchers.append((subject_id, re.compile(rf"(?<!\w)(?:{'|'.join(kept)})(?!\w)", re.I)))
    return matchers


def trend_subjects(terms: Iterable[str]) -> list[str]:
    """Ids of tracked subjects that any of the terms names."""
    text = "\n".join(terms)
    return [subject_id for subject_id, pattern in _trend_matchers() if pattern.search(text)]


@dataclass(frozen=True)
class TrendRow:
    source: str  # google, google_rss or x
    kind: str  # trending or interest
    geo: str
    term: str
    observed_at: str
    value: float | None
    subjects: list[str] = field(default_factory=list[str])
    detail: dict[str, JSONValue] = field(default_factory=dict[str, JSONValue])


def store_trends(conn: sqlite3.Connection, snapshot: date, rows: list[TrendRow]) -> None:
    fetched_at = datetime.now(UTC).isoformat()
    conn.executemany(
        "INSERT OR REPLACE INTO trends (snapshot, source, kind, geo, term, observed_at, value, "
        "subjects, detail, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                snapshot.isoformat(),
                r.source,
                r.kind,
                r.geo,
                r.term,
                r.observed_at,
                r.value,
                json.dumps(r.subjects),
                json.dumps(r.detail),
                fetched_at,
            )
            for r in rows
        ],
    )
    conn.commit()


def _serpapi(http: CachedHttp, key: str, params: dict[str, str], vary: str | None) -> bytes:
    response = http.get(
        "serpapi",
        SERPAPI,
        params=params,
        secret_params={"api_key": key},
        expect_json=True,
        vary=vary,
        cache_errors=False,
    )
    if not response.ok:
        raise FetchError(f"SerpApi {params['engine']}: HTTP {response.status}")
    return response.content


class _Category(BaseModel):
    name: str


class _Trending(BaseModel):
    query: str
    start_timestamp: int
    end_timestamp: int | None = None
    active: bool | None = None
    search_volume: int | None = None
    increase_percentage: int | None = None
    categories: list[_Category] = Field(default_factory=list[_Category])
    trend_breakdown: list[str] | None = None


class _TrendingNow(BaseModel):
    trending_searches: list[_Trending] = Field(default_factory=list[_Trending])


def google_trending(http: CachedHttp, key: str, geo: str, t0: date) -> list[TrendRow]:
    """Searches trending in Business and Finance over the 7 days before the fetch."""
    params = {
        "engine": "google_trends_trending_now",
        "geo": geo,
        "hours": str(TRENDING_DAYS * 24),
        "category_id": BUSINESS_AND_FINANCE,
    }
    found = _TrendingNow.model_validate_json(_serpapi(http, key, params, t0.isoformat()))
    rows: list[TrendRow] = []
    for t in found.trending_searches:
        related = t.trend_breakdown or []
        detail: dict[str, JSONValue] = {
            "increase_percentage": t.increase_percentage,
            "active": t.active,
            "ended_at": _iso(t.end_timestamp) if t.end_timestamp else None,
            "categories": [c.name for c in t.categories],
            "related": list[JSONValue](related),
        }
        rows.append(
            TrendRow(
                "google",
                "trending",
                geo,
                t.query,
                _iso(t.start_timestamp),
                t.search_volume,
                trend_subjects([t.query, *related]),
                detail,
            )
        )
    return rows


def _iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, UTC).isoformat()


_HT = "{https://trends.google.com/trending/rss}"


def rss_trending(http: CachedHttp, geo: str, t0: date) -> list[TrendRow]:
    """The Trends RSS feed: what is trending in a geo at fetch time, every category."""
    response = http.get("trends_rss", TRENDS_RSS, params={"geo": geo}, vary=t0.isoformat())
    if not response.ok:
        raise FetchError(f"Trends RSS {geo}: HTTP {response.status}")
    rows: list[TrendRow] = []
    for item in ElementTree.fromstring(response.content).iter("item"):
        term = item.findtext("title") or ""
        traffic = re.sub(r"\D", "", item.findtext(f"{_HT}approx_traffic") or "")
        published = item.findtext("pubDate")
        news = [n.findtext(f"{_HT}news_item_title") or "" for n in item.iter(f"{_HT}news_item")]
        rows.append(
            TrendRow(
                "google_rss",
                "trending",
                geo,
                term,
                parsedate_to_datetime(published).astimezone(UTC).isoformat() if published else "",
                float(traffic) if traffic else None,
                trend_subjects([term]),
                {"news": list[JSONValue](news)},
            )
        )
    return rows


class _Value(BaseModel):
    query: str
    extracted_value: float


class _Point(BaseModel):
    timestamp: str
    partial_data: bool = False
    values: list[_Value]


class _Timeline(BaseModel):
    timeline_data: list[_Point] = Field(default_factory=list[_Point])


class _InterestOverTime(BaseModel):
    interest_over_time: _Timeline = Field(default_factory=_Timeline)


def google_interest(
    http: CachedHttp, key: str, terms: list[tuple[str, str]], t0: date
) -> list[TrendRow]:
    """Daily interest in Singapore over the INTEREST_DAYS days ending at T0, for up to 5 terms.
    The request names its dates, so it needs no T0 key."""
    start = t0 - timedelta(days=INTEREST_DAYS)
    params = {
        "engine": "google_trends",
        "q": ",".join(term for _, term in terms),
        "geo": "SG",
        "date": f"{start} {t0}",
        "data_type": "TIMESERIES",
    }
    found = _InterestOverTime.model_validate_json(_serpapi(http, key, params, None))
    subject_of = {term: subject_id for subject_id, term in terms}
    call: list[JSONValue] = [term for _, term in terms]
    return [
        TrendRow(
            "google",
            "interest",
            "SG",
            v.query,
            datetime.fromtimestamp(int(p.timestamp), UTC).date().isoformat(),
            v.extracted_value,
            [subject_of[v.query]] if v.query in subject_of else [],
            {"call": call, "partial": p.partial_data},
        )
        for p in found.interest_over_time.timeline_data
        for v in p.values
    ]


class _XTrend(BaseModel):
    trend_name: str
    tweet_count: int | None = None


class _XTrends(BaseModel):
    data: list[_XTrend] = Field(default_factory=list[_XTrend])


def x_trends(http: CachedHttp, token: str, t0: date, spend: XSpend) -> list[TrendRow]:
    """X trends for Singapore now, as a snapshot dated T0."""
    if spend.usd + X_TRENDS_USD > spend.cap_usd:
        spend.skipped.append("trends (spend cap)")
        return []
    cached_before = http.cached["x"]
    response = http.get(
        "x",
        X_TRENDS.format(woeid=SINGAPORE_WOEID),
        params={"max_trends": "50", "trend.fields": "trend_name,tweet_count"},
        headers={"Authorization": f"Bearer {token}"},
        expect_json=True,
        vary=t0.isoformat(),
        cache_errors=False,
    )
    if not response.ok:
        raise FetchError(f"X trends: HTTP {response.status} {response.text()[:300]}")
    if http.cached["x"] == cached_before:
        spend.trend_calls += 1
    return [
        TrendRow(
            "x",
            "trending",
            "SG",
            t.trend_name,
            t0.isoformat(),
            t.tweet_count,
            trend_subjects([t.trend_name]),
            {"rank": rank},
        )
        for rank, t in enumerate(_XTrends.model_validate_json(response.content).data, 1)
    ]


@dataclass
class TrendsResult:
    rows: Counter[str] = field(default_factory=Counter[str])  # by source and kind
    serpapi_searches: int = 0  # sent to SerpApi this ingest (not served from the cache)
    flagged: list[str] = field(default_factory=list[str])  # trending terms naming a subject
    failures: list[str] = field(default_factory=list[str])


def fetch_trends(
    conn: sqlite3.Connection,
    http: CachedHttp,
    t0: date,
    serpapi_key: str,
    x_token: str,
    spend: XSpend,
    subject_ids: set[str] | None = None,
    log: Callable[[str], None] = print,
) -> TrendsResult:
    """Fetch and store the trends snapshot for T0. With `subject_ids`, interest over time only
    runs the calls that hold one of them; trending searches are not limited by subject."""
    result = TrendsResult()
    rows: list[TrendRow] = []
    serpapi_before = http.network["serpapi"]

    def attempt(label: str, fetch: Callable[[], list[TrendRow]]) -> None:
        try:
            rows.extend(fetch())
        except FetchError as e:
            result.failures.append(f"{label}: {e}")
            log(f"failed: {label}: {e}")

    # Trending searches and X trends describe the days before the fetch, so they only stand for
    # a T0 within that reach; an older T0 (a replayed ingest) gets interest over time only.
    current = datetime.now(UTC).date() - t0 <= timedelta(days=TRENDING_DAYS)
    if not current:
        log(f"trends: T0 more than {TRENDING_DAYS} days back, trending searches skipped")
    for geo in TRENDING_GEOS if current else []:
        if serpapi_key:
            attempt(f"trending {geo}", lambda geo=geo: google_trending(http, serpapi_key, geo, t0))
        else:
            attempt(f"trends rss {geo}", lambda geo=geo: rss_trending(http, geo, t0))
    if serpapi_key:
        for call in INTEREST_CALLS:
            if subject_ids is None or any(s in subject_ids for s, _ in call):
                label = f"interest {', '.join(t for _, t in call)}"
                attempt(label, lambda call=call: google_interest(http, serpapi_key, call, t0))
    if x_token and current:
        attempt("x trends", lambda: x_trends(http, x_token, t0, spend))
    store_trends(conn, t0, rows)
    result.rows.update(f"{r.source} {r.kind}" for r in rows)
    result.serpapi_searches = http.network["serpapi"] - serpapi_before
    result.flagged = [
        f"{r.source} {r.geo} '{r.term}': {', '.join(r.subjects)}"
        for r in rows
        if r.kind == "trending" and r.subjects
    ]
    log(f"trends: {dict(result.rows)}, {result.serpapi_searches} SerpApi searches")
    for line in result.flagged:
        log(f"  trending {line}")
    return result
