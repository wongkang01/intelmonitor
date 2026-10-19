"""`im ingest`: fetch, cache, parse and dedup the corpus for the 60 days ending at T0.

Order matters for dedup (the first copy of a document wins): official sources, then news
searches, then gap searches for subjects that still have fewer than GAP_TARGET candidates, then
social posts and search trends. T0 is fixed on the first run and stored in the meta table, so
reruns send the same requests and are served entirely from the cache.

`im ingest --social-only` runs only the social and trends steps, for the stored T0.
`im redate` applies the URL-date rule to documents stored before it existed, removing those it
dates before the window.
"""

import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from intelmonitor.config import get_settings
from intelmonitor.ingest.candidates import candidate_counts, normalize, subject_matchers
from intelmonitor.ingest.http import CachedHttp, FetchError
from intelmonitor.ingest.models import Listing, RawDocument, Window
from intelmonitor.ingest.parse import (
    canonical_url,
    content_hash,
    document_id,
    domain_of,
    unreverse_lines,
)
from intelmonitor.ingest.sources.official import fetch_listing, official_listings
from intelmonitor.ingest.sources.search import (
    EXA_RESULTS_PER_QUERY,
    GAP_NEWS_RESULTS,
    GAP_RESULTS_PER_QUERY,
    NEWS_DOMAINS,
    SearchQuery,
    exa_search,
    gap_query,
    news_queries,
    subject_label,
    tavily_search,
    url_dated,
)
from intelmonitor.ingest.sources.social import XSpend, fetch_social, store_social_meta
from intelmonitor.ingest.sources.trends import fetch_trends
from intelmonitor.seed import load_subjects
from intelmonitor.store.db import connect, get_meta, set_meta
from intelmonitor.store.documents import SourceDocument, insert_document, list_documents

GAP_TARGET = 8
_PAGE_WORKERS = 8
_SEARCH_WORKERS = 4


@dataclass
class IngestResult:
    t0: date
    added: Counter[str] = field(default_factory=Counter[str])
    duplicates: int = 0
    failures: list[str] = field(default_factory=list[str])
    gap_subjects: list[str] = field(default_factory=list[str])


def resolve_t0(conn: sqlite3.Connection, override: date | None) -> date:
    """T0 from --t0, else the stored T0, else today. The result is stored for later runs."""
    stored = get_meta(conn, "t0")
    t0 = override or (date.fromisoformat(stored) if stored else date.today())
    if stored != t0.isoformat():
        set_meta(conn, "t0", t0.isoformat())
    return t0


