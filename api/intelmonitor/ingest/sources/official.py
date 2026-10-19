"""Official sources with no API key: MAS search API, RSS feeds (Fed, ECB, BIS, FSB), HKMA API,
and the status pages of the cloud providers (AWS, Azure, Google Cloud, Oracle Cloud, Cloudflare).

Each adapter lists the window's items; `fetch_listing` then fetches and parses each page. Status
page items carry their own text, so they need no fetch. A listing request whose URL does not
carry the window is keyed by T0 (`vary`), so an ingest for a later T0 sees new items while a
rerun replays the cache.
"""

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit

from pydantic import BaseModel, Field, TypeAdapter

from intelmonitor.ingest.http import CachedHttp
from intelmonitor.ingest.models import MIN_TEXT_CHARS, Listing, RawDocument, Window
from intelmonitor.ingest.parse import response_text
from intelmonitor.store.documents import Collection

# --- MAS -----------------------------------------------------------------------------------

MAS_BASE = "https://www.mas.gov.sg"
MAS_SEARCH = f"{MAS_BASE}/api/v1/search"
# MAS content type -> collection. Regulatory instruments form the stand-in DMS.
MAS_CONTENT_TYPES: dict[str, Collection] = {
    "Media Releases": "official",
    "Speeches": "official",
    "Consultations": "dms",
    "Notices": "dms",
    "Circulars": "dms",
    "Enforcement Actions": "dms",
}
# The search API serves a CDN maintenance page to requests that don't look like the site's own.
_MAS_HEADERS = {"Accept": "application/json, text/plain, */*", "Referer": f"{MAS_BASE}/news"}
_PDF_HREF = re.compile(r'href="([^"]+\.pdf)"', re.IGNORECASE)


class _MasDoc(BaseModel):
    content_type: str = Field(alias="mas_contenttype_s")
    path: str = Field(alias="page_url_s")
    title: str = Field(alias="document_title_string_s")
    published_at: datetime = Field(alias="mas_date_tdt")


class _MasResult(BaseModel):
    numFound: int
    docs: list[_MasDoc]


class _MasSearch(BaseModel):
    response: _MasResult


def mas_listings(http: CachedHttp, window: Window) -> list[Listing]:
    types = " OR ".join(f'"{t}"' for t in MAS_CONTENT_TYPES)
    listings: list[Listing] = []
    start, rows = 0, 100
    while True:
        response = http.get(
            "mas",
            MAS_SEARCH,
            params={
                "q": "*",
                "rows": str(rows),
                "start": str(start),
                "sort": "mas_date_tdt desc",
                "fq": f"mas_contenttype_s:({types}) AND "
                f"mas_date_tdt:[{window.start}T00:00:00Z TO {window.t0}T23:59:59Z]",
            },
            headers=_MAS_HEADERS,
            expect_json=True,
        )
        result = _MasSearch.model_validate_json(response.content).response
        listings += [
            Listing(
                source="mas",
                collection=MAS_CONTENT_TYPES.get(d.content_type, "official"),
                doc_type=d.content_type,
                url=MAS_BASE + d.path,
                title=d.title.strip(),
                published_at=d.published_at,
            )
            for d in result.docs
        ]
        start += rows
        if not result.docs or start >= result.numFound:
            return listings


def _mas_main_pdf(html: str, published: date) -> str | None:
    """The instrument itself on a MAS notice, circular or consultation page: the first PDF from
    the publication year that isn't an annex."""
    for href in _PDF_HREF.findall(html):
        name = href.rsplit("/", 1)[-1].lower()
        if str(published.year) in href and not name.startswith("annex"):
            return urljoin(MAS_BASE, href)
    return None


# --- RSS -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Feed:
    source: str
    collection: Collection
    doc_type: str
    url: str
    paged: bool = False  # WordPress feeds take ?paged=N for older items


