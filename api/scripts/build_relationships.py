"""Build api/seed/relationships.yaml from the collected relationship files.

Reads api/seed/collected/bank-exposures.yaml, tech-dependencies.yaml, entity-links.yaml and
ftig-links.yaml (structural links, dependencies and exposures of the digital asset firms), puts
every link in one schema, decides subject or endpoint from api/seed/subjects.yaml, and prints a
build report. The output is deterministic: a second run produces no diff. Rerun after any edit to
the collected files or to the subject seed.

Usage (from api/): uv run python scripts/build_relationships.py
"""

import sys
from collections import Counter
from datetime import date
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from intelmonitor.config import SEED_DIR
from intelmonitor.relationships import (
    LOAN_MEASURES,
    REL_TYPES,
    RELATIONSHIPS_PATH,
    Dimension,
    Endpoint,
    EndpointKind,
    Evidence,
    Figure,
    FigureMeasure,
    FigureUnit,
    HeadlineMeasure,
    HeadlineUnit,
    Relationship,
    RelType,
    Service,
)
from intelmonitor.seed import load_subjects

COLLECTED = SEED_DIR / "collected"
OUT = RELATIONSHIPS_PATH
# The bank, tech and entity-link files were checked against their sources on this date, the FTIG
# file on the second.
LAST_CONFIRMED = date(2026, 10, 7)
FTIG_CONFIRMED = date(2026, 10, 19)

# Ids the collected files spell differently from the subject seed.
RENAME = {
    "china": "mainland-china",
    "mainland-china-offshore": "mainland-china",
    "xfers": "straitsx",  # Xfers Pte. Ltd. trades as StraitsX
}
# Exposure buckets that never become relationship targets, with the reason.
NOT_TARGETS = {
    "us-dollar": "currency bucket, not a place",
    "rest-of-world": "residual bucket",
    "ccyb-others": "residual bucket",
    "other-asia-pacific": "residual bucket",
    "other-industries": "residual bucket",
}
# Regions a bank discloses loans for instead of countries, and the places each one covers.
REGION_MEMBERS = {
    "greater-china": ["hong-kong", "mainland-china", "taiwan", "macau"],
    "rest-of-greater-china": ["mainland-china", "taiwan", "macau"],
    "south-and-southeast-asia": ["india", "indonesia", "malaysia", "thailand", "vietnam"],
}
# Endpoints no collected file declares (or declares with the wrong kind). Used only when the id
# is not a subject, so parking a subject such as Maybank lands it here.
EXTRA_ENDPOINTS: dict[str, tuple[str, EndpointKind]] = {
    "bangkok-bank": ("Bangkok Bank", "bank"),
    "bank-of-china": ("Bank of China Singapore", "bank"),
    "cimb": ("CIMB Bank", "bank"),
    "citibank": ("Citibank", "bank"),
    "great-eastern": ("Great Eastern", "insurer"),
    "gxs-bank": ("GXS Bank", "bank"),
    "income-insurance": ("Income Insurance", "insurer"),
    "maybank": ("Maybank", "bank"),
    "nasdaq": ("Nasdaq", "tech_provider"),
    "temenos": ("Temenos", "tech_provider"),
    "trust-bank": ("Trust Bank", "bank"),
    "egiro": ("eGIRO", "payment_system"),
}


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Market(Row):
    id: str
    name: str
    labels: dict[str, list[str]]


class ExposureRow(Row):
    bank: str
    dimension: Dimension
    measure: Literal["gross_customer_loans", "npl", "npl_ratio", "npa_coverage", "rwa"]
    segment: str
    market: str
    value: float
    unit: FigureUnit
    share_of_total: float | None
    period: date
    source_url: str
    source_title: str
    page: int | None
    quote: str
    note: str | None = None


class Gap(Row):
    bank: str
    item: str
    detail: str


class ExposuresFile(Row):
    markets: list[Market]
    gaps: list[Gap]
    exposures: list[ExposureRow]


class NewEntity(Row):
    id: str
    name: str
    kind: str
    aliases: list[str]
    country: str | None = None


class TechRow(Row):
    from_: str = Field(alias="from")
    to: str
    type: Literal["depends_on", "participates_in", "owns", "operates_in"]
    detail: str
    service: Service
    evidence: Evidence
    source_url: str | None
    source_title: str | None
    published: date | None
    quote: str | None
    as_of: date | None = None  # for an undated source: the date it was read


