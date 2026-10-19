"""Subjects as the pipeline sees them: one flat list with descriptions for Jev and Claude.

Topics and entities are monitored: screening asks about them, developments are tagged to them and
priority scores them. Groups are peer sets of entities (sidebar headings, dashboards, peer
comparison, search queries); nothing is screened for, tagged to or scored for a group
(phase1-decisions.md, S3)."""

from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

from intelmonitor.seed import EntityKind, QuestionDef, SubjectType, load_questions, load_subjects

_KIND_LABEL: dict[EntityKind, str] = {
    "bank": "bank",
    "central_bank": "central bank and financial regulator",
    "regulator": "financial regulator",
    "agency": "government agency",
    "market_infrastructure": "exchange and market infrastructure operator",
    "payment_system": "payment system",
    "tech_provider": "technology and service provider to financial institutions",
    "asset_manager": "asset manager",
    "insurer": "insurer",
    "stablecoin_issuer": "stablecoin issuer",
    "digital_asset_firm": (
        "crypto exchange, broker or custodian (digital payment token service provider)"
    ),
    "country": "country or territory",
    "sector": "sector",
}


@dataclass(frozen=True)
class Subject:
    id: str
    name: str
    type: SubjectType
    kind: EntityKind | None
    description: str  # what counts as being about this subject; groups are never asked about
    members: tuple[str, ...]  # entity ids, for groups


@lru_cache
def all_subjects() -> dict[str, Subject]:
    seed = load_subjects()
    names = {e.id: e.name for e in seed.entities}
    subjects: dict[str, Subject] = {}
    for t in seed.topics:
        subjects[t.id] = Subject(t.id, t.name, "topic", None, f"the topic {t.name}: {t.covers}", ())
    for g in seed.groups:
        members = ", ".join(names[m] for m in g.members)
        subjects[g.id] = Subject(
            g.id,
            g.name,
            "group",
            None,
            f"the group {g.name} ({members})",
            tuple(g.members),
        )
    for e in seed.entities:
        aliases = f", also {', '.join(e.aliases)}" if e.aliases else ""
        label = _KIND_LABEL[e.kind]
        # Countries and sectors are news scopes rather than organisations, so they say what
        # belongs to them.
        if e.kind == "country":
            about = (
                f"the {label} {e.name}{aliases}: its economy, markets (such as property, credit "
                "and currency), financial system, economic and financial policy, and political or "
                "security events with financial effects (not merely a company based there)"
            )
        elif e.kind == "sector":
            about = (
                f"the {label} {e.name}{aliases}, in any country: its market, prices, activity, "
                "defaults and financing, and policy aimed at it (not merely one company's "
                "routine news)"
            )
        else:
            about = f"{e.name}{aliases}, the {label}"
        if e.covers:
            # Country and sector descriptions already carry a colon.
            about += f"; {e.covers}" if e.kind in ("country", "sector") else f": {e.covers}"
        subjects[e.id] = Subject(e.id, e.name, "entity", e.kind, about, ())
    return subjects


@lru_cache
def monitored_subjects() -> dict[str, Subject]:
    """Topics and entities, in seed order: what screening asks about and developments carry."""
    return {i: s for i, s in all_subjects().items() if s.type != "group"}


def resolve_groups(subject_ids: Iterable[str]) -> list[str]:
    """Monitored subject ids for some subject ids, in order without repeats: a group stands for
    its members, and ids no longer in the seed drop out."""
    subjects = all_subjects()
    out: dict[str, None] = {}
    for i in subject_ids:
        if (s := subjects.get(i)) is not None:
            out.update(dict.fromkeys(s.members if s.type == "group" else (i,)))
    return list(out)


def questions_for(subject: Subject) -> list[QuestionDef]:
    """Built-in standing questions that apply to a subject, in seed order."""
    out: list[QuestionDef] = []
    for qs in load_questions().sets:
        a = qs.applies_to
        if a.type != subject.type:
            continue
        if a.subject is not None and a.subject != subject.id:
            continue
        if a.kind is not None and a.kind != subject.kind:
            continue
        out += qs.questions
    return out
