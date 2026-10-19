"""Social posts for the `social` collection: X recent search, and Reddit and forum threads found
through Tavily and Exa.

Only subjects where posts tend to come before news are searched (TARGETS): the banks, payment
systems, technology providers, exchanges, stablecoin issuers and crypto exchanges, MAS, and the IT
outage and cyber topics with targeted queries. Each ingest runs one Tavily search and one Exa
search per target, and one X search for each target with an X query.

X bills each post read (X_POST_USD), so every X search is capped at its target's `max_posts` and
the ingest stops searching X once the next search could pass the spend cap. Responses are cached
like every other source, so a rerun of the same ingest reads nothing from X. X recent search only
reaches back 7 days; forum threads come from the whole ingest window.

Every social document carries an accurate timestamp: X gives each post's creation time, an X post
found by Tavily is dated from its id, a HardwareZone thread from its first page, and a Reddit
thread from Exa's date. Reddit refuses page fetches and Tavily gives no dates, so Tavily's Reddit
hits are dropped, as the news searches drop what they cannot date.
"""

import re
import sqlite3
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta

from pydantic import BaseModel, Field

from intelmonitor.ingest.candidates import normalize, subject_matchers
from intelmonitor.ingest.http import CachedHttp, FetchError, JSONValue
from intelmonitor.ingest.models import RawDocument, Window
from intelmonitor.ingest.parse import domain_of

X_POST_USD = 0.005  # pay-per-use price of one post read
X_TRENDS_USD = 0.010  # and of one trends call
SOCIAL_DOMAINS = ["reddit.com", "forums.hardwarezone.com.sg"]
FORUM_RESULTS = 10
MIN_POST_CHARS = 40
_TEXT_MAX_CHARS = 20000
# Problem words that turn a name into an early-warning search.
# Phrases rather than "down", which mostly finds share prices and "doubling down".
_DOWN = '(outage OR "is down" OR "went down" OR "are down" OR disruption OR "not working"'
# Bank app names are specific enough for a plain "down"; market chatter is left out.
_TROUBLE = (
    '(down OR outage OR disruption OR "not working" OR glitch OR scam OR fraud OR hacked OR breach)'
    ' -stock -stocks -shares -"share price" -dividend'
)
_OUTAGE = f"{_DOWN} OR degraded)"


@dataclass(frozen=True)
class SocialTarget:
    """A subject searched on social platforms: its X query (search operators, before the shared
    filters), its forum query (plain words for Tavily and Exa) and the most X posts to read."""

    subject_id: str
    x_query: str | None  # None: forums only, where X finds mostly noise
    forum_query: str
    max_posts: int = 20