class TechFile(Row):
    relationships: list[TechRow]
    incidents: list[dict[str, object]]  # evidence for links above, not links themselves
    new_entities: list[NewEntity]


class LinkRow(Row):
    from_: str = Field(alias="from")
    to: str
    type: Literal[
        "owns",
        "subsidiary_of",
        "operates_in",
        "shareholder_of",
        "member_of",
        "partner_of",
        "listed_on",
        "supervised_by",
    ]
    share: float | None
    detail: str
    evidence: Evidence
    as_of: date | None
    source_url: str
    source_title: str
    quote: str


class GroupRow(Row):
    id: str
    name: str
    kind: str
    members: list[str]
    detail: str
    source_url: str
    quote: str


class LinksFile(Row):
    relationships: list[LinkRow]
    groups: list[GroupRow]
    new_entities: list[NewEntity]


# Exposure measures as the FTIG file names them.
FirmMeasure = Literal[
    "fair_value",
    "reserve_assets",
    "deposits",
    "repo_principal",
    "reserve_income",
    "stablecoin_revenue",
    "transaction_revenue",
    "revenue_by_geography",
    "share_of_total_revenue",
    "distribution_costs",
    "token_supply_share",
    "assets_on_platform",
    "stablecoin_holdings",
    "annualised_card_gtv",
    "customer_transaction_volume",
    "rate_sensitivity",
]


class FirmExposureRow(Row):
    """One reported figure for a non-bank entity: a reserve asset, a counterparty, a revenue
    line or a concentration."""

    entity: str
    dimension: Dimension
    measure: FirmMeasure
    segment: str
    target: str
    value: float
    unit: Literal["USD m", "USD", "SGD", "XSGD", "XUSD", "USDC", "USDT", "%"]
    share_of_total: float | None
    period: date
    source_url: str
    source_title: str
    page: int | None
    quote: str
    note: str | None = None


class FtigFile(Row):
    relationships: list[LinkRow]
    depends_on_participates: list[TechRow]
    exposures: list[FirmExposureRow]
    groups: list[GroupRow]
    new_entities: list[NewEntity]


# Output. Keys at their default (null, false, empty list) are left out of the YAML.


def rel_id(src: str, type_: RelType, dst: str) -> str:
    return f"{src}:{type_}:{dst}"


# Collected entity kinds that differ from the endpoint kinds.
KIND_ALIASES: dict[str, EndpointKind] = {
    "central-bank": "central_bank",
    "exchange": "market_infrastructure",
    "consortium": "group",
    "platform": "group",
    "taskforce": "group",
    "index": "group",
}


def endpoint_kind(kind: str) -> EndpointKind:
    if kind in KIND_ALIASES:
        return KIND_ALIASES[kind]
    kinds: tuple[EndpointKind, ...] = EndpointKind.__args__
    assert kind in kinds, f"unknown entity kind {kind}"
    return kind


class Build:
    """Relationships, endpoint declarations and dropped rows, collected file by file."""

    def __init__(self, subjects: dict[str, str]) -> None:
        self.subjects = subjects  # entity subject id -> name
        self.rels: dict[str, Relationship] = {}
        self.declared: dict[str, Endpoint] = {}  # first declaration wins
        self.dropped: list[tuple[str, str]] = []  # (row, reason)
        self.merged: list[str] = []  # ids that took a second row from the same source

    def drop(self, row: str, reason: str) -> None:
        self.dropped.append((row, reason))

    def declare(self, endpoint: Endpoint) -> None:
        self.declared.setdefault(endpoint.id, endpoint)

    def add(self, rel: Relationship) -> None:
        """Add a relationship; a second row for the same link from the same source is merged
        into the first (details joined, quotes joined with " | "), any other repeat dropped."""
        row = f"{rel.from_} {rel.type} {rel.to}"
        if rel.from_ == rel.to:
            self.drop(row, "links an entity to itself")
            return
        first = self.rels.get(rel.id)
        if first is None:
            self.rels[rel.id] = rel
        elif first.source_url == rel.source_url and first.quote and rel.quote:
            self.merged.append(rel.id)
            self.rels[rel.id] = first.model_copy(
                update={
                    "detail": f"{first.detail}; {rel.detail}",
                    "quote": f"{first.quote} | {rel.quote}",
                }
            )
        else:
            self.drop(row, "repeats a link already taken from another source")


