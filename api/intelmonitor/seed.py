"""Typed loaders for api/seed/subjects.yaml and api/seed/questions.yaml."""

from functools import lru_cache
from typing import Literal, Self

import yaml
from pydantic import BaseModel, model_validator

from intelmonitor.config import SEED_DIR

EntityKind = Literal["bank", "central_bank", "stablecoin_issuer", "country"]
SubjectType = Literal["topic", "group", "entity"]
# Topic glyphs the web app draws from its icon library.
TopicIcon = Literal["landmark", "coins", "globe"]


class Topic(BaseModel):
    id: str
    name: str
    covers: str
    keywords: list[str]
    icon: TopicIcon | None = None


class Group(BaseModel):
    id: str
    name: str
    topics: list[str]
    members: list[str]


class Entity(BaseModel):
    id: str
    name: str
    kind: EntityKind
    aliases: list[str]
    domains: list[str]
    logo: str | None = None  # small icon served by the web app, e.g. /logos/ocbc.svg
    logo_full: str | None = None  # full logo for the monitor page, e.g. /logos/full/ocbc.svg


class SubjectsSeed(BaseModel):
    topics: list[Topic]
    groups: list[Group]
    entities: list[Entity]

    @model_validator(mode="after")
    def _check_links(self) -> Self:
        topic_ids = {t.id for t in self.topics}
        entity_ids = {e.id for e in self.entities}
        ids = [t.id for t in self.topics] + [g.id for g in self.groups] + list(entity_ids)
        if len(ids) != len(set(ids)):
            raise ValueError("subject ids must be unique")
        grouped: set[str] = set()
        for group in self.groups:
            if not group.topics or not set(group.topics) <= topic_ids:
                raise ValueError(f"group {group.id} must link to known topics")
            if not set(group.members) <= entity_ids:
                raise ValueError(f"group {group.id} has unknown members")
            grouped.update(group.members)
        if missing := entity_ids - grouped:
            raise ValueError(f"entities without a group: {sorted(missing)}")
        return self


class AppliesTo(BaseModel):
    type: SubjectType
    subject: str | None = None
    kind: EntityKind | None = None


class QuestionDef(BaseModel):
    id: str
    label: str
    question: str
    lookback_days: int


class QuestionSet(BaseModel):
    applies_to: AppliesTo
    questions: list[QuestionDef]


class QuestionsSeed(BaseModel):
    sets: list[QuestionSet]


@lru_cache
def load_subjects() -> SubjectsSeed:
    return SubjectsSeed.model_validate(yaml.safe_load((SEED_DIR / "subjects.yaml").read_text()))


@lru_cache
def load_questions() -> QuestionsSeed:
    return QuestionsSeed.model_validate(yaml.safe_load((SEED_DIR / "questions.yaml").read_text()))
