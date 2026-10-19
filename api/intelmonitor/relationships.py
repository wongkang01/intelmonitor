"""The relationship store: standing links between subjects and endpoints, for indirect impact.

api/seed/relationships.yaml (built by scripts/build_relationships.py) holds every relationship
and an endpoint entry for each id that is not an entity subject. sync_relationships() copies it
into the store at the start of a pipeline run; paths_to(), candidates() and shared() read it back
for the impact step and GET /shared, links_from() for the briefs, and links_of() for the
Related graph.

Direction: news about a relationship's `to` reaches its `from` (DBS exposed_to Hong Kong, FAST
depends_on BCS, BCS subsidiary_of NETS, NETS owns BCS).
"""

import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from intelmonitor.config import SEED_DIR
from intelmonitor.seed import EntityKind, load_subjects

RELATIONSHIPS_PATH = SEED_DIR / "relationships.yaml"

RelType = Literal[
    "exposed_to",
    "depends_on",
    "participates_in",
    "owns",
    "subsidiary_of",
    "operates_in",
    "supervised_by",
    "shareholder_of",
    "member_of",
    "listed_on",
]
REL_TYPES: tuple[RelType, ...] = RelType.__args__
Evidence = Literal["public", "reported", "assumed"]
EVIDENCE_GRADES: tuple[Evidence, ...] = Evidence.__args__  # strongest first
EndpointKind = Literal[
    "bank",
    "insurer",
    "broker",
    "investor",
    "person",
    "association",
    "central_bank",
    "regulator",
    "market_infrastructure",
    "payment_system",
    "payment_institution",
    "tech_provider",
    "stablecoin_issuer",
    "digital_asset_firm",
    "blockchain",
    "country",
    "region",
    "sector",
    "group",
]
# The headline figure of an exposure; further figures add NPLs and ratios. A bank's exposure is
# measured in loans (the first three); any other entity's in what its share is of: stablecoin
# reserves, its reserve fund's repo book, revenue, distribution costs, token supply by chain or
# customer assets, or, with no share, stablecoins held and card volume.
LoanMeasure = Literal["gross_customer_loans", "loans_by_currency", "rwa"]
LOAN_MEASURES: tuple[LoanMeasure, ...] = LoanMeasure.__args__
HeadlineMeasure = Literal[
    LoanMeasure,
    "reserve_assets",
    "repo_principal",
    "revenue",
    "distribution_costs",
    "token_supply",
    "assets_on_platform",
    "stablecoin_holdings",
    "card_volume",
]
FigureMeasure = Literal[HeadlineMeasure, "npl", "npl_ratio", "npa_coverage"]
Dimension = Literal[
    "geography",
    "industry",
    "currency",
    "specific",
    "ccyb_country",
    "reserve_composition",
    "revenue",
    "counterparty",
]
MoneyUnit = Literal["SGD m", "SGD b", "USD m"]
HeadlineUnit = Literal[MoneyUnit, "m tokens"]
FigureUnit = Literal[HeadlineUnit, "%", "% of loans", "% of gross loans"]
Service = Literal[
    "banking",
    "blockchain",
    "cloud",
    "core_banking",
    "custody",
    "data_centre",
    "distribution",
    "market_infrastructure",
    "payments",
    "print_mail",
    "reserve_management",
    "security",
    "telco",
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Figure(_Model):
    """A further figure for the same bank and target as its exposure relationship."""

    measure: FigureMeasure
    dimension: Dimension
    segment: str
    value: float
    unit: FigureUnit
    share: float | None = None  # share of the total in the same source table
    period: date
    chart_reading: bool = False
    source_url: str
    source_title: str
    page: int | None = None
    quote: str
    note: str | None = None


class Relationship(_Model):
    """One link, as relationships.yaml holds it. Keys at their default are left out of the YAML."""

    model_config = ConfigDict(validate_by_name=True)

    id: str  # "from:type:to"
    from_: str = Field(validation_alias="from", serialization_alias="from")
    to: str
    type: RelType
    # exposed_to: the headline figure's share of its total (a bank's gross customer loans, an
    # issuer's reserves, a firm's revenue); owns, shareholder_of: ownership share
    weight: float | None = None
    measure: HeadlineMeasure | None = None
    value: float | None = None
    unit: HeadlineUnit | None = None
    evidence: Evidence
    chart_reading: bool = False
    as_of: date | None = None
    last_confirmed: date
    source_url: str | None = None
    source_title: str | None = None
    page: int | None = None
    quote: str | None = None
    detail: str
    service: Service | None = None
    figures: list[Figure] = []


class Endpoint(_Model):
    """A relationship end that is not an entity subject; regions list the places they cover."""

    id: str
    name: str
    kind: EndpointKind
    members: list[str] = []
    detail: str | None = None


class RelationshipsFile(_Model):
    relationships: list[Relationship]
    endpoints: list[Endpoint]


def problems(data: RelationshipsFile, subject_ids: set[str]) -> list[str]:
    """Why the file does not fit the subject seed: ids that are neither an entity subject nor an
    endpoint, and endpoint entries for ids that are now subjects. Empty when it fits."""
    endpoint_ids = {e.id for e in data.endpoints}
    used = {r.from_ for r in data.relationships} | {r.to for r in data.relationships}
    used |= {m for e in data.endpoints for m in e.members}
    unknown = sorted(used - subject_ids - endpoint_ids)
    both = sorted(endpoint_ids & subject_ids)
    return [f"neither a subject nor an endpoint: {i}" for i in unknown] + [
        f"both a subject and an endpoint: {i}" for i in both
    ]


def load_relationships(path: Path = RELATIONSHIPS_PATH) -> RelationshipsFile:
    """Read relationships.yaml and check it against the entity subjects in subjects.yaml. Raises
    ValueError naming every unknown id; the fix is to rerun scripts/build_relationships.py."""
    data = RelationshipsFile.model_validate(yaml.safe_load(path.read_text()))
    found = problems(data, {e.id for e in load_subjects().entities})
    if found:
        raise ValueError(
            f"{path.name} does not fit the subject seed (rerun scripts/build_relationships.py): "
            + "; ".join(found)
        )
    return data


# The store's copy of relationships.yaml, replaced whole by sync_relationships(). `data` holds
# the full relationship (figures, source, quote) as JSON; the other columns are for queries.
SCHEMA = """
CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL,
    evidence TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relationships_from ON relationships (from_id);
CREATE INDEX IF NOT EXISTS relationships_to ON relationships (to_id);
CREATE TABLE IF NOT EXISTS relationship_endpoints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    members TEXT NOT NULL,  -- JSON list; regions only
    detail TEXT
);
"""


def sync_relationships(
    conn: sqlite3.Connection, path: Path = RELATIONSHIPS_PATH
) -> RelationshipsFile:
    """Replace the store's relationships and endpoints with relationships.yaml, in one
    transaction. Raises before touching the store if the file does not fit the subject seed.
    Commits any transaction the caller has open, so call it before a run's writes."""
    data = load_relationships(path)
    conn.executescript(SCHEMA)
    with conn:
        conn.execute("DELETE FROM relationships")
        conn.execute("DELETE FROM relationship_endpoints")
        conn.executemany(
            "INSERT INTO relationships (id, from_id, to_id, type, weight, evidence, data) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    r.id,
                    r.from_,
                    r.to,
                    r.type,
                    r.weight,
                    r.evidence,
                    r.model_dump_json(by_alias=True),
                )
                for r in data.relationships
            ],
        )
        conn.executemany(
            "INSERT INTO relationship_endpoints (id, name, kind, members, detail) "
            "VALUES (?, ?, ?, ?, ?)",
            [(e.id, e.name, e.kind, json.dumps(e.members), e.detail) for e in data.endpoints],
        )
    return data