# Banks, payment systems, technology providers, exchanges, digital asset firms, MAS and two topics.
# GIRO, MEPS+, BCS and the core banking and print vendors are left out: the public does not post
# about them.
TARGETS = [
    SocialTarget(
        "dbs",
        f'(digibank OR POSB OR PayLah OR @dbsbank OR "DBS bank" OR "DBS app") {_TROUBLE}',
        "DBS digibank PayLah down outage",
        30,
    ),
    SocialTarget(
        "ocbc", f'(OCBC OR @OCBCBank OR "OCBC app") {_TROUBLE}', "OCBC app down outage", 30
    ),
    SocialTarget(
        "uob", f'(UOB OR "UOB TMRW" OR @UOB_Group) {_TROUBLE}', "UOB TMRW app down outage", 30
    ),
    SocialTarget(
        "mas",
        '("Monetary Authority of Singapore" OR @MAS_sg)',
        "Monetary Authority of Singapore MAS",
    ),
    SocialTarget(
        "sgx",
        '(SGX OR "Singapore Exchange") (halt OR halted OR outage OR glitch OR suspended OR '
        "disruption OR delay)",
        "SGX trading halt outage glitch",
    ),
    SocialTarget(
        "hkex",
        '(HKEX OR "Hong Kong stock exchange") (halt OR halted OR outage OR glitch OR suspended '
        "OR disruption)",
        "HKEX trading halt outage glitch",
    ),
    SocialTarget(
        "paynow",
        'PayNow (down OR outage OR "not working" OR delay OR disruption OR scam)',
        "PayNow down not working",
    ),
    SocialTarget(
        "fast",
        '("FAST transfer" OR "FAST payment" OR "FAST transfers") (down OR delay OR outage OR '
        '"not working" OR stuck)',
        "FAST transfer delay down Singapore",
    ),
    SocialTarget(
        "nets",
        '("NETS payment" OR "NETS terminal" OR "NETS QR" OR "NETS card" OR NETSPay) '
        '(down OR outage OR "not working" OR disruption)',
        "NETS payment terminal down",
    ),
    SocialTarget(
        "swift",
        '("SWIFT network" OR "SWIFT payments" OR "SWIFT messaging") '
        "(outage OR down OR disruption OR delay OR cyberattack)",
        "SWIFT network outage disruption",
    ),
    SocialTarget(
        "visa",
        '("Visa card" OR "Visa payments" OR @Visa) (down OR outage OR declined OR '
        '"not working" OR disruption)',
        "Visa card payments down outage",
    ),
    SocialTarget(
        "mastercard",
        '(Mastercard OR @Mastercard) (down OR outage OR declined OR "not working" OR disruption)',
        "Mastercard payments down outage",
    ),
    SocialTarget("aws", f'(AWS OR "Amazon Web Services") {_OUTAGE}', "AWS outage Singapore"),
    SocialTarget("microsoft-azure", f"Azure {_OUTAGE}", "Microsoft Azure outage"),
    SocialTarget(
        "microsoft-365",
        f'("Microsoft 365" OR "Office 365" OR M365 OR @MSFT365Status) {_OUTAGE}',
        "Microsoft 365 Outlook Teams outage",
    ),
    SocialTarget("google-cloud", f'("Google Cloud" OR GCP) {_OUTAGE}', "Google Cloud outage"),
    SocialTarget(
        "oracle-cloud", f'("Oracle Cloud" OR "Oracle OCI") {_OUTAGE}', "Oracle Cloud outage"
    ),
    SocialTarget(
        "crowdstrike",
        'CrowdStrike (outage OR crash OR "blue screen" OR BSOD OR down OR breach)',
        "CrowdStrike outage crash",
    ),
    SocialTarget(
        "singtel",
        '(Singtel OR @Singtel) (down OR outage OR disruption OR "no signal" OR "not working" '
        "OR breach)",
        "Singtel outage down no signal",
    ),
    SocialTarget(
        "equinix", "Equinix (outage OR down OR power OR fire OR disruption)", "Equinix outage"
    ),
    SocialTarget(
        "circle",
        "(USDC OR @circle) (depeg OR depegged OR frozen OR freeze OR outage OR hack OR exploit "
        'OR "not working" OR redemption)',
        "USDC depeg freeze Circle",
    ),
    SocialTarget(
        "straitsx",
        '(XSGD OR XUSD OR StraitsX OR @StraitsX) (depeg OR frozen OR down OR outage OR "not '
        'working" OR scam OR hack)',
        "StraitsX XSGD down outage",
    ),
    SocialTarget(
        "okx",
        f'(OKX OR @okx OR "OKX SG" OR "OKX Pay") {_TROUBLE}',
        "OKX Singapore down outage withdrawals",
    ),
    SocialTarget(
        "coinbase",
        f"(Coinbase OR @coinbase OR @CoinbaseSupport) {_TROUBLE}",
        "Coinbase down outage withdrawals",
    ),
    SocialTarget(
        "tech-outages",
        # On X, bank app names find crypto news and online sellers; the bank targets cover X.
        None,
        "Singapore bank app down outage",
    ),
    SocialTarget(
        "cyber-threats",
        '(ransomware OR "data breach" OR cyberattack OR hacked) ("Singapore bank" OR DBS OR OCBC '
        'OR UOB OR SGX OR Singtel OR "Monetary Authority of Singapore" OR CSA)',
        "Singapore bank cyberattack data breach",
    ),
]


class SocialMeta(BaseModel):
    """A social document's row in social_posts."""

    platform: str
    subject_id: str
    query: str
    post_id: str | None = None
    author_id: str | None = None
    likes: int | None = None
    reposts: int | None = None
    replies: int | None = None
    quotes: int | None = None
    impressions: int | None = None


@dataclass(frozen=True)
class SocialDoc:
    doc: RawDocument
    meta: SocialMeta


