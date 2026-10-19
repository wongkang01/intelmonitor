"""SourceDocument rows: one piece of evidence (an official publication, a news article, or a
detector firing written by pipeline/detectors.py)."""

import sqlite3
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

# social: X posts, Reddit and forum threads (ingest/sources/social.py), unverified until a
# non-social source in the same development confirms them.
Collection = Literal["dms", "official", "news", "data", "social"]


class SourceDocument(BaseModel):
    id: str
    source: str
    collection: Collection
    doc_type: str
    classification: str
    url: str
    canonical_url: str
    domain: str
    title: str
    published_at: datetime
    text: str
    content_hash: str
    ingested_at: datetime


_COLUMNS = list(SourceDocument.model_fields)


def insert_document(conn: sqlite3.Connection, doc: SourceDocument) -> bool:
    """Insert unless the canonical URL or content hash is already stored. Returns True if added."""
    row = doc.model_dump(mode="json")
    cursor = conn.execute(
        f"INSERT OR IGNORE INTO source_documents ({', '.join(_COLUMNS)}) "
        f"VALUES ({', '.join('?' for _ in _COLUMNS)})",
        [row[c] for c in _COLUMNS],
    )
    return cursor.rowcount == 1


def list_documents(conn: sqlite3.Connection) -> list[SourceDocument]:
    rows = conn.execute("SELECT * FROM source_documents ORDER BY published_at").fetchall()
    return [SourceDocument.model_validate(dict(r)) for r in rows]


def first_document_day(conn: sqlite3.Connection) -> date | None:
    """The day of the earliest stored document: nothing was collected before it."""
    row = conn.execute("SELECT min(substr(published_at, 1, 10)) FROM source_documents").fetchone()
    return date.fromisoformat(row[0]) if row[0] else None