FIGURE_ORDER = (
    "gross_customer_loans",
    "loans_by_currency",
    "rwa",
    "npl",
    "npl_ratio",
    "npa_coverage",
)


def measure_of(row: ExposureRow) -> FigureMeasure:
    if row.measure == "gross_customer_loans" and row.dimension == "currency":
        return "loans_by_currency"
    return row.measure


def sgd_m(row: ExposureRow) -> float:
    return {"SGD m": 1.0, "SGD b": 1000.0}[row.unit] * row.value


def money(value: float, unit: str) -> str:
    if unit.startswith("SGD "):
        return f"S${value:,.0f}{unit[4:]}"
    return f"{value:g}%"


def figure(row: ExposureRow) -> Figure:
    return Figure(
        measure=measure_of(row),
        dimension=row.dimension,
        segment=row.segment,
        value=row.value,
        unit=row.unit,
        share=row.share_of_total,
        period=row.period,
        chart_reading=row.note is not None and "chart" in row.note.lower(),
        source_url=row.source_url,
        source_title=row.source_title,
        page=row.page,
        quote=row.quote,
        note=row.note,
    )


def build_exposures(build: Build, data: ExposuresFile) -> None:
    """One exposed_to relationship per bank and target. The headline figure is the bank's gross
    customer loans by geography or industry (or a named breakdown of a region), weighted by its
    total gross customer loans; without one, loans by currency, then Pillar 3 RWA, with no
    weight. Every other figure for the pair rides along in `figures`."""
    totals: dict[str, float] = {}
    for bank in sorted({r.bank for r in data.exposures}):
        loans = [
            r for r in data.exposures if r.bank == bank and r.measure == "gross_customer_loans"
        ]
        geo = sum(sgd_m(r) for r in loans if r.dimension == "geography")
        industry = sum(sgd_m(r) for r in loans if r.dimension == "industry")
        assert abs(geo - industry) < 1, f"{bank}: loans by geography and industry disagree"
        totals[bank] = geo
    industries = {r.market for r in data.exposures if r.dimension == "industry"}
    for m in data.markets:
        id_ = RENAME.get(m.id, m.id)
        if m.id in NOT_TARGETS or id_ != m.id:
            continue
        if id_ in REGION_MEMBERS:
            members = REGION_MEMBERS[id_]
            build.declare(
                Endpoint(id=id_, name=m.name.split(" (")[0], kind="region", members=members)
            )
        else:
            build.declare(
                Endpoint(id=id_, name=m.name, kind="sector" if id_ in industries else "country")
            )
    pairs: dict[tuple[str, str], list[ExposureRow]] = {}
    for row in data.exposures:
        label = f"{row.bank} {row.measure} {row.dimension} {row.market} ({row.segment})"
        if row.market in NOT_TARGETS:
            build.drop(label, NOT_TARGETS[row.market])
        else:
            pairs.setdefault((row.bank, RENAME.get(row.market, row.market)), []).append(row)
    for (bank, target), rows in sorted(pairs.items()):
        figures = sorted(
            (figure(r) for r in rows), key=lambda f: (FIGURE_ORDER.index(f.measure), f.dimension)
        )
        loans = [f for f in figures if f.measure == "gross_customer_loans"]
        main = [f for f in loans if f.dimension != "specific"] or loans
        main = main or [f for f in figures if f.measure in ("loans_by_currency", "rwa")][:1]
        if not main:
            for r in rows:
                build.drop(
                    f"{bank} {r.measure} {r.dimension} {r.market} ({r.segment})",
                    "no loan, currency or RWA figure for this bank and target",
                )
            continue
        head = main[0]
        measure, unit = head.measure, head.unit
        assert measure in ("gross_customer_loans", "loans_by_currency", "rwa")
        assert unit in ("SGD m", "SGD b")
        value = sum(f.value for f in main)
        assert all(f.unit == head.unit and f.source_url == head.source_url for f in main)
        weight = None
        name = build.subjects.get(bank, bank.upper())
        segment = " and ".join(f.segment for f in main)
        if head.measure == "gross_customer_loans":
            weight = round(value * (1000 if head.unit == "SGD b" else 1) / totals[bank], 4)
            detail = (
                f"{name} gross customer loans, {segment}: {money(value, head.unit)}, "
                f"{weight:.1%} of its total at {head.period:%d %b %Y}."
            )
        elif head.measure == "loans_by_currency":
            detail = (
                f"{name} loans in {segment}: {money(value, head.unit)} at {head.period:%d %b %Y}. "
                "Loans by currency stand in for a country figure the bank does not disclose."
            )
        else:
            detail = (
                f"{name} Pillar 3 risk-weighted assets for private sector credit in {segment}: "
                f"{money(value, head.unit)} at {head.period:%d %b %Y}. "
                "The bank discloses no loan figure for this market."
            )
        notes = sorted({f.note for f in main if f.note})
        build.add(
            Relationship(
                id=rel_id(bank, "exposed_to", target),
                from_=bank,
                to=target,
                type="exposed_to",
                weight=weight,
                measure=measure,
                value=value,
                unit=unit,
                evidence="public",
                chart_reading=any(f.chart_reading for f in main),
                as_of=head.period,
                last_confirmed=LAST_CONFIRMED,
                source_url=head.source_url,
                source_title=head.source_title,
                page=head.page,
                quote=" | ".join(f.quote for f in main),
                detail=" ".join([detail, *notes]),
                figures=[f for f in figures if f not in main],
            )
        )


