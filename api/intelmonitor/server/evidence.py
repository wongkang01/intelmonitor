"""Evidence behind a development: its sources, each with the findings drawn from it, their
verified quotes as offsets into the document text, and a short passage to highlight."""

import json
import sqlite3
from collections.abc import Collection
from datetime import date

from intelmonitor.seed import load_series, load_subjects
from intelmonitor.server.models import (
    DocumentDetail,
    EvidenceFinding,
    EvidenceSource,
    Passage,
    Quote,
    SeriesChart,
    Span,
)
from intelmonitor.server.series import series_chart

# Characters of context kept on each side of a finding's quotes in its passage.
PASSAGE_CONTEXT = 280
_COLLECTION_RANK = {"dms": 0, "official": 1, "news": 2, "social": 3}


def own_site(domain: str, own: Collection[str]) -> bool:
    """True for a document on one of `own` sites or a subdomain of one."""
    return any(domain == d or domain.endswith(f".{d}") for d in own)


def source_rank(collection: str, domain: str, own: Collection[str]) -> int:
    """Where a source is listed, everywhere a development's sources are: a detection first, then
    the publications of the institutions it is tagged to (documents on a tagged subject's own
    site, `own`: the Fed's FOMC statement before a BIS speech about it), then DMS, official,
    news and social documents. Sources of one rank are listed earliest first."""
    if collection == "data":
        return 0
    if own_site(domain, own):
        return 1
    return 2 + _COLLECTION_RANK.get(collection, 4)


def own_domains(conn: sqlite3.Connection, run_id: str, development_id: str) -> list[str]:
    """The own sites of the subjects a development is tagged to in a run."""
    domains = {e.id: e.domains for e in load_subjects().entities}
    return [
        d
        for r in conn.execute(
            "SELECT subject_id FROM development_subjects WHERE run_id = ? AND development_id = ?",
            (run_id, development_id),
        )
        for d in domains.get(r["subject_id"], [])
    ]


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
        clipped_start=lo > 0,
        clipped_end=hi < len(text),
    )


def _detection_charts(
    conn: sqlite3.Connection, document_ids: list[str], as_of: date
) -> dict[str, SeriesChart]:
    """Each detector document's series as of the run date, its event from first to firing period
    highlighted. A series no longer in the seed has none."""
    by_id = {s.id: s for s in load_series().series}
    marks = ",".join("?" for _ in document_ids)
    return {
        r["document_id"]: series_chart(
            conn,
            by_id[r["series_id"]],
            as_of,
            date.fromisoformat(r["start"]),
            date.fromisoformat(r["period"]),
        )
        for r in conn.execute(
            f"SELECT document_id, series_id, start, period FROM detections "
            f"WHERE document_id IN ({marks})",
            document_ids,
        )
        if r["series_id"] in by_id
    }


def development_sources(
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    development_id: str,
    new_document_ids: set[str],
) -> list[EvidenceSource]:
    """A development's sources, each with its findings, in `source_rank` order. A detector's
    document carries its series' chart as of the run date."""
    rows = conn.execute(
        "SELECT f.id AS finding_id, f.statement, f.event_date, f.quotes, d.* "
        "FROM development_sources s JOIN findings f ON f.id = s.finding_id "
        "JOIN source_documents d ON d.id = s.document_id "
        "WHERE s.run_id = ? AND s.development_id = ? ORDER BY d.published_at, f.id",
        (run_id, development_id),
    ).fetchall()
    charts = _detection_charts(
        conn, list({r["id"] for r in rows if r["collection"] == "data"}), as_of
    )
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
                series=charts.get(r["id"]),
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
    own = own_domains(conn, run_id, development_id)
    return sorted(
        sources.values(),
        key=lambda s: (source_rank(s.collection, s.domain, own), s.published_at),
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