FEEDS = [
    Feed("fed", "official", "Press releases", "https://www.federalreserve.gov/feeds/press_all.xml"),
    Feed("fed", "official", "Speeches", "https://www.federalreserve.gov/feeds/speeches.xml"),
    Feed("ecb", "official", "Press releases", "https://www.ecb.europa.eu/rss/press.html"),
    Feed("ecb", "official", "Publications", "https://www.ecb.europa.eu/rss/pub.html"),
    Feed("bis", "dms", "Central bankers' speeches", "https://www.bis.org/doclist/cbspeeches.rss"),
    Feed("bis", "dms", "Press releases", "https://www.bis.org/doclist/all_pressrels.rss"),
    Feed("fsb", "dms", "Publications", "https://www.fsb.org/feed/", paged=True),
]
_MAX_FEED_PAGES = 6


def _child(item: ET.Element, name: str) -> str:
    for child in item:
        if child.tag.rsplit("}", 1)[-1] == name:
            return (child.text or "").strip()
    return ""


_BARE_AMPERSAND = re.compile(rb"&(?!#?\w+;)")


def _feed_items(content: bytes) -> list[ET.Element]:
    """A feed's items. Some feeds print a bare & (the ECB's "R&D"), which is not XML, so a feed
    that fails to parse is parsed again with those escaped."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        root = ET.fromstring(_BARE_AMPERSAND.sub(b"&amp;", content))
    return [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "item"]


def _feed_date(item: ET.Element) -> datetime | None:
    if raw := _child(item, "pubDate"):
        return parsedate_to_datetime(raw)
    if raw := _child(item, "date"):
        return datetime.fromisoformat(raw)
    return None


def feed_listings(http: CachedHttp, feed: Feed, window: Window) -> list[Listing]:
    listings: list[Listing] = []
    for page in range(1, (_MAX_FEED_PAGES if feed.paged else 1) + 1):
        url = feed.url if page == 1 else f"{feed.url}?paged={page}"
        response = http.get(feed.source, url, vary=str(window.t0))
        if not response.ok:
            break
        items = _feed_items(response.content)
        oldest: datetime | None = None
        for item in items:
            published = _feed_date(item)
            if published is None:
                continue
            oldest = published if oldest is None else min(oldest, published)
            if window.contains(published):
                listings.append(
                    Listing(
                        source=feed.source,
                        collection=feed.collection,
                        doc_type=feed.doc_type,
                        url=_child(item, "link"),
                        title=" ".join(_child(item, "title").split()),
                        published_at=published,
                    )
                )
        if oldest is None or oldest.date() < window.start:
            break
    return listings


# --- HKMA ----------------------------------------------------------------------------------

HKMA_PRESS_RELEASES = "https://api.hkma.gov.hk/public/press-releases"
# Daily operational notices that carry no supervisory signal.
_HKMA_ROUTINE = re.compile(
    r"^(scam alert|hkicl alerts|beware of fraudulent|fraudulent|exchange fund bills tender"
    r"|tender of|tender results)",
    re.IGNORECASE,
)


class _HkmaRecord(BaseModel):
    title: str
    link: str
    day: date = Field(alias="date")


class _HkmaResult(BaseModel):
    records: list[_HkmaRecord]


class _HkmaResponse(BaseModel):
    result: _HkmaResult


def hkma_listings(http: CachedHttp, window: Window) -> list[Listing]:
    listings: list[Listing] = []
    offset, size = 0, 100
    while True:
        response = http.get(
            "hkma",
            HKMA_PRESS_RELEASES,
            params={"lang": "en", "pagesize": str(size), "offset": str(offset)},
            expect_json=True,
            vary=str(window.t0),
        )
        records = _HkmaResponse.model_validate_json(response.content).result.records
        for r in records:
            title = " ".join(r.title.replace("\ufeff", "").split())
            published = datetime(r.day.year, r.day.month, r.day.day, tzinfo=UTC)
            if window.contains(published) and not _HKMA_ROUTINE.match(title):
                listings.append(
                    Listing(
                        source="hkma",
                        collection="official",
                        doc_type="Press releases",
                        url=r.link,
                        title=title,
                        published_at=published,
                    )
                )
        offset += size
        if len(records) < size or min(r.day for r in records) < window.start:
            return listings


# --- Cloud status pages --------------------------------------------------------------------
# Incident reports from the cloud providers the tracked institutions depend on. Each feed
# carries the incidents' text, and most status pages are scripts with no text of their own.


class StatusListing(Listing):
    """An incident from a status page, with its text."""

    text: str


_BLOCK_END = re.compile(r"<(?:br|/p|/li|/h[1-6]|/div)\b[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def _fragment_text(fragment: str) -> str:
    """Plain text of an HTML fragment, a line per paragraph or list item."""
    text = html.unescape(_TAG.sub(" ", _BLOCK_END.sub("\n", fragment)))
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def _updates_text(updates: list[tuple[datetime, str]]) -> str:
    """An incident's timestamped updates, newest first as the status pages list them."""
    return "\n\n".join(
        f"{at.astimezone(UTC):%d %b %Y %H:%M} UTC: {_fragment_text(body)}" for at, body in updates
    )