def build_tech(build: Build, data: TechFile, confirmed: date = LAST_CONFIRMED) -> None:
    for e in data.new_entities:
        build.declare(Endpoint(id=RENAME.get(e.id, e.id), name=e.name, kind=endpoint_kind(e.kind)))
    for r in data.relationships:
        src, dst = RENAME.get(r.from_, r.from_), RENAME.get(r.to, r.to)
        build.add(
            Relationship(
                id=rel_id(src, r.type, dst),
                from_=src,
                to=dst,
                type=r.type,
                evidence=r.evidence,
                as_of=r.published or r.as_of,
                last_confirmed=confirmed,
                source_url=r.source_url,
                source_title=r.source_title,
                quote=r.quote,
                detail=r.detail,
                service=r.service if r.type in ("depends_on", "participates_in") else None,
            )
        )


# Titles for group sources the collected file gives only as a URL, taken from the URL itself.
GROUP_SOURCE_TITLES = {
    "mas-abs-act": "MAS and ABS establish taskforce to strengthen cyber and technology resilience",
    "cosmic": "MAS launches COSMIC platform",
    "project-guardian": "Annex A: list of participants in Project Guardian industry group (MAS)",
    "global-layer-one": (
        "MAS expands industry collaboration to scale asset tokenisation for financial services"
    ),
    "project-orchid": "MAS report on potential uses of a purpose bound digital Singapore dollar",
    "nexus-global-payments": "Bank of Thailand news, 3 April 2025",
    "sti": "FTSE Russell, Straits Times Index factsheet",
    "bloom": "MAS Launches BLOOM Initiative to Extend Settlement Capabilities",
    "okxice": "OKX joint venture files with SEC to launch tokenized trading platform (Reuters)",
    "global-dollar-network": "OKX joins Global Dollar Network (Global Dollar Network newsroom)",
}
# Group members whose membership only a secondary source reports.
REPORTED_MEMBERS = {("nexus-global-payments", "bank-indonesia")}