def run_ingest(t0_override: date | None = None, log: Callable[[str], None] = print) -> IngestResult:
    settings = get_settings()
    conn = connect()
    window = Window(resolve_t0(conn, t0_override))
    result = IngestResult(t0=window.t0)
    http = CachedHttp()
    # This run's unique documents, deduped like the store (canonical URL and content hash).
    seen: list[RawDocument] = []
    seen_keys: set[str] = set()
    log(f"T0 {window.t0}, window {window.start} to {window.t0}")

    def keep(docs: Iterable[RawDocument]) -> None:
        for doc in docs:
            keys = {canonical_url(doc.url), content_hash(doc.text)}
            if not keys & seen_keys:
                seen.append(doc)
            seen_keys.update(keys)
            if _store(conn, doc):
                result.added[doc.source] += 1
            else:
                result.duplicates += 1
        conn.commit()

    def fail(label: str, error: FetchError) -> None:
        result.failures.append(f"{label}: {error}")
        log(f"failed: {label}: {error}")

    # 1. Official sources: list the window, then fetch each page.
    try:
        listings = official_listings(http, window)
    except FetchError as e:
        fail("official listings", e)
        listings = []

    def fetch(listing: Listing) -> RawDocument | None:
        try:
            return fetch_listing(http, listing)
        except FetchError as e:
            fail(listing.url, e)
            return None

    with ThreadPoolExecutor(_PAGE_WORKERS) as pool:
        keep(d for d in pool.map(fetch, listings) if d is not None)
    log(f"official: {len(listings)} listed, {sum(result.added.values())} stored")

    # 2. News: Exa over reputable domains, queries generated from subjects.yaml.
    seed = load_subjects()
    queries = news_queries(seed)

    def search_news(query: SearchQuery) -> list[RawDocument]:
        try:
            return exa_search(
                http, settings.exa_api_key, query.text, window, NEWS_DOMAINS, EXA_RESULTS_PER_QUERY
            )
        except FetchError as e:
            fail(f"exa {query.text}", e)
            return []

    with ThreadPoolExecutor(_SEARCH_WORKERS) as pool:
        for batch in pool.map(search_news, queries):
            keep(batch)
    log(f"news: {len(queries)} queries, {result.added['exa']} stored")

    # 3. Gaps: for thinly covered subjects, Tavily news, a wider Exa news search, and Exa on the
    # subject's own domains. Only hits that name the subject are kept. Thin subjects are decided
    # from this run's results (not the store), so a rerun picks the same subjects. Groups are not
    # monitored, so only topics and entities get gap searches.
    counts = candidate_counts((d.title, d.text) for d in seen)
    matchers = {m.id: m for m in subject_matchers() if m.type != "group"}
    result.gap_subjects = [m for m in matchers if counts[m] < GAP_TARGET]
    entities = {e.id: e for e in seed.entities}

    def fill_gap(subject_id: str) -> list[RawDocument]:
        label = subject_label(seed, subject_id)
        entity = entities.get(subject_id)
        name = entity.name if entity else label
        own = entity.domains if entity else []
        n = GAP_RESULTS_PER_QUERY
        docs: list[RawDocument] = []
        try:
            docs += tavily_search(
                http, settings.tavily_api_key, name, window, NEWS_DOMAINS + own, n, own
            )
            phrase = gap_query(entity) if entity else f'"{name}"'
            docs += exa_search(
                http, settings.exa_api_key, phrase, window, NEWS_DOMAINS, GAP_NEWS_RESULTS, own
            )
            if own:
                docs += exa_search(http, settings.exa_api_key, label, window, own, n, own)
        except FetchError as e:
            fail(f"gap {label}", e)
        matcher = matchers[subject_id]
        return [d for d in docs if matcher.matches(normalize(f"{d.title}\n{d.text}"))]

    for subject_id in result.gap_subjects:
        keep(fill_gap(subject_id))
    log(f"gaps: {result.gap_subjects}")

    # 4. Social posts and search trends, last so a news copy of a page wins dedup.
    _ingest_social(conn, http, window, result, None, log)

    network, cached = sum(http.network.values()), sum(http.cached.values())
    log(f"requests: {network} external, {cached} served from cache")
    log(f"external by source: {dict(sorted(http.network.items()))}")
    return result


def run_social_ingest(
    subject_ids: set[str] | None = None, log: Callable[[str], None] = print
) -> IngestResult:
    """Only the social and trends steps, for the stored T0, which stays unchanged: adds social
    documents and a trends snapshot to a store that already holds the news corpus. With
    `subject_ids`, only those subjects are searched."""
    conn = connect()
    stored = get_meta(conn, "t0")
    if stored is None:
        raise RuntimeError("no T0 in the store: run a full `im ingest` first")
    window = Window(date.fromisoformat(stored))
    result = IngestResult(t0=window.t0)
    http = CachedHttp()
    log(f"T0 {window.t0} (stored), social and trends only")
    _ingest_social(conn, http, window, result, subject_ids, log)
    log(f"external by source: {dict(sorted(http.network.items()))}")
    return result


