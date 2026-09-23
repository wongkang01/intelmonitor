"""`im ingest`: fetch, cache, parse and dedup the corpus for the 60 days ending at T0.

Order matters for dedup (the first copy of a document wins): official sources, then news
searches, then gap searches for subjects that still have fewer than GAP_TARGET candidates.
T0 is fixed on the first run and stored in the meta table, so reruns send the same requests and
are served entirely from the cache.
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
)
from intelmonitor.seed import load_subjects
from intelmonitor.store.db import connect, get_meta, set_meta
from intelmonitor.store.documents import SourceDocument, insert_document

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
    # from this run's results (not the store), so a rerun picks the same subjects.
    counts = candidate_counts((d.title, d.text) for d in seen)
    matchers = {m.id: m for m in subject_matchers()}
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

    network, cached = sum(http.network.values()), sum(http.cached.values())
    log(f"requests: {network} external, {cached} served from cache")
    log(f"external by source: {dict(sorted(http.network.items()))}")
    return result


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