def build_links(build: Build, data: LinksFile, confirmed: date = LAST_CONFIRMED) -> None:
    group_ids = {g.id for g in data.groups}
    for e in data.new_entities:
        kind = "group" if e.id in group_ids else endpoint_kind(e.kind)
        build.declare(Endpoint(id=RENAME.get(e.id, e.id), name=e.name, kind=kind))
    titles = {r.source_url: r.source_title for r in reversed(data.relationships)}
    for r in data.relationships:
        src, dst = RENAME.get(r.from_, r.from_), RENAME.get(r.to, r.to)
        if r.type == "partner_of":
            build.drop(f"{src} partner_of {dst}", "partner_of is not a relationship type")
            continue
        build.add(
            Relationship(
                id=rel_id(src, r.type, dst),
                from_=src,
                to=dst,
                type=r.type,
                weight=r.share if r.type in ("owns", "shareholder_of") else None,
                evidence=r.evidence,
                as_of=r.as_of,
                last_confirmed=confirmed,
                source_url=r.source_url,
                source_title=r.source_title,
                quote=r.quote,
                detail=r.detail,
            )
        )
    for g in data.groups:
        build.declared[g.id] = Endpoint(id=g.id, name=g.name, kind="group", detail=g.detail)
        title = titles.get(g.source_url) or GROUP_SOURCE_TITLES[g.id]
        for member in g.members:
            src = RENAME.get(member, member)
            build.add(
                Relationship(
                    id=rel_id(src, "member_of", g.id),
                    from_=src,
                    to=g.id,
                    type="member_of",
                    evidence="reported" if (g.id, member) in REPORTED_MEMBERS else "public",
                    last_confirmed=confirmed,
                    source_url=g.source_url,
                    source_title=title,
                    quote=g.quote,
                    detail=g.detail,
                )
            )


# FTIG exposure measures in the store's terms: what the headline share is a share of.
FIRM_MEASURES: dict[FirmMeasure, HeadlineMeasure] = {
    "fair_value": "reserve_assets",
    "reserve_assets": "reserve_assets",
    "deposits": "reserve_assets",
    "repo_principal": "repo_principal",
    "reserve_income": "revenue",
    "stablecoin_revenue": "revenue",
    "transaction_revenue": "revenue",
    "revenue_by_geography": "revenue",
    "share_of_total_revenue": "revenue",
    "distribution_costs": "distribution_costs",
    "token_supply_share": "token_supply",
    "assets_on_platform": "assets_on_platform",
    "stablecoin_holdings": "stablecoin_holdings",
    "annualised_card_gtv": "card_volume",
}
# Measures with no store equivalent, and (entity, target) pairs that no longer hold, with why.
DROPPED_MEASURES: dict[FirmMeasure, str] = {
    "customer_transaction_volume": "past transaction volume, not a standing share or holding",
    "rate_sensitivity": "a rate sensitivity, not a share of a total or a holding",
}
NOT_STANDING = {
    ("circle", "silicon-valley-bank"): "historical: USDC reserves at SVB when it failed in 2023",
}
# Collected units as stored: raw amounts in millions, tokens counted in millions.
FIRM_UNITS: dict[str, tuple[float, Literal[HeadlineUnit, "%"]]] = {
    "USD m": (1, "USD m"),
    "USD": (1e6, "USD m"),
    "SGD": (1e6, "SGD m"),
    "XSGD": (1e6, "m tokens"),
    "XUSD": (1e6, "m tokens"),
    "USDC": (1e6, "m tokens"),
    "USDT": (1e6, "m tokens"),
    "%": (1, "%"),
}


def amount(value: float, unit: HeadlineUnit) -> str:
    """S$11.6m, US$62,317m, 1,875.4m tokens or 26%: one decimal under 100."""
    n = f"{value:,.{0 if value >= 100 else 1}f}"
    if unit.startswith("SGD "):
        return f"S${n}{unit[4:]}"
    if unit.startswith("USD "):
        return f"US${n}{unit[4:]}"
    return f"{n}m tokens"


def firm_figure(row: FirmExposureRow) -> Figure:
    divisor, unit = FIRM_UNITS[row.unit]
    return Figure(
        measure=FIRM_MEASURES[row.measure],
        dimension=row.dimension,
        segment=row.segment,
        value=row.value / divisor,
        unit=unit,
        share=row.share_of_total,
        period=row.period,
        source_url=row.source_url,
        source_title=row.source_title,
        page=row.page,
        quote=row.quote,
        note=row.note,
    )


