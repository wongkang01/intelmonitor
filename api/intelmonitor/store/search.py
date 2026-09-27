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
# A document snippet is at most this many words. The search panel shows its first few, so it
# starts at the sentence holding the first match only when the match is within _SENTENCE_REACH
# words of that sentence's start, and otherwise _LEAD_WORDS before the match.
_SNIPPET_WORDS = 24
_LEAD_WORDS = 2
_SENTENCE_REACH = 4
# A line that holds the title plus at most this many characters (such as " | Reuters") restates it.
_TITLE_SUFFIX = 40


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
    snippet: str  # see snippet()


def documents(conn: sqlite3.Connection, run_id: str, text: str, limit: int) -> list[DocumentMatch]:
    """Documents matching what the user typed, best first. Only documents that are a source of one
    of the run's developments count, since a result opens its development's evidence."""
    query = match_query(text)
    if query is None:
        return []
    rows = conn.execute(
        "SELECT f.document_id, d.title, d.domain, d.published_at, d.text "
        "FROM documents_fts f JOIN source_documents d ON d.id = f.document_id "
        "WHERE documents_fts MATCH ? "
        "AND f.document_id IN (SELECT document_id FROM development_sources WHERE run_id = ?) "
        "ORDER BY bm25(documents_fts, ?, 1.0) LIMIT ?",
        (query, run_id, _TITLE_WEIGHT, limit),
    )
    return [
        DocumentMatch(
            id=r["document_id"],
            title=r["title"],
            domain=r["domain"],
            published_at=datetime.fromisoformat(r["published_at"]),
            snippet=snippet(r["text"], r["title"], text),
        )
        for r in rows
    ]


def snippet(text: str, title: str, typed: str) -> str:
    """The passage of a document's body that best matches what the user typed, as plain text: the
    line with the most typed words, preferring whole sentences, clipped to _SNIPPET_WORDS from
    just before its first match, with … where clipped. Markdown is stripped, and lines that
    restate the title are skipped, as are the page's own titles: level-1 headings, and a first
    line that is not a sentence, such as "HKMA raises rates | Reuters". With no match in the body
    (the title matched), it is the first sentence."""
    *full, last = _WORD.findall(typed) or [""]
    patterns = [re.compile(rf"\b{re.escape(w)}\b", re.IGNORECASE) for w in full]
    patterns.append(re.compile(rf"\b{re.escape(last)}", re.IGNORECASE))
    lines = [_plain(line) for line in text.splitlines() if not _HEADING_1.match(line)]
    lines = [line for line in lines if line]
    if lines and not _SENTENCE_END.search(lines[0]):
        lines = lines[1:]
    lines = [line for line in lines if not _restates(line, title)]
    if not lines:
        return ""

    def rank(item: tuple[int, str]) -> tuple[int, bool, int]:
        index, line = item
        hits = sum(1 for p in patterns if p.search(line))
        return hits, _SENTENCE_END.search(line) is not None and len(line.split()) >= 8, -index

    _, best = max(enumerate(lines), key=rank)
    return _clip(best, patterns)


# Markdown to plain text, applied in order to one line.
_MARKDOWN = [
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), ""),  # images
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),  # links keep their text
    (re.compile(r"<[^>]+>"), ""),  # HTML tags
    (re.compile(r"^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+"), ""),  # headings, quotes, lists
    (re.compile(r"\*\*|__|`"), ""),  # bold and code
    (re.compile("[\u200b-\u200d\u2060\ufeff]"), ""),  # zero-width characters some sites scatter
    (re.compile(r"(?<!\w)[*_](\S[^*_]*?)[*_](?!\w)"), r"\1"),  # italics
]
_HEADING_1 = re.compile(r"\s*#\s")
_SENTENCE_END = re.compile(r"[.!?][\"'”’)]*$")


def _plain(line: str) -> str:
    for pattern, replacement in _MARKDOWN:
        line = pattern.sub(replacement, line)
    line = _SPACE.sub(" ", line).strip()
    return line if _WORD.search(line) else ""  # rules, table borders and lone bullets go


def _words(text: str) -> str:
    return " ".join(_WORD.findall(text.lower()))


def _restates(line: str, title: str) -> bool:
    """True for a line that is the title, part of it, or the title with a site name added."""
    line, title = _words(line), _words(title)
    if not title:
        return False
    if title in line:
        return len(line) - len(title) <= _TITLE_SUFFIX
    return line in title and len(line) * 2 >= len(title)


def _clip(line: str, patterns: list[re.Pattern[str]]) -> str:
    words = line.split()
    starts = [m.start() for p in patterns if (m := p.search(line))]
    before = line[: min(starts)] if starts else ""
    first = len(before.split()) - (1 if before and not before[-1].isspace() else 0)
    sentence = max(i for i in range(first + 1) if i == 0 or _SENTENCE_END.search(words[i - 1]))
    start = sentence if first - sentence <= _SENTENCE_REACH else first - _LEAD_WORDS
    end = start + _SNIPPET_WORDS
    clipped = " ".join(words[start:end])
    cut = end < len(words) and not _SENTENCE_END.search(clipped)
    return f"{'…' if start > 0 else ''}{clipped}{'…' if cut else ''}"
