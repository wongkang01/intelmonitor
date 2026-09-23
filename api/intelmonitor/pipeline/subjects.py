"""Subjects as the pipeline sees them: one flat list with descriptions for Jev and Claude."""

from dataclasses import dataclass
from functools import lru_cache

from intelmonitor.seed import EntityKind, QuestionDef, SubjectType, load_questions, load_subjects

_KIND_LABEL: dict[EntityKind, str] = {
    "bank": "bank",
    "central_bank": "central bank and financial regulator",
    "stablecoin_issuer": "stablecoin issuer",
    "country": "country",
}


@dataclass(frozen=True)
class Subject:
    id: str
    name: str
    type: SubjectType
    kind: EntityKind | None
    description: str  # what counts as being about this subject
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
            f"the group {g.name} ({members}), as a group or through any of its members",
            tuple(g.members),
        )
    for e in seed.entities:
        aliases = f", also {', '.join(e.aliases)}" if e.aliases else ""
        if e.kind == "country":
            about = (
                f"the country {e.name}{aliases}: its government, politics, economy, security or "
                "financial system (not merely a company based there)"
            )
        else:
            about = f"{e.name}{aliases}, the {_KIND_LABEL[e.kind]}"
        subjects[e.id] = Subject(e.id, e.name, "entity", e.kind, about, ())
    return subjects


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
