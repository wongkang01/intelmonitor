"""News and gap search (Exa, Tavily), with queries generated from subjects.yaml.

News searches are limited to NEWS_DOMAINS. Gap searches for thinly covered subjects add the
subject's own domains, whose results are stored as official disclosures.

Some sites get wrong dates from the search APIs (a page header printing today's date, or a crawl
date), so an article from 2014 comes back dated this week. For those sites (PAGE_DATES) the date
is read from the article page instead, and a result whose page date is missing is dropped. Sites
that refuse our page fetches but print the date in the article text the search API returns
(TEXT_DATES) are dated from that text, with the same rule. On any site, a /YYYY/MM/DD/ date in the
article URL that is days earlier than the date found wins (The Register's 2016 articles came back
dated 2026).
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from intelmonitor.ingest.http import CachedHttp, FetchError, JSONValue
from intelmonitor.ingest.models import MIN_TEXT_CHARS, RawDocument, Window
from intelmonitor.ingest.parse import domain_of
from intelmonitor.seed import Entity, SubjectsSeed

NEWS_DOMAINS = [
    "reuters.com",
    "ft.com",
    "bloomberg.com",
    "cnbc.com",
    "asia.nikkei.com",
    "straitstimes.com",
    "businesstimes.com.sg",
    "channelnewsasia.com",
    "scmp.com",
    "theedgesingapore.com",
    "theedgemalaysia.com",
    "thestar.com.my",
    "bangkokpost.com",
    "nationthailand.com",
    "thejakartapost.com",
    "e.vnexpress.net",
    "apnews.com",
    "wsj.com",
    # Technology, cyber and capital markets outlets for the TCRD and FMD sessions.
    "therecord.media",
    "bleepingcomputer.com",
    "theregister.com",
    "datacenterdynamics.com",
    "risk.net",
    "fintechnews.sg",
    "asiaasset.com",
    "asianinvestor.net",
    "mondovisione.com",
    "economist.com",
]
# Outlets whose single report is enough to show a development (pipeline/corroboration.py).
REPUTABLE_DOMAINS = [
    "reuters.com",
    "straitstimes.com",
    "bloomberg.com",
    "channelnewsasia.com",
    "scmp.com",
    "cnbc.com",
    "wsj.com",
    "ft.com",
    "businesstimes.com.sg",
    "apnews.com",
    "asia.nikkei.com",
    "economist.com",
    "therecord.media",
    "bleepingcomputer.com",
]
EXA_RESULTS_PER_QUERY = 5
GAP_RESULTS_PER_QUERY = 10
GAP_NEWS_RESULTS = 25
_TEXT_MAX_CHARS = 20000
# Search hits that are index, tag, topic, company, quote or sponsored pages rather than articles.
_NOT_ARTICLE = re.compile(
    r"^https?://(search|partners|professional\.content\.[^/]+)\."
    r"|/(tag|tags|topics?|topics-and-tech|search|blog-category|category|author|company"
    r"|organisations)(/|$)"
    r"|/markets/companies/|/presented/"
)


_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


def _edge_created(html: str) -> datetime | None:
    """The Edge Malaysia: the article's `created` epoch (ms) in its Next.js page data."""
    match = _NEXT_DATA.search(html)
    if not match:
        return None
    try:
        created = json.loads(match.group(1))["props"]["pageProps"]["data"]["created"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return None
    return datetime.fromtimestamp(created / 1000, UTC) if isinstance(created, int) else None


_PUBLISHED_META = re.compile(r'<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"')


def _meta_published(html: str) -> datetime | None:
    """The page's Open Graph `article:published_time` tag."""
    match = _PUBLISHED_META.search(html)
    if not match:
        return None
    try:
        return datetime.fromisoformat(match.group(1))
    except ValueError:
        return None


_MONTH_DAY_YEAR = re.compile(
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r" \d{1,2}, \d{4}"
)


def _dcd_dateline(text: str) -> datetime | None:
    """DCD: the "October 09, 2015" line under the headline and standfirst."""
    match = _MONTH_DAY_YEAR.search(text[:600])
    return datetime.strptime(match.group(0), "%B %d, %Y").replace(tzinfo=UTC) if match else None


# Domains whose search-API dates are unreliable, with how to read the date from the page.
PAGE_DATES: dict[str, Callable[[str], datetime | None]] = {
    "theedgemalaysia.com": _edge_created,
    "asiaasset.com": _meta_published,
}
# The same for domains whose pages refuse our fetches (DCD sits behind a bot check): the date is
# read from the article text the search API returned.
TEXT_DATES: dict[str, Callable[[str], datetime | None]] = {"datacenterdynamics.com": _dcd_dateline}


_URL_DATE = re.compile(r"/(20\d\d)/(\d\d)/(\d\d)/")


def _url_date(url: str) -> datetime | None:
    """The /YYYY/MM/DD/ date in an article URL, if it has a valid one."""
    match = _URL_DATE.search(urlsplit(url).path)
    try:
        return datetime(*map(int, match.groups()), tzinfo=UTC) if match else None
    except ValueError:
        return None


def url_dated(url: str, published: datetime) -> datetime:
    """`published`, or the /YYYY/MM/DD/ date in the URL when that is more than 2 days earlier.
    Applied at ingest and by `im redate` to documents already stored."""
    dated = _url_date(url)
    return dated if dated and dated < published - timedelta(days=2) else published


def _with_page_date(http: CachedHttp, doc: RawDocument) -> RawDocument | None:
    """The document dated from its own page when its domain is in PAGE_DATES or TEXT_DATES,
    or from its URL when that date is days earlier; None when a page date cannot be read."""
    domain = domain_of(doc.url)
    if read_text := TEXT_DATES.get(domain):
        published = read_text(doc.text)
    elif read_page := PAGE_DATES.get(domain):
        try:
            response = http.get("pages", doc.url)
        except FetchError:
            return None
        published = read_page(response.text()) if response.ok else None
    else:
        published = doc.published_at
    if published is None:
        return None
    return doc.model_copy(update={"published_at": url_dated(doc.url, published)})


@dataclass(frozen=True)
class SearchQuery:
    subject_id: str
    text: str


def _entity_label(entity: Entity) -> str:
    return f"{entity.name} ({entity.aliases[0]})" if entity.aliases else entity.name


def subject_label(seed: SubjectsSeed, subject_id: str) -> str:
    """How a subject is named in a search query."""
    for e in seed.entities:
        if e.id == subject_id:
            return _entity_label(e)
    for g in seed.groups:
        if g.id == subject_id:
            members = {e.id: e.name for e in seed.entities}
            return f"{g.name} {' '.join(members[m] for m in g.members)}"
    return next(t.name for t in seed.topics if t.id == subject_id)


def gap_query(entity: Entity) -> str:
    """Exact-phrase query for a thin entity: its quoted name plus its shortest alias, which
    finds articles that name it far more reliably than a descriptive query."""
    shortest = min(entity.aliases, key=len, default="")
    return f'"{entity.name}" {shortest}'.strip()


def news_queries(seed: SubjectsSeed) -> list[SearchQuery]:
    """One query per topic keyword, one per group (its name and members), and per entity one
    general query plus one per topic linked through its groups."""
    topic_names = {t.id: t.name for t in seed.topics}
    queries = [SearchQuery(t.id, k) for t in seed.topics for k in t.keywords]
    queries += [SearchQuery(g.id, subject_label(seed, g.id)) for g in seed.groups]
    for e in seed.entities:
        label = _entity_label(e)
        linked = dict.fromkeys(t for g in seed.groups if e.id in g.members for t in g.topics)
        queries.append(SearchQuery(e.id, f"{label} latest news"))
        queries += [SearchQuery(e.id, f"{label} {topic_names[t]}") for t in linked]
    return queries


# --- Exa -----------------------------------------------------------------------------------

EXA_SEARCH = "https://api.exa.ai/search"


class _ExaResult(BaseModel):
    url: str
    title: str | None = None
    published_date: str | None = Field(default=None, alias="publishedDate")
    text: str | None = None


class _ExaResponse(BaseModel):
    results: list[_ExaResult]


def exa_search(
    http: CachedHttp,
    api_key: str,
    query: str,
    window: Window,
    domains: list[str],
    num_results: int,
    own_domains: list[str] | None = None,
) -> list[RawDocument]:
    body: dict[str, JSONValue] = {
        "query": query,
        "type": "auto",
        "numResults": num_results,
        "includeDomains": list(domains),
        "startPublishedDate": f"{window.start}T00:00:00.000Z",
        "endPublishedDate": f"{window.t0}T23:59:59.999Z",
        "contents": {"text": {"maxCharacters": _TEXT_MAX_CHARS}},
    }
    response = http.post_json("exa", EXA_SEARCH, body, headers={"x-api-key": api_key})
    if not response.ok:
        return []
    docs: list[RawDocument] = []
    for r in _ExaResponse.model_validate_json(response.content).results:
        if r.published_date and r.text:
            doc = _search_doc(
                "exa", r.url, r.title, datetime.fromisoformat(r.published_date), r.text, own_domains
            )
            doc = doc and _with_page_date(http, doc)
            if doc and window.contains(doc.published_at):
                docs.append(doc)
    return docs


# --- Tavily --------------------------------------------------------------------------------

TAVILY_SEARCH = "https://api.tavily.com/search"


class _TavilyResult(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    raw_content: str | None = None
    published_date: str | None = None


class _TavilyResponse(BaseModel):
    results: list[_TavilyResult]


def tavily_search(
    http: CachedHttp,
    api_key: str,
    query: str,
    window: Window,
    domains: list[str],
    num_results: int,
    own_domains: list[str] | None = None,
) -> list[RawDocument]:
    body: dict[str, JSONValue] = {
        "query": query,
        "topic": "news",
        "search_depth": "basic",
        "max_results": num_results,
        "start_date": str(window.start),
        "end_date": str(window.t0),
        "include_domains": list(domains),
        "include_raw_content": "text",
    }
    response = http.post_json(
        "tavily", TAVILY_SEARCH, body, headers={"Authorization": f"Bearer {api_key}"}
    )
    if not response.ok:
        return []
    docs: list[RawDocument] = []
    for r in _TavilyResponse.model_validate_json(response.content).results:
        text = r.raw_content or r.content
        if r.published_date and text:
            published = parsedate_to_datetime(r.published_date)
            doc = _search_doc("tavily", r.url, r.title, published, text, own_domains)
            doc = doc and _with_page_date(http, doc)
            if doc and window.contains(doc.published_at):
                docs.append(doc)
    return docs


def _search_doc(
    source: str,
    url: str,
    title: str | None,
    published: datetime,
    text: str,
    own_domains: list[str] | None,
) -> RawDocument | None:
    text = text.strip()
    # Articles sit two or more path segments deep, or at one long slug (therecord.media).
    path_segments = [p for p in urlsplit(url).path.split("/") if p]
    article_path = len(path_segments) >= 2 or (
        len(path_segments) == 1 and path_segments[0].count("-") >= 3
    )
    if len(text) < MIN_TEXT_CHARS or not article_path or _NOT_ARTICLE.search(url):
        return None
    domain = domain_of(url)
    own = any(domain == d or domain.endswith("." + d) for d in own_domains or [])
    return RawDocument(
        source=source,
        collection="official" if own else "news",
        doc_type="Disclosure" if own else "News",
        url=url,
        title=" ".join((title or domain).split()),
        published_at=published,
        text=text,
    )