def _ingest_social(
    conn: sqlite3.Connection,
    http: CachedHttp,
    window: Window,
    result: IngestResult,
    subject_ids: set[str] | None,
    log: Callable[[str], None],
) -> None:
    """Store social posts with their metadata, then the trends snapshot, and log X reads and
    estimated spend."""
    settings = get_settings()
    spend = XSpend(settings.x_spend_cap_usd)

    def fail(message: str) -> None:
        result.failures.append(message)
        log(f"failed: {message}")

    if not settings.x_bearer_token:
        log("social: no X_BEARER_TOKEN, X skipped")
    found = fetch_social(
        http,
        settings.x_bearer_token,
        settings.tavily_api_key,
        settings.exa_api_key,
        window,
        spend,
        subject_ids,
        log,
        fail,
    )
    social_added = 0
    for item in found:
        if _store(conn, item.doc):
            social_added += 1
            result.added[item.doc.source] += 1
        else:
            result.duplicates += 1
        store_social_meta(conn, document_id(canonical_url(item.doc.url)), item.meta)
    conn.commit()
    log(f"social: {len(found)} found, {social_added} stored")
    trends = fetch_trends(
        conn,
        http,
        window.t0,
        settings.serpapi_api_key,
        settings.x_bearer_token,
        spend,
        subject_ids,
        log,
    )
    result.failures += trends.failures
    log(
        f"x: {spend.searches} searches and {spend.trend_calls} trends calls sent, "
        f"{spend.posts} posts read, estimated {spend.usd:.3f} USD (cap {spend.cap_usd:.2f})"
        + (f"; skipped {', '.join(spend.skipped)}" if spend.skipped else "")
    )


def _store(conn: sqlite3.Connection, doc: RawDocument) -> bool:
    canonical = canonical_url(doc.url)
    text = unreverse_lines(doc.text)
    published = doc.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=UTC)
    return insert_document(
        conn,
        SourceDocument(
            id=document_id(canonical),
            source=doc.source,
            collection=doc.collection,
            doc_type=doc.doc_type,
            classification="public",
            url=doc.url,
            canonical_url=canonical,
            domain=domain_of(doc.url),
            title=doc.title,
            published_at=published.astimezone(UTC),
            text=text,
            content_hash=content_hash(text),
            ingested_at=datetime.now(UTC),
        ),
    )


@dataclass(frozen=True)
class Redated:
    id: str
    url: str
    title: str
    was: datetime
    now: datetime
    removed: bool  # dated before the stored T0's window, so ingest would have dropped it


# Per-document rows a removed document leaves behind; run rows go when the runs are recomputed.
_DOCUMENT_TABLES = ["document_tags", "document_subjects", "findings", "detections", "social_posts"]


def redate_stored(conn: sqlite3.Connection) -> list[Redated]:
    """Apply the URL-date rule (search.url_dated) to every stored document. A document it dates
    before the stored T0's window is removed with its per-document rows, as ingest drops it.
    Returns what changed; the affected runs must be recomputed afterwards."""
    stored = get_meta(conn, "t0")
    if stored is None:
        raise RuntimeError("no T0 in the store: run `im ingest` first")
    window = Window(date.fromisoformat(stored))
    changed: list[Redated] = []
    for doc in list_documents(conn):
        now = url_dated(doc.url, doc.published_at)
        if now != doc.published_at:
            removed = now.date() < window.start
            changed.append(Redated(doc.id, doc.url, doc.title, doc.published_at, now, removed))
    with conn:
        conn.executemany(
            "UPDATE source_documents SET published_at = ? WHERE id = ?",
            [(r.now.isoformat().replace("+00:00", "Z"), r.id) for r in changed if not r.removed],
        )
        removed = [(r.id,) for r in changed if r.removed]
        for table in [*_DOCUMENT_TABLES, "source_documents"]:
            column = "id" if table == "source_documents" else "document_id"
            conn.executemany(f"DELETE FROM {table} WHERE {column} = ?", removed)  # noqa: S608
    return changed