def build_firm_exposures(build: Build, rows: list[FirmExposureRow]) -> None:
    """One exposed_to relationship per entity and target. The headline is the first row with a
    share (the collected file lists the one to lead with first), else the first row; its share is
    the weight. Every other row for the pair rides along in `figures`."""
    pairs: dict[tuple[str, str], list[FirmExposureRow]] = {}
    for row in rows:
        label = f"{row.entity} {row.measure} {row.target} ({row.segment})"
        if row.measure in DROPPED_MEASURES:
            build.drop(label, DROPPED_MEASURES[row.measure])
        elif (row.entity, row.target) in NOT_STANDING:
            build.drop(label, NOT_STANDING[(row.entity, row.target)])
        else:
            pairs.setdefault((row.entity, RENAME.get(row.target, row.target)), []).append(row)
    for (entity, target), group in pairs.items():
        head = next((r for r in group if r.share_of_total is not None), group[0])
        divisor, unit = FIRM_UNITS[head.unit]
        assert unit != "%", f"{entity} {target}: a percentage cannot lead"
        value = head.value / divisor
        share = head.share_of_total
        detail = (
            f"{build.subjects.get(entity, entity)}, {head.segment}: {amount(value, unit)}"
            f"{f', {share:.1%} of the total' if share is not None else ''} "
            f"at {head.period:%d %b %Y}."
        )
        build.add(
            Relationship(
                id=rel_id(entity, "exposed_to", target),
                from_=entity,
                to=target,
                type="exposed_to",
                weight=share,
                measure=FIRM_MEASURES[head.measure],
                value=value,
                unit=unit,
                evidence="public",
                as_of=head.period,
                last_confirmed=FTIG_CONFIRMED,
                source_url=head.source_url,
                source_title=head.source_title,
                page=head.page,
                quote=head.quote,
                detail=" ".join(filter(None, [detail, head.note])),
                figures=[firm_figure(r) for r in group if r is not head],
            )
        )


def endpoints_for(build: Build) -> tuple[list[Endpoint], list[str]]:
    """The endpoint entry for every id in use that is not an entity subject, and the ids that
    have neither (must be none)."""
    used = {r.from_ for r in build.rels.values()} | {r.to for r in build.rels.values()}
    for e in build.declared.values():
        if e.id in used:
            used.update(e.members)
    ids = sorted(used - build.subjects.keys())
    return [build.declared[i] for i in ids if i in build.declared], [
        i for i in ids if i not in build.declared
    ]


def unsourced(rels: list[Relationship]) -> list[str]:
    """Relationships missing a source URL, title or quote, unless graded assumed."""
    return [
        r.id
        for r in rels
        if r.evidence != "assumed" and not (r.source_url and r.source_title and r.quote)
    ]


HEADER = """\
# Generated by api/scripts/build_relationships.py from api/seed/collected/. Do not edit by hand:
# edit the collected files or the script, then rerun it from api/.
#
# relationships[]: one per (from, type, to); id is "from:type:to".
#   type          exposed_to | depends_on | participates_in | owns | subsidiary_of | operates_in
#                 | supervised_by | shareholder_of | member_of | listed_on
#   weight        exposed_to: the headline figure's share of its total: a bank's gross customer
#                 loans (null when the headline is loans by currency or Pillar 3 RWA), an
#                 issuer's reserves or reserve fund, a firm's revenue, costs, token supply or
#                 customer assets (null for holdings and card volume); owns, shareholder_of:
#                 ownership share; else null
#   measure, value, unit   exposed_to only: the headline figure (gross_customer_loans,
#                 loans_by_currency or rwa for banks; reserve_assets, repo_principal, revenue,
#                 distribution_costs, token_supply, assets_on_platform, stablecoin_holdings or
#                 card_volume for other entities), in SGD m, SGD b, USD m or m tokens
#   evidence      public | reported | assumed; chart_reading true where the figure was read off
#                 a chart
#   as_of         date the link is known to hold at: the period end for exposures, the source's
#                 publication date for tech dependencies, its as-of date for group structure;
#                 last_confirmed: date it was checked
#   source_url, source_title, page, quote (verbatim; pieces joined with " | "), detail
#   service       depends_on and participates_in: cloud, data_centre, payments, custody,
#                 blockchain, distribution and the like
#   figures[]     exposed_to only: further figures for the same entity and target (loans by
#                 currency, Pillar 3 RWA, NPLs; other reserve, revenue or counterparty figures),
#                 each with its own source and quote
#   Keys left out are null, false or empty.
# endpoints[]: every id above that is not an entity subject in api/seed/subjects.yaml, with name
#   and kind; regions list the places they cover in members.
"""


class NoAliasDumper(yaml.SafeDumper):
    """Writes repeated values (such as the shared last_confirmed date) out in full."""

    def ignore_aliases(self, data: object) -> bool:
        return True


