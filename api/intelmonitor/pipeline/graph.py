"""Step 10: graph nodes and edges for a run. Subjects and developments are nodes; edges are
MEMBER_OF (entity to group) and EXPOSED_TO (group to topic) from the seed file, and AFFECTS
(development to subject) from the tags, each with its source and confidence."""

import json
import sqlite3

from intelmonitor.pipeline.diff import DevelopmentChange
from intelmonitor.seed import load_subjects


def store_graph(
    conn: sqlite3.Connection, run_id: str, changes: dict[str, DevelopmentChange]
) -> tuple[int, int]:
    """Rebuild the run's graph; returns (nodes, edges)."""
    conn.execute("DELETE FROM graph_nodes WHERE run_id = ?", (run_id,))
    conn.execute("DELETE FROM graph_edges WHERE run_id = ?", (run_id,))
    seed = load_subjects()
    nodes: list[tuple[str, str, str, str, str]] = []
    edges: list[tuple[str, str, str, str, str, float]] = []

    nodes += [(run_id, t.id, "topic", t.name, json.dumps({})) for t in seed.topics]
    nodes += [(run_id, g.id, "group", g.name, json.dumps({})) for g in seed.groups]
    nodes += [(run_id, e.id, "entity", e.name, json.dumps({"kind": e.kind})) for e in seed.entities]
    for g in seed.groups:
        edges += [(run_id, m, g.id, "MEMBER_OF", "seed", 1.0) for m in g.members]
        edges += [(run_id, g.id, t, "EXPOSED_TO", "seed", 1.0) for t in g.topics]

    for d in conn.execute("SELECT * FROM developments WHERE run_id = ?", (run_id,)):
        change = changes.get(d["id"])
        data = {
            "category": d["category"],
            "materiality_level": d["materiality_level"],
            "needs_attention": bool(d["needs_attention"]),
            "last_published": d["last_published"],
            "change": change.kind if change else None,
        }
        nodes.append((run_id, f"dev:{d['id']}", "development", d["title"], json.dumps(data)))
    for s in conn.execute(
        "SELECT development_id, subject_id, confidence, source FROM development_subjects "
        "WHERE run_id = ?",
        (run_id,),
    ):
        edges.append(
            (
                run_id,
                f"dev:{s['development_id']}",
                s["subject_id"],
                "AFFECTS",
                s["source"],
                s["confidence"],
            )
        )

    conn.executemany(
        "INSERT INTO graph_nodes (run_id, id, type, label, data) VALUES (?, ?, ?, ?, ?)", nodes
    )
    conn.executemany(
        "INSERT INTO graph_edges (run_id, from_id, to_id, type, source, confidence) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        edges,
    )
    conn.commit()
    return len(nodes), len(edges)
