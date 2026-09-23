"""Evidence behind a development: its sources, each with the findings drawn from it, their
verified quotes as offsets into the document text, and a short passage to highlight."""

import json
import sqlite3

from intelmonitor.server.models import (
    DocumentDetail,
    EvidenceFinding,
    EvidenceSource,
    Passage,
    Quote,
    Span,
)

# Characters of context kept on each side of a finding's quotes in its passage.
PASSAGE_CONTEXT = 280
_COLLECTION_RANK = {"dms": 0, "official": 1, "news": 2}


def _quotes(raw: str) -> list[Quote]:
    return [Quote(text=q["text"], start=q["start"], end=q["end"]) for q in json.loads(raw)]


def passage(text: str, quotes: list[Quote]) -> Passage:
    """The quotes with PASSAGE_CONTEXT characters around them, widened to whole words."""
    lo = max(0, min(q.start for q in quotes) - PASSAGE_CONTEXT)
    hi = min(len(text), max(q.end for q in quotes) + PASSAGE_CONTEXT)
    while lo > 0 and not text[lo - 1].isspace():
        lo -= 1
    while hi < len(text) and not text[hi].isspace():
        hi += 1
    return Passage(
        text=text[lo:hi],
        highlights=[Span(start=q.start - lo, end=q.end - lo) for q in quotes],
    )


def development_sources(
    conn: sqlite3.Connection, run_id: str, development_id: str, new_document_ids: set[str]
) -> list[EvidenceSource]:
    rows = conn.execute(
        "SELECT f.id AS finding_id, f.statement, f.event_date, f.quotes, d.* "
        "FROM development_sources s JOIN findings f ON f.id = s.finding_id "
        "JOIN source_documents d ON d.id = s.document_id "
        "WHERE s.run_id = ? AND s.development_id = ? ORDER BY d.published_at, f.id",
        (run_id, development_id),
    ).fetchall()
    sources: dict[str, EvidenceSource] = {}
    for r in rows:
        src = sources.get(r["id"])
        if src is None:
            src = sources[r["id"]] = EvidenceSource(
                document_id=r["id"],
                title=r["title"],
                url=r["url"],
                domain=r["domain"],
                source=r["source"],
                collection=r["collection"],
                doc_type=r["doc_type"],
                classification=r["classification"],
                published_at=r["published_at"],
                new_in_run=r["id"] in new_document_ids,
                findings=[],
            )
        quotes = _quotes(r["quotes"])
        src.findings.append(
            EvidenceFinding(
                id=r["finding_id"],
                statement=r["statement"],
                event_date=r["event_date"],
                quotes=quotes,
                passage=passage(r["text"], quotes),
            )
        )
    return sorted(
        sources.values(), key=lambda s: (_COLLECTION_RANK.get(s.collection, 3), s.published_at)
    )


def new_documents(conn: sqlite3.Connection, run_id: str, development_id: str) -> set[str]:
    row = conn.execute(
        "SELECT detail FROM run_changes WHERE run_id = ? AND ref_id = ? "
        "AND kind IN ('new_development', 'updated_development')",
        (run_id, development_id),
    ).fetchone()
    return set(json.loads(row["detail"])["new_documents"]) if row else set()


def document_detail(conn: sqlite3.Connection, document_id: str) -> DocumentDetail | None:
    doc = conn.execute("SELECT * FROM source_documents WHERE id = ?", (document_id,)).fetchone()
    if doc is None:
        return None
    quotes = {
        (q.start, q.end): q
        for r in conn.execute("SELECT quotes FROM findings WHERE document_id = ?", (document_id,))
        for q in _quotes(r["quotes"])
    }
    return DocumentDetail(
        id=doc["id"],
        title=doc["title"],
        url=doc["url"],
        domain=doc["domain"],
        source=doc["source"],
        collection=doc["collection"],
        doc_type=doc["doc_type"],
        classification=doc["classification"],
        published_at=doc["published_at"],
        text=doc["text"],
        quotes=sorted(quotes.values(), key=lambda q: q.start),
    )
