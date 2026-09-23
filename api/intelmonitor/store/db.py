"""SQLite store at data/intelmonitor.db. Each phase adds its tables to SCHEMA."""

import sqlite3
from pathlib import Path

from intelmonitor.config import DATA_DIR

DB_PATH = DATA_DIR / "intelmonitor.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
    id TEXT PRIMARY KEY,               -- sha256(canonical_url)[:16], stable across reruns
    source TEXT NOT NULL,              -- adapter: mas, fed, ecb, hkma, bis, fsb, exa, tavily
    collection TEXT NOT NULL,          -- dms, official or news
    doc_type TEXT NOT NULL,            -- e.g. Media Releases, Speeches, News
    classification TEXT NOT NULL,      -- public for every POC document
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,        -- ISO 8601, UTC
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE, -- sha256 of normalized text
    ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_documents_published ON source_documents (published_at);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the store and make sure the schema exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row["value"])


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()
