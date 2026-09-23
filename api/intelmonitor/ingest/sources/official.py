"""Official sources with no API key: MAS search API, RSS feeds (Fed, ECB, BIS, FSB), HKMA API.

Each adapter lists the window's items; `fetch_listing` then fetches and parses each page.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin

from pydantic import BaseModel, Field

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
        response = http.get(feed.source, url)
        if not response.ok:
            break
        root = ET.fromstring(response.content)
        items = [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "item"]
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


# --- Pages ---------------------------------------------------------------------------------


def fetch_listing(http: CachedHttp, listing: Listing) -> RawDocument | None:
    """Fetch and parse one listed item. MAS regulatory pages are short landing pages, so the
    instrument's PDF text is appended."""
    response = http.get(listing.source, listing.url)
    text = response_text(response)
    if listing.source == "mas" and listing.collection == "dms" and response.ok:
        if pdf_url := _mas_main_pdf(response.text(), listing.published_at.date()):
            pdf_text = response_text(http.get("mas", pdf_url))
            text = f"{text}\n\n{pdf_text}".strip()
    if len(text) < MIN_TEXT_CHARS:
        return None
    return RawDocument(**listing.model_dump(), text=text)


def official_listings(http: CachedHttp, window: Window) -> list[Listing]:
    listings = mas_listings(http, window)
    for feed in FEEDS:
        listings += feed_listings(http, feed, window)
    return listings + hkma_listings(http, window)
