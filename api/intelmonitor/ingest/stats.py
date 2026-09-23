"""`im ingest --stats`: documents per source and candidate documents per subject."""

import sqlite3
from collections import Counter

from intelmonitor.ingest.candidates import candidate_counts, subject_matchers
from intelmonitor.store.db import get_meta
from intelmonitor.store.documents import list_documents

MIN_CANDIDATES = 5


def ingest_stats(conn: sqlite3.Connection) -> str:
    """Readable stats, ending with whether the corpus meets the phase 1 targets (300 to 600
    documents, at least MIN_CANDIDATES candidates per subject)."""
    docs = list_documents(conn)
    lines = [f"T0 {get_meta(conn, 't0')}, {len(docs)} documents"]
    if docs:
        lines.append(
            f"published {docs[0].published_at:%Y-%m-%d} to {docs[-1].published_at:%Y-%m-%d}"
        )

    lines += ["", "source      collection  documents"]
    by_source = Counter((d.source, d.collection) for d in docs)
    lines += [f"{s:<11} {c:<11} {n:>9}" for (s, c), n in sorted(by_source.items())]

    counts = candidate_counts((d.title, d.text) for d in docs)
    lines += ["", "subject                type     candidates"]
    thin: list[str] = []
    for m in subject_matchers():
        flag = "" if counts[m.id] >= MIN_CANDIDATES else "  < target"
        if flag:
            thin.append(m.id)
        lines.append(f"{m.id:<22} {m.type:<8} {counts[m.id]:>10}{flag}")

    ok = 300 <= len(docs) <= 600 and not thin
    lines += [
        "",
        f"targets: {'met' if ok else 'not met'} (300-600 documents, >= {MIN_CANDIDATES} "
        f"candidates per subject{'; thin: ' + ', '.join(thin) if thin else ''})",
    ]
    return "\n".join(lines)
