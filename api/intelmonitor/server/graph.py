"""Graph neighbourhood around one subject, read from the run's graph_nodes and graph_edges."""

import json
from collections import deque
from datetime import date, timedelta

from intelmonitor.server.models import Graph, GraphEdge, GraphNode, LinkType, NodeType
from intelmonitor.server.queries import NotFoundError, Queries

# Development nodes kept at most, so the view never shows the whole graph.
MAX_DEVELOPMENTS = 40


def neighbourhood(
    q: Queries,
    center: str,
    hops: int,
    node_types: set[NodeType],
    link_types: set[LinkType],
    window_days: int | None,
) -> Graph:
    """Nodes within `hops` links of `center`, walking links in either direction. Development
    nodes outside the time window, or of excluded types, are neither shown nor walked through."""
    run = q.run
    since = run.as_of - timedelta(days=window_days) if window_days else None
    nodes: dict[str, GraphNode] = {}
    for r in q.conn.execute("SELECT * FROM graph_nodes WHERE run_id = ?", (run.id,)):
        data = json.loads(r["data"])
        published = date.fromisoformat(data["last_published"]) if "last_published" in data else None
        if r["type"] == "development" and since and published and published <= since:
            continue
        nodes[r["id"]] = GraphNode(
            id=r["id"],
            type=r["type"],
            label=r["label"],
            kind=data.get("kind"),
            hop=0,
            has_new=data.get("change") is not None,
            needs_attention=bool(data.get("needs_attention", False)),
            materiality_level=data.get("materiality_level"),
            last_published=published,
        )
    if center not in nodes or nodes[center].type == "development":
        raise NotFoundError(f"subject {center}")

    edges = [
        GraphEdge(
            source=r["from_id"],
            target=r["to_id"],
            type=r["type"],
            origin=r["source"],
            confidence=r["confidence"],
        )
        for r in q.conn.execute("SELECT * FROM graph_edges WHERE run_id = ?", (run.id,))
        if r["type"] in link_types and r["from_id"] in nodes and r["to_id"] in nodes
    ]
    # A subject is highlighted when a new or updated development in the window affects it.
    for e in edges:
        if e.type == "AFFECTS" and nodes[e.source].has_new:
            nodes[e.target].has_new = True

    adjacent: dict[str, list[str]] = {}
    for e in edges:
        adjacent.setdefault(e.source, []).append(e.target)
        adjacent.setdefault(e.target, []).append(e.source)

    def walk(allowed: set[str]) -> dict[str, int]:
        hop = {center: 0}
        queue = deque([center])
        while queue:
            at = queue.popleft()
            if hop[at] == hops:
                continue
            for nxt in adjacent.get(at, []):
                if nxt in allowed and nxt not in hop:
                    hop[nxt] = hop[at] + 1
                    queue.append(nxt)
        return hop

    allowed = {i for i, n in nodes.items() if n.type in node_types or i == center}
    hop = walk(allowed)
    devs = sorted(
        (i for i in hop if nodes[i].type == "development"),
        key=lambda i: (
            hop[i],
            not nodes[i].needs_attention,
            not nodes[i].has_new,
            -(nodes[i].materiality_level or 0),
            i,
        ),
    )
    dropped = set(devs[MAX_DEVELOPMENTS:])
    # Walk again without the dropped developments so every kept node stays connected.
    hop = walk(allowed - dropped) if dropped else hop
    kept = set(hop)
    for i in kept:
        nodes[i].hop = hop[i]
    return Graph(
        run=run,
        center=center,
        hops=hops,
        nodes=sorted((nodes[i] for i in kept), key=lambda n: (n.hop, n.type, n.label)),
        edges=[e for e in edges if e.source in kept and e.target in kept],
        truncated_developments=len(dropped),
    )