class Node(_Model):
    """A subject or endpoint on a path, named for the route a reader sees."""

    id: str
    name: str
    kind: EntityKind | EndpointKind
    subject: bool  # a tracked entity subject; otherwise an endpoint


class ImpactPath(_Model):
    """How news about `target` reaches `subject`: one relationship, or two through `nodes[1]`.
    `relationships` and `nodes` run from the subject outward, so relationships[i] links nodes[i]
    to nodes[i + 1]. When the last node is a region that covers the target (UOB's Greater China
    loans for Taiwan news), `region` names it and the path is region-level."""

    subject: str
    target: str
    relationships: list[Relationship]
    nodes: list[Node]
    region: str | None = None
    weight: float | None = None  # the exposed_to link's share, if the path has one
    evidence: Evidence  # the weakest grade along the path
    chart_reading: bool = False

    @property
    def relationship_ids(self) -> list[str]:
        return [r.id for r in self.relationships]


# A second hop counts only after one of these from the subject: what it takes part in, what it
# depends on, its parent, and what it owns (OCBC owns OCBC Malaysia, which operates in Malaysia).
FIRST_HOPS: tuple[RelType, ...] = ("participates_in", "depends_on", "subsidiary_of", "owns")


def _nodes(conn: sqlite3.Connection, ids: set[str]) -> dict[str, Node]:
    marks = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT id, name, kind FROM relationship_endpoints WHERE id IN ({marks})", sorted(ids)
    ).fetchall()
    nodes = {
        str(r["id"]): Node(id=r["id"], name=r["name"], kind=r["kind"], subject=False) for r in rows
    }
    entities = {e.id: e for e in load_subjects().entities}
    for i in ids - nodes.keys():
        e = entities[i]  # sync checked every id is a subject or an endpoint
        nodes[i] = Node(id=i, name=e.name, kind=e.kind, subject=True)
    return nodes