def _status(source: str, url: str, title: str, published: datetime, text: str) -> StatusListing:
    return StatusListing(
        source=source,
        collection="official",
        doc_type="Status page",
        url=url,
        title=" ".join(title.split()),
        published_at=published,
        text=text,
    )


def _keyed(url: str) -> str:
    """An item's link with its fragment repeated as a query: these pages pick the item by
    fragment, which canonical URLs drop, so every item would otherwise dedup into the first."""
    parts = urlsplit(url)
    if not parts.fragment:
        return url
    return urlunsplit(parts._replace(query=urlencode({"item": parts.fragment})))


# RSS feeds whose items hold the incident text. AWS links every item to the same page, and its
# guid, a link to the event, names the item instead.
STATUS_FEEDS = [
    Feed("aws", "official", "Status page", "https://status.aws.amazon.com/rss/all.rss"),
    Feed(
        "oracle-cloud", "official", "Status page", "https://ocistatus.oraclecloud.com/history.rss"
    ),
]


def status_feed_listings(http: CachedHttp, feed: Feed, window: Window) -> list[Listing]:
    response = http.get(feed.source, feed.url, vary=str(window.t0))
    if not response.ok:
        return []
    listings: list[Listing] = []
    for item in _feed_items(response.content):
        published = _feed_date(item)
        if published is None or not window.contains(published):
            continue
        guid = _child(item, "guid")
        url = guid if guid.startswith("http") else _child(item, "link")
        text = _fragment_text(_child(item, "description"))
        listings.append(_status(feed.source, _keyed(url), _child(item, "title"), published, text))
    return listings


# Azure's RSS feed lists only incidents still open, so its post-incident reviews come from the
# HTML its status history page loads, one block per review.
AZURE_HISTORY = "https://azure.status.microsoft/en-us/statushistoryapi/"
AZURE_REVIEW = "https://azure.status.microsoft/en-us/status/history/?trackingid={}"
_AZURE_BLOCK = 'class="col-sm-11 incident-history-item"'
_AZURE_DAY = re.compile(r'hide-text">(\d\d/\d\d/\d{4})<')
_AZURE_TITLE = re.compile(r'incident-history-title">(.*?)</div>', re.DOTALL)
_AZURE_TRACKING = re.compile(r"Tracking ID: ([A-Z0-9]+-[A-Z0-9]+)")
_AZURE_BODY = re.compile(r'class="card-body">(.*?)</div>', re.DOTALL)
_AZURE_TOTAL = re.compile(r'wa-historyResult-count" value="(\d+)"')
_AZURE_MAX_PAGES = 5


def azure_listings(http: CachedHttp, window: Window) -> list[Listing]:
    listings: list[Listing] = []
    seen = 0
    for page in range(1, _AZURE_MAX_PAGES + 1):
        response = http.get(
            "azure",
            AZURE_HISTORY,
            params={
                "serviceSlug": "all",
                "regionSlug": "all",
                "startDate": f"{window.start:%Y%m%d}",
                "page": str(page),
                "shdrefreshflag": "true",
            },
        )
        if not response.ok:
            break
        page_html = response.text()
        blocks = page_html.split(_AZURE_BLOCK)[1:]
        for block in blocks:
            day, title = _AZURE_DAY.search(block), _AZURE_TITLE.search(block)
            tracking, body = _AZURE_TRACKING.search(block), _AZURE_BODY.search(block)
            if not (day and title and tracking and body):
                continue
            published = datetime.strptime(day.group(1), "%m/%d/%Y").replace(tzinfo=UTC)
            if window.contains(published):
                url = AZURE_REVIEW.format(tracking.group(1))
                text = _fragment_text(body.group(1))
                name = html.unescape(title.group(1))
                listings.append(_status("azure", url, name, published, text))
        seen += len(blocks)
        total = _AZURE_TOTAL.search(page_html)
        if not blocks or total is None or seen >= int(total.group(1)):
            break
    return listings