def write(rels: list[Relationship], endpoints: list[Endpoint]) -> None:
    order = sorted(rels, key=lambda r: (REL_TYPES.index(r.type), r.from_, r.to))
    doc = {
        "relationships": [r.model_dump(by_alias=True, exclude_defaults=True) for r in order],
        "endpoints": [e.model_dump(exclude_defaults=True) for e in endpoints],
    }
    body = yaml.dump(doc, Dumper=NoAliasDumper, sort_keys=False, allow_unicode=True, width=100)
    OUT.write_text(HEADER + "\n" + body)


def report(build: Build, rels: list[Relationship], endpoints: list[Endpoint]) -> None:
    grades: tuple[Evidence, ...] = Evidence.__args__
    counts = Counter((r.type, r.evidence) for r in rels)
    print(f"\n{len(rels)} relationships")
    print(f"  {'type':16}{'all':>5}" + "".join(f"{g:>10}" for g in grades))
    for t in REL_TYPES:
        row = [counts[(t, g)] for g in grades]
        print(f"  {t:16}{sum(row):>5}" + "".join(f"{n:>10}" for n in row))
    exposures = [r for r in rels if r.type == "exposed_to"]
    measures = Counter(r.measure for r in exposures)
    firms = sum(n for m, n in measures.items() if m not in LOAN_MEASURES)
    print(
        f"  exposed_to headline: {measures['gross_customer_loans']} loans with a weight, "
        f"{measures['loans_by_currency']} loans by currency, {measures['rwa']} Pillar 3 RWA, "
        f"{firms} other entities' reserves, revenue and holdings; "
        f"{sum(len(r.figures) for r in exposures)} further figures; "
        f"chart readings: {sum(r.chart_reading for r in exposures)} headline, "
        f"{sum(f.chart_reading for r in exposures for f in r.figures)} further"
    )
    kinds = Counter(e.kind for e in endpoints)
    print(
        f"\n{len(endpoints)} endpoints: " + ", ".join(f"{k} {n}" for k, n in sorted(kinds.items()))
    )
    print(f"\nmerged a second row from the same source into: {', '.join(build.merged)}")
    print(f"\n{len(build.dropped)} collected rows dropped")
    by_reason: dict[str, list[str]] = {}
    for row, reason in build.dropped:
        by_reason.setdefault(reason, []).append(row)
    for reason, rows in sorted(by_reason.items()):
        print(f"  {reason} ({len(rows)}):")
        for row in rows:
            print(f"    {row}")


def read(name: str) -> object:
    return yaml.safe_load((COLLECTED / name).read_text())


def main() -> None:
    exposures = ExposuresFile.model_validate(read("bank-exposures.yaml"))
    tech = TechFile.model_validate(read("tech-dependencies.yaml"))
    links = LinksFile.model_validate(read("entity-links.yaml"))
    ftig = FtigFile.model_validate(read("ftig-links.yaml"))
    seed = load_subjects()
    build = Build({e.id: e.name for e in seed.entities})
    for id_, (name, kind) in EXTRA_ENDPOINTS.items():
        build.declare(Endpoint(id=id_, name=name, kind=kind))
    build_links(build, links)  # first, so its ownership shares win over tech's repeats
    build_tech(build, tech)
    build_exposures(build, exposures)
    ftig_links = LinksFile(
        relationships=ftig.relationships, groups=ftig.groups, new_entities=ftig.new_entities
    )
    build_links(build, ftig_links, FTIG_CONFIRMED)
    ftig_tech = TechFile(relationships=ftig.depends_on_participates, incidents=[], new_entities=[])
    build_tech(build, ftig_tech, FTIG_CONFIRMED)
    build_firm_exposures(build, ftig.exposures)
    rels = list(build.rels.values())
    endpoints, unknown = endpoints_for(build)
    report(build, rels, endpoints)
    problems = [f"neither a subject nor an endpoint: {i}" for i in unknown]
    problems += [f"no source: {i}" for i in unsourced(rels)]
    if problems:
        print("\n".join(problems), "\nnot written", sep="\n")
        sys.exit(1)
    write(rels, endpoints)
    print(f"\nwrote {OUT}: no unknown ids")


if __name__ == "__main__":
    main()