def _regions(conn: sqlite3.Connection, target_id: str) -> list[str]:
    """The region endpoints whose members include the target."""
    rows = conn.execute(
        "SELECT e.id FROM relationship_endpoints e, json_each(e.members) m "
        "WHERE e.kind = 'region' AND m.value = ? ORDER BY e.id",
        (target_id,),
    ).fetchall()
    return [str(r["id"]) for r in rows]


def _path(target_id: str, rels: list[Relationship], nodes: dict[str, Node]) -> ImpactPath:
    end = rels[-1].to
    exposure = next((r for r in rels if r.type == "exposed_to"), None)
    return ImpactPath(
        subject=rels[0].from_,
        target=target_id,
        relationships=rels,
        nodes=[nodes[rels[0].from_], *(nodes[r.to] for r in rels)],
        region=None if end == target_id else end,
        weight=exposure.weight if exposure else None,
        evidence=EVIDENCE_GRADES[max(EVIDENCE_GRADES.index(r.evidence) for r in rels)],
        chart_reading=any(r.chart_reading for r in rels),
    )


def paths_to(conn: sqlite3.Connection, target_id: str) -> list[ImpactPath]:
    """Every path by which news about `target_id` reaches a tracked entity subject: one
    relationship into the target (or into a region that covers it), or two where the first, from
    the subject, is one of FIRST_HOPS. Endpoints, groups among them, are never the subject."""
    ends = [target_id, *_regions(conn, target_id)]
    end_marks = ",".join("?" * len(ends))
    hop_marks = ",".join("?" * len(FIRST_HOPS))
    not_endpoint = "NOT IN (SELECT id FROM relationship_endpoints)"
    one = conn.execute(
        f"SELECT data FROM relationships WHERE to_id IN ({end_marks}) "
        f"AND from_id != ? AND from_id {not_endpoint}",
        [*ends, target_id],
    ).fetchall()
    two = conn.execute(
        "SELECT r1.data AS first, r2.data AS second FROM relationships r1 "
        "JOIN relationships r2 ON r2.from_id = r1.to_id "
        f"WHERE r1.type IN ({hop_marks}) AND r2.to_id IN ({end_marks}) "
        f"AND r1.from_id != ? AND r1.to_id != ? AND r1.from_id {not_endpoint}",
        [*FIRST_HOPS, *ends, target_id, target_id],
    ).fetchall()
    chains = [[Relationship.model_validate_json(r["data"])] for r in one] + [
        [
            Relationship.model_validate_json(r["first"]),
            Relationship.model_validate_json(r["second"]),
        ]
        for r in two
    ]
    if not chains:
        return []
    nodes = _nodes(conn, {c[0].from_ for c in chains} | {r.to for c in chains for r in c})
    paths = [_path(target_id, c, nodes) for c in chains]
    return sorted(paths, key=lambda p: (p.subject, len(p.relationships), p.relationship_ids))


# How an institution links to a place, sector, supplier or payment system on that subject's page:
# one of LINKED_FIRST into it, or owning a company that has one of LINKED_SECOND into it.
LINKED_FIRST: tuple[RelType, ...] = (
    "exposed_to",
    "depends_on",
    "participates_in",
    "owns",
    "operates_in",
)
LINKED_SECOND: tuple[RelType, ...] = ("operates_in", "exposed_to", "depends_on", "participates_in")


def linked_paths(conn: sqlite3.Connection, target_id: str) -> list[ImpactPath]:
    """Every node linked to `target_id` (or to a region that covers it) by one LINKED_FIRST link,
    or by owning a company with a LINKED_SECOND link into it, for the target's page. Unlike
    paths_to, the first node may be an endpoint, so untracked institutions count; shareholders
    that only hold a stake in a bank (Singtel in GXS Bank) are left to the caller to drop."""
    ends = [target_id, *_regions(conn, target_id)]
    end_marks = ",".join("?" * len(ends))
    first_marks = ",".join("?" * len(LINKED_FIRST))
    second_marks = ",".join("?" * len(LINKED_SECOND))
    one = conn.execute(
        f"SELECT data FROM relationships WHERE to_id IN ({end_marks}) "
        f"AND type IN ({first_marks}) AND from_id != ?",
        [*ends, *LINKED_FIRST, target_id],
    ).fetchall()
    two = conn.execute(
        "SELECT r1.data AS first, r2.data AS second FROM relationships r1 "
        "JOIN relationships r2 ON r2.from_id = r1.to_id "
        f"WHERE r1.type = 'owns' AND r2.type IN ({second_marks}) AND r2.to_id IN ({end_marks}) "
        "AND r1.from_id != ?",
        [*LINKED_SECOND, *ends, target_id],
    ).fetchall()
    chains = [[Relationship.model_validate_json(r["data"])] for r in one] + [
        [
            Relationship.model_validate_json(r["first"]),
            Relationship.model_validate_json(r["second"]),
        ]
        for r in two
    ]
    if not chains:
        return []
    nodes = _nodes(conn, {c[0].from_ for c in chains} | {r.to for c in chains for r in c})
    return [_path(target_id, c, nodes) for c in chains]