@dataclass
class XSpend:
    """X reads paid this ingest (cached responses are free), against the spend cap: post reads
    from searches, and trends calls (sources/trends.py)."""

    cap_usd: float
    posts: int = 0
    searches: int = 0
    trend_calls: int = 0
    skipped: list[str] = field(default_factory=list[str])

    @property
    def usd(self) -> float:
        return self.posts * X_POST_USD + self.trend_calls * X_TRENDS_USD

    def allows(self, posts: int) -> bool:
        return self.usd + posts * X_POST_USD <= self.cap_usd


def x_status_url(post_id: str) -> str:
    return f"https://x.com/i/status/{post_id}"


def _x_title(text: str) -> str:
    line = " ".join(text.split())
    return line if len(line) <= 100 else line[:99].rstrip() + "…"


def store_social_meta(conn: sqlite3.Connection, document_id: str, meta: SocialMeta) -> None:
    """Write a stored social document's metadata, or refresh its engagement counts when the
    document is already known (the first subject whose search found it stays). Does nothing when
    the document was not stored, such as a post deduped by its text."""
    row = meta.model_dump()
    columns = ["document_id", *row, "fetched_at"]
    values = [document_id, *row.values(), datetime.now(UTC).isoformat()]
    counts = ["likes", "reposts", "replies", "quotes", "impressions", "fetched_at"]
    conn.execute(
        f"INSERT INTO social_posts ({', '.join(columns)}) "
        f"SELECT {', '.join('?' for _ in columns)} "
        "WHERE EXISTS (SELECT 1 FROM source_documents WHERE id = ?) "
        "ON CONFLICT (document_id) DO UPDATE SET "
        + ", ".join(f"{c} = coalesce(excluded.{c}, {c})" for c in counts),
        [*values, document_id],
    )


# --- X recent search -----------------------------------------------------------------------

X_SEARCH = "https://api.x.com/2/tweets/search/recent"
X_DAYS = 7  # how far back recent search reaches
_X_FILTERS = "-is:retweet lang:en"


class _XMetrics(BaseModel):
    retweet_count: int = 0
    reply_count: int = 0
    like_count: int = 0
    quote_count: int = 0
    impression_count: int | None = None


class _XNote(BaseModel):
    text: str


class _XPost(BaseModel):
    id: str
    text: str
    created_at: datetime
    author_id: str | None = None
    public_metrics: _XMetrics | None = None
    note_tweet: _XNote | None = None  # the full text of a post over 280 characters


class _XResponse(BaseModel):
    data: list[_XPost] = Field(default_factory=list[_XPost])


def x_search(
    http: CachedHttp,
    token: str,
    target: SocialTarget,
    window: Window,
    spend: XSpend,
    log: Callable[[str], None],
) -> list[SocialDoc]:
    """Up to `target.max_posts` posts from the 7 days ending at T0, most relevant first.

    The request is keyed by query and T0, so a rerun of the same ingest is served from the cache
    even on a later day. The end of T0 is sent as end_time unless it is still in the future;
    a T0 more than 7 days back is beyond recent search and is skipped."""
    if target.x_query is None:
        return []
    end = datetime.combine(window.t0 + timedelta(days=1), time(), UTC)
    now = datetime.now(UTC)
    if end < now - timedelta(days=X_DAYS):
        spend.skipped.append(f"{target.subject_id} (T0 beyond X's {X_DAYS} days)")
        return []
    if not spend.allows(target.max_posts):
        spend.skipped.append(f"{target.subject_id} (spend cap)")
        return []
    query = f"{target.x_query} {_X_FILTERS}"
    params = {
        "query": query,
        "max_results": str(min(100, max(10, target.max_posts))),
        "sort_order": "relevancy",
        "tweet.fields": "created_at,public_metrics,author_id,lang,note_tweet",
    }
    sent_unkeyed = (
        {"end_time": f"{end:%Y-%m-%dT%H:%M:%SZ}"} if end < now - timedelta(minutes=1) else {}
    )
    cached_before = http.cached["x"]
    response = http.get(
        "x",
        X_SEARCH,
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        expect_json=True,
        vary=window.t0.isoformat(),
        secret_params=sent_unkeyed,
        cache_errors=False,
    )
    if not response.ok:
        raise FetchError(
            f"X search {target.subject_id}: HTTP {response.status} {response.text()[:300]}"
        )
    posts = _XResponse.model_validate_json(response.content).data
    cached = http.cached["x"] != cached_before
    if not cached:
        spend.posts += len(posts)
        spend.searches += 1
    docs: list[SocialDoc] = []
    for p in posts:
        text = (p.note_tweet.text if p.note_tweet else p.text).strip()
        if not window.contains(p.created_at):
            continue
        m = p.public_metrics or _XMetrics()
        doc = RawDocument(
            source="x",
            collection="social",
            doc_type="X post",
            url=x_status_url(p.id),
            title=_x_title(text),
            published_at=p.created_at,
            text=text,
        )
        meta = SocialMeta(
            platform="x",
            subject_id=target.subject_id,
            query=query,
            post_id=p.id,
            author_id=p.author_id,
            likes=m.like_count,
            reposts=m.retweet_count,
            replies=m.reply_count,
            quotes=m.quote_count,
            impressions=m.impression_count,
        )
        docs.append(SocialDoc(doc, meta))
    log(f"x {target.subject_id}: {len(posts)} posts{' (cached)' if cached else ''}")
    return docs


