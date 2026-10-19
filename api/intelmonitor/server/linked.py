"""The institutions linked to a country, sector, supplier or payment system, for that subject's
page (GET /subjects/{id}/linked): each with its routes from the relationship store and the
developments of the last 7 days that reach it through them."""

from intelmonitor.pipeline.impact import link_words
from intelmonitor.relationships import ImpactPath, linked_paths
from intelmonitor.server.impacts import (
    IMPACT_PERIOD_DAYS,
    display_names,
    relationship_link,
    subject_impacts,
)
from intelmonitor.server.models import LinkedInstitution, LinkedRoute
from intelmonitor.server.queries import Queries, subject, subject_ref

# The subject kinds whose page lists linked institutions.
LINKED_KINDS = {"country", "sector", "tech_provider", "payment_system"}
# What counts as an institution at the start of a route: financial institutions, including
# exchanges, depositories and clearing houses (a CrowdStrike outage reaches CDP), stablecoin
# issuers, crypto firms and licensed payment firms. Payment firms filed as tech providers in the
# store count when they take part in a payment system.
INSTITUTION_KINDS = {
    "bank",
    "insurer",
    "broker",
    "asset_manager",
    "market_infrastructure",
    "stablecoin_issuer",
    "digital_asset_firm",
    "payment_institution",
}


def _institution(p: ImpactPath) -> bool:
    kind = p.nodes[0].kind
    if kind in INSTITUTION_KINDS:
        return True
    return kind == "tech_provider" and p.relationships[0].type == "participates_in"


def _text(p: ImpactPath, region: str | None) -> str:
    words = ", which ".join(
        link_words(r, to) for r, to in zip(p.relationships, p.nodes[1:], strict=True)
    )
    if region:
        words += ", a figure for the whole region"
    elif p.relationships[-1].type == "exposed_to" and p.weight is None:
        words += ", share not disclosed"
    return words[0].upper() + words[1:]


def _route_rank(p: ImpactPath) -> tuple[bool, int, float]:
    return (p.region is not None, len(p.relationships), -(p.weight or 0.0))


def _share(paths: list[ImpactPath], *, region: bool) -> float:
    """The largest share of loans among the direct (or region-level) routes, 0 when none has one."""
    return max(
        (
            p.weight or 0.0
            for p in paths
            if len(p.relationships) == 1 and (p.region is not None) == region
        ),
        default=0.0,
    )


def _route(p: ImpactPath, display: dict[str, str]) -> LinkedRoute:
    region = display.get(p.region, p.region) if p.region else None
    return LinkedRoute(
        text=_text(p, region),
        region=region,
        links=[relationship_link(r, display) for r in p.relationships],
    )


def linked_institutions(q: Queries, subject_id: str) -> list[LinkedInstitution]:
    """Institutions linked directly or through a company they own, largest direct loan share
    first, then region-level shares, then links with no share; tracked ones first within each.
    A company owned by a listed institution sits under its owner, not on a row of its own."""
    if subject(subject_id).kind not in LINKED_KINDS:
        return []
    paths = [p for p in linked_paths(q.conn, subject_id) if _institution(p)]
    owned = {p.nodes[1].id for p in paths if len(p.relationships) == 2}
    by_id: dict[str, list[ImpactPath]] = {}
    for p in paths:
        if p.subject not in owned:
            by_id.setdefault(p.subject, []).append(p)
    display = display_names(q.conn)
    found: list[LinkedInstitution] = []
    for inst, routes in by_id.items():
        routes.sort(key=_route_rank)
        first = routes[0].nodes[0]
        ends = {subject_id, *(r.region for r in routes if r.region)}
        impacts = (
            [
                i
                for i in subject_impacts(q, inst, IMPACT_PERIOD_DAYS)
                if i.relationships and i.relationships[-1].to_id in ends
            ]
            if first.subject
            else []
        )
        found.append(
            LinkedInstitution(
                id=inst,
                name=first.name,
                kind=first.kind,
                subject=subject_ref(inst) if first.subject else None,
                region=_share(routes, region=False) == 0 and _share(routes, region=True) > 0,
                routes=[_route(r, display) for r in routes],
                impacts=impacts,
            )
        )

    def rank(i: LinkedInstitution) -> tuple[int, float, bool, str]:
        paths = by_id[i.id]
        direct, region = _share(paths, region=False), _share(paths, region=True)
        tier, share = (0, direct) if direct else (1, region) if region else (2, 0.0)
        return (tier, -share, i.subject is None, i.name)

    return sorted(found, key=rank)