def links_from(
    conn: sqlite3.Connection, subject_id: str, types: tuple[RelType, ...]
) -> list[tuple[Relationship, Node]]:
    """The subject's own links of the given types, each with the node it leads to, by id."""
    marks = ",".join("?" * len(types))
    rows = conn.execute(
        f"SELECT data FROM relationships WHERE from_id = ? AND type IN ({marks}) ORDER BY id",
        (subject_id, *types),
    ).fetchall()
    rels = [Relationship.model_validate_json(r["data"]) for r in rows]
    if not rels:
        return []
    nodes = _nodes(conn, {r.to for r in rels})
    return [(r, nodes[r.to]) for r in rels]


def links_of(conn: sqlite3.Connection, subject_id: str) -> list[tuple[Relationship, Node]]:
    """Every link from or to the subject, each with the node at its other end, by id."""
    rows = conn.execute(
        "SELECT data FROM relationships WHERE from_id = ? OR to_id = ? ORDER BY id",
        (subject_id, subject_id),
    ).fetchall()
    rels = [Relationship.model_validate_json(r["data"]) for r in rows]
    if not rels:
        return []
    other = {r.id: r.to if r.from_ == subject_id else r.from_ for r in rels}
    nodes = _nodes(conn, set(other.values()))
    return [(r, nodes[other[r.id]]) for r in rels]


class Candidate(_Model):
    """A tracked entity subject that news about the targets may reach indirectly. Weight, region
    and evidence come from its best path, paths[0]: a direct weighted link first, then a
    region-level weighted one, then the shortest and best evidenced, then by first hop in
    FIRST_HOPS order (taking part in FAST before owning a share of NETS)."""

    subject: str
    name: str
    weight: float | None
    region: str | None
    evidence: Evidence
    paths: list[ImpactPath]


def _rank(p: ImpactPath) -> tuple[bool, bool, float, int, int, int]:
    first = p.relationships[0].type
    return (
        p.weight is None,
        p.region is not None,
        -(p.weight or 0.0),
        len(p.relationships),
        EVIDENCE_GRADES.index(p.evidence),
        FIRST_HOPS.index(first) if first in FIRST_HOPS else 0,
    )


def candidates(conn: sqlite3.Connection, target_ids: list[str]) -> list[Candidate]:
    """paths_to over every target, less the targets themselves, grouped per subject; the largest
    weight first, then subjects without one by id. One call per development is cheap: a few
    indexed queries per target."""
    by_subject: dict[str, list[ImpactPath]] = {}
    for target in dict.fromkeys(target_ids):
        for p in paths_to(conn, target):
            if p.subject not in target_ids:
                by_subject.setdefault(p.subject, []).append(p)
    found: list[Candidate] = []
    for subject, paths in by_subject.items():
        paths.sort(key=_rank)
        best = paths[0]
        found.append(
            Candidate(
                subject=subject,
                name=best.nodes[0].name,
                weight=best.weight,
                region=best.region,
                evidence=best.evidence,
                paths=paths,
            )
        )
    return sorted(found, key=lambda c: (c.weight is None, -(c.weight or 0.0), c.subject))


class SharedEndpoint(_Model):
    """A node linked to both subjects, with each one's links to it (either direction)."""

    node: Node
    a_links: list[Relationship]
    b_links: list[Relationship]


def shared(conn: sqlite3.Connection, a: str, b: str) -> list[SharedEndpoint]:
    """The subjects and endpoints that both `a` and `b` link to, for GET /shared, by id."""

    def links(subject: str) -> dict[str, list[Relationship]]:
        rows = conn.execute(
            "SELECT data FROM relationships WHERE from_id = ? OR to_id = ? ORDER BY id",
            (subject, subject),
        ).fetchall()
        out: dict[str, list[Relationship]] = {}
        for row in rows:
            r = Relationship.model_validate_json(row["data"])
            out.setdefault(r.to if r.from_ == subject else r.from_, []).append(r)
        return out

    a_links, b_links = links(a), links(b)
    common = sorted((a_links.keys() & b_links.keys()) - {a, b})
    nodes = _nodes(conn, set(common))
    return [SharedEndpoint(node=nodes[i], a_links=a_links[i], b_links=b_links[i]) for i in common]
