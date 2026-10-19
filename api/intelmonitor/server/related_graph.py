"""The Overview's Related graph (GET /subjects/{id}/related-graph): every subject and endpoint
linked to the subject in the relationship store, in either direction, each with its links in a
few words and the shown developments of the window that reach the subject through it.

A development reaches the subject through a node when its impact route for the subject
(development_impacts, read by server/impacts.py) leaves by the subject's link to that node, or
passes through a node the development is tagged to directly: news tagged to Hong Kong that
reaches DBS through DBS Hong Kong counts for both. Routes run from the subject outward, so only
nodes the subject links to can carry developments; nodes that link to it (banks that depend on
Azure, Temasek holding DBS) carry none."""

from collections import Counter

from intelmonitor.pipeline.impact import short_label
from intelmonitor.relationships import REL_TYPES, SCHEMA, links_of
from intelmonitor.server.impacts import subject_impacts
from intelmonitor.server.models import (
    RelatedDays,
    RelatedFacet,
    RelatedGraph,
    RelatedLink,
    RelatedNode,
)
from intelmonitor.server.queries import Queries, subject_ref


def related_graph(q: Queries, subject_id: str, days: RelatedDays) -> RelatedGraph:
    """The subject's linked nodes with the developments last published within `days` of the run
    date that reach it through each, which subject_impacts already limits to shown ones."""
    q.conn.executescript(SCHEMA)  # a store the pipeline has not synced serves no links
    nodes: dict[str, RelatedNode] = {}
    for r, node in links_of(q.conn, subject_id):
        found = nodes.setdefault(
            node.id,
            RelatedNode(
                id=node.id,
                name=node.name,
                kind=node.kind,
                subject=subject_ref(node.id) if node.subject else None,
                links=[],
                development_ids=[],
                harmful=0,
            ),
        )
        outbound = r.from_ == subject_id
        found.links.append(
            RelatedLink(id=r.id, type=r.type, outbound=outbound, label=short_label(r, outbound))
        )

    impacts = subject_impacts(q, subject_id, days) if nodes else []  # in display order
    for i in impacts:
        path = i.relationships
        tagged = q.devs.subject_ids[i.development_id]
        through = {path[0].to_id} | {r.to_id for r in path[1:] if r.to_id in tagged}
        for node_id in through & nodes.keys():
            n = nodes[node_id]
            n.development_ids.append(i.development_id)
            n.harmful += int(i.direction == "negative")

    types = Counter(link.type for n in nodes.values() for link in n.links)
    return RelatedGraph(
        run=q.run,
        center=subject_ref(subject_id),
        days=days,
        nodes=sorted(
            nodes.values(), key=lambda n: (-len(n.development_ids), -n.harmful, n.name.lower())
        ),
        developments=[i.development for i in impacts],
        link_types=[RelatedFacet(type=t, count=types[t]) for t in REL_TYPES if types[t]],
    )
