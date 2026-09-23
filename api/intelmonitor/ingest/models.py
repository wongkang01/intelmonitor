"""Shapes passed between source adapters and the ingest run."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from pydantic import BaseModel

from intelmonitor.store.documents import Collection

WINDOW_DAYS = 60
MIN_TEXT_CHARS = 300


@dataclass(frozen=True)
class Window:
    """The WINDOW_DAYS days ending at T0 (inclusive)."""

    t0: date

    @property
    def start(self) -> date:
        return self.t0 - timedelta(days=WINDOW_DAYS)

    def contains(self, published: datetime) -> bool:
        return self.start <= published.date() <= self.t0


class Listing(BaseModel):
    """An index entry from an official source, before its page is fetched."""

    source: str
    collection: Collection
    doc_type: str
    url: str
    title: str
    published_at: datetime


class RawDocument(BaseModel):
    """A fetched and parsed document, before dedup and storage."""

    source: str
    collection: Collection
    doc_type: str
    url: str
    title: str
    published_at: datetime
    text: str
