"""News and gap search (Exa, Tavily), with queries generated from subjects.yaml.

News searches are limited to NEWS_DOMAINS. Gap searches for thinly covered subjects add the
subject's own domains, whose results are stored as official disclosures.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from intelmonitor.ingest.http import CachedHttp, JSONValue
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
    "inquirer.net",
    "apnews.com",
    "wsj.com",
    "coindesk.com",
    "theblock.co",
]
EXA_RESULTS_PER_QUERY = 5
GAP_RESULTS_PER_QUERY = 10
GAP_NEWS_RESULTS = 25
_TEXT_MAX_CHARS = 20000
# Search hits that are index, tag, quote or sponsored pages rather than articles.
_NOT_ARTICLE = re.compile(
    r"^https?://(search|partners|professional\.content\.[^/]+)\."
    r"|/(tag|tags|search|blog-category|category|author)(/|$)"
    r"|/markets/companies/|/presented/"
)


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
    topic_names = {t.id: t.name.lower() for t in seed.topics}
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
    path_segments = [p for p in urlsplit(url).path.split("/") if p]
    if len(text) < MIN_TEXT_CHARS or len(path_segments) < 2 or _NOT_ARTICLE.search(url):
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
