"""Search for the top bar: subjects by name and alias, and the latest run's developments and
their source documents by full text (store/search.py)."""

from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.server.models import DocumentHit, SearchHit, SearchResults
from intelmonitor.server.queries import Queries, aliases, subject_ref
from intelmonitor.store import search as fts


def search(q: Queries, text: str, limit: int) -> SearchResults:
    query = fts.match_query(text)
    if query is None:
        return SearchResults(subjects=subjects(text), developments=[], documents=[])
    development_ids = fts.developments(q.conn, q.run.id, query, limit)
    documents = fts.documents(q.conn, q.run.id, query, limit)
    citing = _citing_development(q, [d.id for d in documents])
    return SearchResults(
        subjects=subjects(text),
        developments=[q.devs.by_id[i] for i in development_ids if i in q.devs.by_id],
        documents=[
            DocumentHit(
                id=d.id,
                title=d.title,
                domain=d.domain,
                published_at=d.published_at,
                snippet=d.snippet,
                development_id=citing[d.id],
            )
            for d in documents
            if d.id in citing
        ],
    )


def subjects(text: str) -> list[SearchHit]:
    """Subjects by name and alias: exact matches first, then prefixes, then word prefixes, then
    substrings."""
    needle = text.strip().lower()
    hits: list[tuple[int, int, SearchHit]] = []
    for position, s in enumerate(all_subjects().values()):
        best: tuple[int, str] | None = None
        for name in [s.name, *aliases(s.id)]:
            low = name.lower()
            if low == needle:
                rank = 0
            elif low.startswith(needle):
                rank = 1
            elif any(w.startswith(needle) for w in low.split()):
                rank = 2
            elif needle in low:
                rank = 3
            else:
                continue
            if best is None or rank < best[0]:
                best = (rank, name)
        if best:
            hit = SearchHit(subject=subject_ref(s.id), matched=best[1])
            hits.append((best[0], position, hit))
    return [h for _, _, h in sorted(hits, key=lambda t: (t[0], t[1]))]


def _citing_development(q: Queries, document_ids: list[str]) -> dict[str, str]:
    """For each document, the first development in display order that cites it."""
    if not document_ids:
        return {}
    cited: dict[str, set[str]] = {}
    for r in q.conn.execute(
        "SELECT document_id, development_id FROM development_sources WHERE run_id = ? "
        f"AND document_id IN ({', '.join('?' for _ in document_ids)})",
        (q.run.id, *document_ids),
    ):
        cited.setdefault(r["document_id"], set()).add(r["development_id"])
    order = {d: i for i, d in enumerate(q.devs.by_id)}
    return {
        doc: min(devs, key=lambda d: order.get(d, len(order)))
        for doc, devs in cited.items()
        if any(d in order for d in devs)
    }