GCP_INCIDENTS = "https://status.cloud.google.com/incidents.json"


class _GcpUpdate(BaseModel):
    created: datetime
    text: str


class _GcpIncident(BaseModel):
    uri: str  # incidents/<id>
    external_desc: str
    created: datetime
    updates: list[_GcpUpdate]  # newest first


def gcp_listings(http: CachedHttp, window: Window) -> list[Listing]:
    response = http.get("google-cloud", GCP_INCIDENTS, vary=str(window.t0))
    if not response.ok:
        return []
    incidents = TypeAdapter(list[_GcpIncident]).validate_json(response.content)
    return [
        _status(
            "google-cloud",
            f"https://status.cloud.google.com/{i.uri}",
            i.external_desc,
            i.created,
            _updates_text([(u.created, u.text) for u in i.updates]),
        )
        for i in incidents
        if window.contains(i.created)
    ]


# Cloudflare's status API returns its 50 latest incidents, about three weeks, several minor
# ones a day; only those it rates major or critical are kept.
CLOUDFLARE_INCIDENTS = "https://www.cloudflarestatus.com/api/v2/incidents.json"
_CLOUDFLARE_IMPACTS = {"major", "critical"}


class _CloudflareUpdate(BaseModel):
    status: str
    body: str
    created_at: datetime


class _CloudflareIncident(BaseModel):
    id: str
    name: str
    impact: str
    created_at: datetime
    incident_updates: list[_CloudflareUpdate]  # newest first


class _CloudflareIncidents(BaseModel):
    incidents: list[_CloudflareIncident]


def cloudflare_listings(http: CachedHttp, window: Window) -> list[Listing]:
    response = http.get("cloudflare", CLOUDFLARE_INCIDENTS, vary=str(window.t0))
    if not response.ok:
        return []
    incidents = _CloudflareIncidents.model_validate_json(response.content).incidents
    return [
        _status(
            "cloudflare",
            f"https://www.cloudflarestatus.com/incidents/{i.id}",
            i.name,
            i.created_at,
            _updates_text(
                [(u.created_at, f"{u.status.capitalize()} - {u.body}") for u in i.incident_updates]
            ),
        )
        for i in incidents
        if i.impact in _CLOUDFLARE_IMPACTS and window.contains(i.created_at)
    ]


def status_listings(http: CachedHttp, window: Window) -> list[Listing]:
    listings: list[Listing] = []
    for feed in STATUS_FEEDS:
        listings += status_feed_listings(http, feed, window)
    listings += azure_listings(http, window) + gcp_listings(http, window)
    return listings + cloudflare_listings(http, window)


# --- Pages ---------------------------------------------------------------------------------


def fetch_listing(http: CachedHttp, listing: Listing) -> RawDocument | None:
    """Fetch and parse one listed item. MAS regulatory pages are short landing pages, so the
    instrument's PDF text is appended. Status page items already hold their text."""
    if isinstance(listing, StatusListing):
        text = listing.text
    else:
        response = http.get(listing.source, listing.url)
        text = response_text(response)
        if listing.source == "mas" and listing.collection == "dms" and response.ok:
            if pdf_url := _mas_main_pdf(response.text(), listing.published_at.date()):
                pdf_text = response_text(http.get("mas", pdf_url))
                text = f"{text}\n\n{pdf_text}".strip()
    if len(text) < MIN_TEXT_CHARS:
        return None
    return RawDocument(**listing.model_dump(exclude={"text"}), text=text)


def official_listings(http: CachedHttp, window: Window) -> list[Listing]:
    listings = mas_listings(http, window)
    for feed in FEEDS:
        listings += feed_listings(http, feed, window)
    listings += hkma_listings(http, window)
    return listings + status_listings(http, window)
