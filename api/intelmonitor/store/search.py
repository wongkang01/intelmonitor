"""Full-text search with SQLite FTS5 over documents and each run's developments.

The tables and the triggers that index documents on every write live in db.SCHEMA. The pipeline
calls `index_developments` whenever it stores a run's developments; `rebuild` fills both tables
from what is stored, when they are first created."""

import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime

_WORD = re.compile(r"\w+")
_SPACE = re.compile(r"\s+")
# Title matches count four times as much as matches in the text or summary.
_TITLE_WEIGHT = 4.0
_SNIPPET_TOKENS = 24


def match_query(text: str) -> str | None:
    """The FTS5 query for what the user typed: every word required, the last one also as a prefix
    so results follow the typing. Matching the last word whole as well ranks "basel" above
    "baseline". None when the text has no word in it."""
    words = [f'"{w}"' for w in _WORD.findall(text)]
    if not words:
        return None
    *full, last = words
    return " AND ".join([*full, f"({last} OR {last}*)"])


def index_developments(conn: sqlite3.Connection, run_id: str) -> None:
    """Reindex one run's developments: the title (its lead finding's statement) and, as summary,
    the statements of its other findings. The caller commits."""
    conn.execute("DELETE FROM developments_fts WHERE run_id = ?", (run_id,))
    conn.execute(
        "INSERT INTO developments_fts (title, summary, run_id, development_id) "
        "SELECT d.title, coalesce(group_concat(f.statement, ' '), ''), d.run_id, d.id "
        "FROM developments d "
        "LEFT JOIN development_sources s ON s.run_id = d.run_id AND s.development_id = d.id "
        "LEFT JOIN findings f ON f.id = s.finding_id AND f.statement != d.title "
        "WHERE d.run_id = ? GROUP BY d.run_id, d.id",
        (run_id,),
    )


def rebuild(conn: sqlite3.Connection) -> None:
    """Index every stored document and every run's developments from scratch."""
    conn.execute("DELETE FROM documents_fts")
    conn.execute(
        "INSERT INTO documents_fts (title, text, document_id) "
        "SELECT title, text, id FROM source_documents"
    )
    for r in conn.execute("SELECT DISTINCT run_id FROM developments").fetchall():
        index_developments(conn, r["run_id"])
    conn.commit()


def developments(conn: sqlite3.Connection, run_id: str, query: str, limit: int) -> list[str]:
    """Ids of the run's developments matching an FTS5 query, best first."""
    rows = conn.execute(
        "SELECT development_id FROM developments_fts "
        "WHERE developments_fts MATCH ? AND run_id = ? "
        "ORDER BY bm25(developments_fts, ?, 1.0) LIMIT ?",
        (query, run_id, _TITLE_WEIGHT, limit),
    )
    return [r["development_id"] for r in rows]


@dataclass(frozen=True)
class DocumentMatch:
    id: str
    title: str
    domain: str
    published_at: datetime
    snippet: str  # plain text around the best match in the text, … where it is clipped


def documents(conn: sqlite3.Connection, run_id: str, query: str, limit: int) -> list[DocumentMatch]:
    """Documents matching an FTS5 query, best first. Only documents that are a source of one of
    the run's developments count, since a result opens its development's evidence."""
    rows = conn.execute(
        "SELECT f.document_id, d.title, d.domain, d.published_at, "
        "snippet(documents_fts, 1, '', '', '…', ?) AS snippet "
        "FROM documents_fts f JOIN source_documents d ON d.id = f.document_id "
        "WHERE documents_fts MATCH ? "
        "AND f.document_id IN (SELECT document_id FROM development_sources WHERE run_id = ?) "
        "ORDER BY bm25(documents_fts, ?, 1.0) LIMIT ?",
        (_SNIPPET_TOKENS, query, run_id, _TITLE_WEIGHT, limit),
    )
    return [
        DocumentMatch(
            id=r["document_id"],
            title=r["title"],
            domain=r["domain"],
            published_at=datetime.fromisoformat(r["published_at"]),
            snippet=_SPACE.sub(" ", r["snippet"]).strip(),
        )
        for r in rows
    ]
