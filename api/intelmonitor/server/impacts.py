"""Indirect impacts, direct subjects and shared relationships, read from the latest run's
development_impacts and the relationship store (pipeline/impact.py, relationships.py)."""

import json
import sqlite3
from datetime import timedelta

from intelmonitor.pipeline.impact import relationship_label
from intelmonitor.pipeline.params import PRIORITY_LABELS
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.relationships import SCHEMA, Relationship, shared
from intelmonitor.server.models import (
    DirectSubject,
    ImpactPassage,
    IndirectImpact,
    RelationshipFigure,
    RelationshipLink,
    SharedEndpoint,
    SharedRelationships,
    SubjectImpact,
)
from intelmonitor.server.queries import Queries, subject_ref

# The period a monitor page shows indirect impacts for, as the entity brief covers a week.
IMPACT_PERIOD_DAYS = 7


def display_names(conn: sqlite3.Connection) -> dict[str, str]:
    """Display names of every subject and relationship endpoint, by id. A store the pipeline has
    not synced yet gets the relationship tables empty, so it serves no links instead of failing."""
    conn.executescript(SCHEMA)
    names = {i: s.name for i, s in all_subjects().items()}
    for r in conn.execute("SELECT id, name FROM relationship_endpoints"):
        names.setdefault(r["id"], r["name"])
    return names


def relationship_link(r: Relationship, names: dict[str, str]) -> RelationshipLink:
    return RelationshipLink(
        id=r.id,
        type=r.type,
        label=relationship_label(r),
        from_id=r.from_,
        from_name=names.get(r.from_, r.from_),
        to_id=r.to,
        to_name=names.get(r.to, r.to),
        weight=r.weight,
        measure=r.measure,
        value=r.value,
        unit=r.unit,
        evidence=r.evidence,
        chart_reading=r.chart_reading,
        as_of=r.as_of,
        last_confirmed=r.last_confirmed,
        source_url=r.source_url,
        source_title=r.source_title,
        page=r.page,
        quote=r.quote,
        detail=r.detail,
        figures=[RelationshipFigure.model_validate(f.model_dump()) for f in r.figures],
    )


def _relationships(conn: sqlite3.Connection, ids: set[str]) -> dict[str, Relationship]:
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT data FROM relationships WHERE id IN ({marks})", sorted(ids))
    return {(r := Relationship.model_validate_json(row["data"])).id: r for row in rows.fetchall()}


def _impacts(q: Queries, where: str, args: tuple[object, ...]) -> list[IndirectImpact]:
    """The latest run's impacts matching `where`, by development and rank. An impact whose
    relationship left the store since the run, or whose subject left the seed, is skipped."""
    rows = q.conn.execute(
        f"SELECT * FROM development_impacts WHERE run_id = ? AND {where} "
        "ORDER BY development_id, rank",
        (q.run.id, *args),
    ).fetchall()
    if not rows:
        return []
    ids = {i for r in rows for i in json.loads(r["relationship_ids"])}
    names = display_names(q.conn)
    stored = _relationships(q.conn, ids)
    subjects = all_subjects()
    found: list[IndirectImpact] = []
    for r in rows:
        path = [stored.get(i) for i in json.loads(r["relationship_ids"])]
        rels = [x for x in path if x is not None]
        if len(rels) < len(path) or r["subject_id"] not in subjects:
            continue
        found.append(
            IndirectImpact(
                development_id=r["development_id"],
                subject=subject_ref(r["subject_id"]),
                direction=r["direction"],
                route=r["route"],
                why=r["why"],
                confidence=r["confidence"],
                weight=r["weight"],
                region=names.get(r["region"], r["region"]) if r["region"] else None,
                evidence=r["evidence"],
                last_confirmed=min(x.last_confirmed for x in rels),
                relationships=[relationship_link(x, names) for x in rels],
                finding_ids=json.loads(r["finding_ids"]),
                passages=[ImpactPassage.model_validate(p) for p in json.loads(r["passages"])],
            )
        )
    return found


def development_impacts(q: Queries, development_id: str) -> list[IndirectImpact]:
    """The entities a development reaches indirectly, in rank order."""
    return _impacts(q, "development_id = ?", (development_id,))


def subject_impacts(q: Queries, subject_id: str, days: int | None) -> list[SubjectImpact]:
    """Developments that reach the subject indirectly, last published within `days` of the run
    date (any time in the run when None), in display order."""
    since = q.run.as_of - timedelta(days=days) if days else None
    found: list[SubjectImpact] = []
    for i in _impacts(q, "subject_id = ?", (subject_id,)):
        dev = q.devs.by_id.get(i.development_id)
        if dev is not None and (since is None or dev.last_published > since):
            found.append(SubjectImpact(**i.model_dump(), development=dev))
    order = list(q.devs.by_id)
    return sorted(found, key=lambda s: order.index(s.development_id))


def direct_subjects(q: Queries, development_id: str) -> list[DirectSubject]:
    """What the development happened to or who did it, highest priority first."""
    subjects = all_subjects()
    return [
        DirectSubject(
            subject=subject_ref(r["subject_id"]),
            role=r["role"],
            priority=PRIORITY_LABELS[int(r["priority_level"])],
            adverse=bool(r["adverse"]),
            tone=r["tone"],
        )
        for r in q.conn.execute(
            "SELECT subject_id, role, priority_level, adverse, tone FROM development_subjects "
            "WHERE run_id = ? AND development_id = ? "
            "ORDER BY priority_level DESC, priority_score DESC, subject_id",
            (q.run.id, development_id),
        )
        if r["subject_id"] in subjects
    ]


def shared_relationships(conn: sqlite3.Connection, a: str, b: str) -> SharedRelationships:
    """What links both entities in the relationship store, each link with its type and source."""
    names = display_names(conn)
    return SharedRelationships(
        a=subject_ref(a),
        b=subject_ref(b),
        endpoints=sorted(
            (
                SharedEndpoint(
                    id=e.node.id,
                    name=e.node.name,
                    kind=e.node.kind,
                    subject=e.node.subject,
                    a_links=[relationship_link(r, names) for r in e.a_links],
                    b_links=[relationship_link(r, names) for r in e.b_links],
                )
                for e in shared(conn, a, b)
            ),
            key=lambda e: e.name,
        ),
    )
