"""Step 10: graph nodes and edges for a run. Subjects and developments are nodes; edges are
MEMBER_OF (entity to group) and EXPOSED_TO (group to topic) from the seed file, and AFFECTS
(development to subject) from the tags, each with its source and confidence. Jev tags each
development with one theme, which the graph view colours and groups by."""

import asyncio
import json
import sqlite3
from typing import Literal

from typesafe_sdk import Choice

from intelmonitor.pipeline.diff import DevelopmentChange
from intelmonitor.pipeline.inference import Inference, StepFailed, choice
from intelmonitor.seed import load_subjects

# The graph view's fixed themes, in the order their sectors sit around the centre.
Theme = Literal["regulation", "digital-assets", "technology", "strategy", "markets", "macro"]
THEMES: dict[str, str] = {
    "regulation": "Rules, consultations, licensing, supervision, AML/CFT or enforcement action",
    "digital-assets": "Stablecoins, tokenised deposits or assets, crypto, CBDCs or blockchain",
    "technology": "AI, technology spending, cyber security, outages or digital platforms",
    "strategy": "M&A, expansion, new products, wealth management, partnerships or leadership",
    "markets": "Earnings, capital, share prices, ratings, analyst calls or market moves",
    "macro": "Monetary policy, rates, growth, FX, trade, tariffs, sanctions or conflicts",
}
THEME = Choice(instructions="What is this development mainly about?", criteria=dict(THEMES))


async def development_themes(
    inf: Inference, conn: sqlite3.Connection, run_id: str
) -> dict[str, str]:
    """Theme per development id, one Jev call on each development's statement."""
    rows = conn.execute("SELECT id, title FROM developments WHERE run_id = ?", (run_id,)).fetchall()
    failures: list[str] = []

    async def tag(r: sqlite3.Row) -> tuple[str, str]:
        try:
            answers = await inf.jev(
                "theme", f"dev:{r['id']}", f"Development: {r['title']}", {"theme": THEME}
            )
        except Exception as error:
            failures.append(f"{r['id']}: {type(error).__name__}: {error}")
            return r["id"], ""
        return r["id"], choice(answers, "theme").choice

    themes = dict(await asyncio.gather(*(tag(r) for r in rows)))
    if failures:
        raise StepFailed("theme", failures)
    return themes


async def store_graph(
    inf: Inference, conn: sqlite3.Connection, run_id: str, changes: dict[str, DevelopmentChange]
) -> tuple[int, int]:
    """Rebuild the run's graph; returns (nodes, edges)."""
    themes = await development_themes(inf, conn, run_id)
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
            "theme": themes[d["id"]],
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