# --- Reddit and forums through Tavily and Exa ----------------------------------------------

_X_STATUS = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/[^/]+/status/(\d+)")
_HWZ_THREAD = re.compile(r"^(https://forums\.hardwarezone\.com\.sg/threads/[^/?#]+/)")
_TIME_TAG = re.compile(r'<time[^>]*datetime="([^"]+)"')
_X_EPOCH_MS = 1288834974657


def x_post_time(post_id: str) -> datetime:
    """When an X post was created, from its id (a snowflake: milliseconds in the top bits), to the
    second like X's own created_at."""
    ms = (int(post_id) >> 22) + _X_EPOCH_MS
    return datetime.fromtimestamp(ms // 1000, UTC)


def _hwz_started(http: CachedHttp, url: str) -> datetime | None:
    """A HardwareZone thread's start: the first timestamp on its first page."""
    try:
        response = http.get("pages", url)
    except FetchError:
        return None
    match = _TIME_TAG.search(response.text()) if response.ok else None
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        return None


_TITLE_SUFFIX = re.compile(r"( \| Page \d+)?( \| HardwareZone Forums| : r/\w+)$")


def _thread_title(title: str) -> str:
    return _TITLE_SUFFIX.sub("", " ".join(title.split()))


_PLATFORMS = {"x.com": "x", "reddit.com": "reddit", "forums.hardwarezone.com.sg": "hardwarezone"}
_DOC_TYPES = {"x": "X post", "reddit": "Reddit thread", "hardwarezone": "Forum thread"}


def _forum_doc(
    http: CachedHttp,
    source: str,
    url: str,
    title: str | None,
    text: str | None,
    search_date: datetime | None,
    target: SocialTarget,
    query: str,
) -> SocialDoc | None:
    """A dated social document from a search hit, or None when it cannot be dated.

    X posts are dated from their id, HardwareZone threads from their first page, and Reddit
    threads from the search API's date (Reddit refuses page fetches, so Tavily's undated Reddit
    hits are dropped)."""
    domain = domain_of(url)
    platform = next(
        (p for d, p in _PLATFORMS.items() if domain == d or domain.endswith("." + d)), None
    )
    text = (text or "").strip()[:_TEXT_MAX_CHARS]
    if platform is None or len(text) < MIN_POST_CHARS:
        return None
    post_id = None
    if platform == "x":
        status = _X_STATUS.match(url)
        if not status:
            return None  # a profile or search page, not a post
        post_id = status.group(1)
        url, published = x_status_url(post_id), x_post_time(post_id)
    elif platform == "hardwarezone":
        thread = _HWZ_THREAD.match(url)
        if not thread:
            return None
        url = thread.group(1)
        published = _hwz_started(http, url)
    else:
        url, published = url.split("?")[0], search_date
    if published is None:
        return None
    doc = RawDocument(
        source=source,
        collection="social",
        doc_type=_DOC_TYPES[platform],
        url=url,
        title=_x_title(text) if platform == "x" else _thread_title(title or domain),
        published_at=published,
        text=text,
    )
    return SocialDoc(
        doc,
        SocialMeta(platform=platform, subject_id=target.subject_id, query=query, post_id=post_id),
    )


TAVILY_SEARCH = "https://api.tavily.com/search"
EXA_SEARCH = "https://api.exa.ai/search"


class _TavilyHit(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    raw_content: str | None = None


class _TavilyHits(BaseModel):
    results: list[_TavilyHit]


class _ExaHit(BaseModel):
    url: str
    title: str | None = None
    published_date: str | None = Field(default=None, alias="publishedDate")
    text: str | None = None


class _ExaHits(BaseModel):
    results: list[_ExaHit]


def forum_search(
    http: CachedHttp, tavily_key: str, exa_key: str, target: SocialTarget, window: Window
) -> list[SocialDoc]:
    """One Tavily search (Reddit, HardwareZone and X) and one Exa search (Reddit and
    HardwareZone) for a target over the ingest window. Hits must be dated inside the window and,
    for an entity, name it."""
    query = target.forum_query
    hits: list[SocialDoc | None] = []
    tavily = http.post_json(
        "tavily",
        TAVILY_SEARCH,
        {
            "query": query,
            "topic": "general",
            "search_depth": "basic",
            "max_results": FORUM_RESULTS,
            "start_date": str(window.start),
            "end_date": str(window.t0),
            "include_domains": [*SOCIAL_DOMAINS, "x.com"],
            "include_raw_content": "text",
        },
        headers={"Authorization": f"Bearer {tavily_key}"},
    )
    if tavily.ok:
        for r in _TavilyHits.model_validate_json(tavily.content).results:
            # An X page's raw content is mostly sign-in chrome; the snippet is the post.
            x_page = domain_of(r.url) == "x.com"
            text = r.content if x_page else r.raw_content or r.content
            hits.append(_forum_doc(http, "tavily", r.url, r.title, text, None, target, query))
    exa = http.post_json(
        "exa",
        EXA_SEARCH,
        {
            "query": query,
            "type": "auto",
            "numResults": FORUM_RESULTS,
            "includeDomains": list[JSONValue](SOCIAL_DOMAINS),
            "startPublishedDate": f"{window.start}T00:00:00.000Z",
            "endPublishedDate": f"{window.t0}T23:59:59.999Z",
            "contents": {"text": {"maxCharacters": _TEXT_MAX_CHARS}},
        },
        headers={"x-api-key": exa_key},
    )
    if exa.ok:
        for r in _ExaHits.model_validate_json(exa.content).results:
            found = datetime.fromisoformat(r.published_date) if r.published_date else None
            hits.append(_forum_doc(http, "exa", r.url, r.title, r.text, found, target, query))
    matcher = next((m for m in subject_matchers() if m.id == target.subject_id), None)
    # Thread pages share the thread's URL; the first copy wins.
    unique = list({h.doc.url: h for h in reversed([h for h in hits if h is not None])}.values())
    return [
        h
        for h in reversed(unique)
        if window.contains(h.doc.published_at)
        and (
            matcher is None
            or matcher.type != "entity"
            or matcher.matches(normalize(f"{h.doc.title}\n{h.doc.text}"))
        )
    ]


# --- One ingest's social search ------------------------------------------------------------

_FORUM_WORKERS = 4


def fetch_social(
    http: CachedHttp,
    x_token: str,
    tavily_key: str,
    exa_key: str,
    window: Window,
    spend: XSpend,
    subject_ids: set[str] | None = None,
    log: Callable[[str], None] = print,
    fail: Callable[[str], None] = print,
) -> list[SocialDoc]:
    """X posts, then forum threads, for every target (or the targets in `subject_ids`). X
    searches run one at a time so each is charged to the spend only when it reached X. Errors go
    to `fail` and skip that search."""
    targets = [t for t in TARGETS if subject_ids is None or t.subject_id in subject_ids]
    docs: list[SocialDoc] = []
    for target in [t for t in targets if t.x_query] if x_token else []:
        try:
            docs += x_search(http, x_token, target, window, spend, log)
        except FetchError as e:
            fail(str(e))

    def forums(target: SocialTarget) -> list[SocialDoc]:
        try:
            return forum_search(http, tavily_key, exa_key, target, window)
        except FetchError as e:
            fail(f"forums {target.subject_id}: {e}")
            return []

    with ThreadPoolExecutor(_FORUM_WORKERS) as pool:
        for target, found in zip(targets, pool.map(forums, targets), strict=True):
            log(f"forums {target.subject_id}: {len(found)} threads and posts")
            docs += found
    return docs
