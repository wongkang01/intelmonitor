"""Text extraction (readability-style for HTML, pymupdf for PDF) and dedup keys."""

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pymupdf
import trafilatura

from intelmonitor.ingest.http import CachedResponse

_TRACKING_PARAMS = re.compile(r"^(utm_|fbclid$|gclid$|mc_|ref$|src$|cmpid$)")
_PDF_MAX_PAGES = 60


def html_to_text(html: str, url: str) -> str:
    """Main article text of an HTML page, without navigation and boilerplate."""
    return trafilatura.extract(html, url=url, include_comments=False, include_tables=True) or ""


def pdf_to_text(content: bytes) -> str:
    pages: list[str] = []
    with pymupdf.open(stream=content, filetype="pdf") as pdf:
        for i in range(min(len(pdf), _PDF_MAX_PAGES)):
            # get_text("text") returns a str; pymupdf's stubs type it as a union of all modes.
            pages.append(str(pdf[i].get_text("text")))  # pyright: ignore[reportUnknownArgumentType, reportUnknownMemberType]
    return "\n".join(pages).strip()


def response_text(response: CachedResponse) -> str:
    """Readable text of a fetched page or PDF; empty when the response is not usable."""
    if not response.ok:
        return ""
    if response.is_pdf:
        try:
            return pdf_to_text(response.content)
        except (RuntimeError, ValueError):
            return ""
    return html_to_text(response.text(), response.url)


def canonical_url(url: str) -> str:
    """Scheme-less, www-less, lowercase host, no fragment, tracking params or trailing slash."""
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.")
    path = re.sub(r"/{2,}", "/", parts.path).rstrip("/") or "/"
    query = urlencode(
        sorted((k, v) for k, v in parse_qsl(parts.query) if not _TRACKING_PARAMS.match(k))
    )
    return urlunsplit(("https", host, path, query, ""))


def domain_of(url: str) -> str:
    return urlsplit(url).netloc.lower().removeprefix("www.")


def content_hash(text: str) -> str:
    """Hash of the text with case and whitespace normalized, so reformatted copies collide."""
    normalized = " ".join(text.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()


def document_id(canonical: str) -> str:
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]
