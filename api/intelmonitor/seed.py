"""Typed loaders for api/seed/subjects.yaml, questions.yaml and series.yaml."""

import re
from fnmatch import fnmatchcase
from functools import lru_cache
from typing import Annotated, Literal, Self

import yaml
from pydantic import BaseModel, Field, model_validator

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


# States a rule can fix: rules only escalate, so a calm answer stays the model's call.
RuleState = Literal["watch", "needs_attention"]


class DeviationRule(BaseModel):
    """Fixes the answer's state when a series is more than `beyond` away from zero, either way, for
    at least `for_hours` within the question's lookback: a peg series more than 0.5% off for 24
    hours. A spell runs from its first to its last observation in a row beyond the threshold."""

    kind: Literal["deviation"]
    series: str  # one of the question's series patterns
    beyond: float
    for_hours: int
    state: RuleState

    def applies_to(self, series_id: str) -> bool:
        return fnmatchcase(series_id, self.series)


class QuestionDef(BaseModel):
    id: str
    label: str
    question: str
    lookback_days: int
    # Patterns over series ids (fnmatch, `*` spans dots) choosing, among the series mapped to the
    # subject in series.yaml, those whose facts the answer gets and may cite.
    series: list[str] = []
    rules: list[DeviationRule] = []


class QuestionSet(BaseModel):
    applies_to: AppliesTo
    questions: list[QuestionDef]


class QuestionsSeed(BaseModel):
    sets: list[QuestionSet]

    @model_validator(mode="after")
    def _check(self) -> Self:
        ids = [s.id for s in load_series().series]
        for q in (q for qs in self.sets for q in qs.questions):
            for pattern in q.series:
                if not any(fnmatchcase(i, pattern) for i in ids):
                    raise ValueError(f"question {q.id}: {pattern} matches no series")
            for rule in q.rules:
                if rule.series not in q.series:
                    raise ValueError(f"question {q.id}: rule series {rule.series} is not linked")
        return self


@lru_cache
def load_subjects() -> SubjectsSeed:
    return SubjectsSeed.model_validate(yaml.safe_load((SEED_DIR / "subjects.yaml").read_text()))


@lru_cache
def load_questions() -> QuestionsSeed:
    return QuestionsSeed.model_validate(yaml.safe_load((SEED_DIR / "questions.yaml").read_text()))


def linked_series(q: QuestionDef, mapped: list[str]) -> list[str]:
    """The series among `mapped` (a subject's series) that match one of the question's patterns,
    in the order of `mapped`."""
    return [i for i in mapped if any(fnmatchcase(i, p) for p in q.series)]


# Series (api/seed/series.yaml). Each series has one source: a fetch from an external API, or an
# operation over series declared above it.

MasTable = Literal["i18", "i12a", "i5b", "fx"]
Frequency = Literal["daily", "monthly", "quarterly"]
BadDirection = Literal["up", "down", "none"]
SourceName = Literal["mas", "fred", "coingecko", "defillama", "derived"]


class MasSource(BaseModel):
    kind: Literal["mas"]
    table: MasTable
    field: str

    @property
    def per(self) -> int:
        """Units per quote: MAS quotes Asian currencies per 100 units (fields ending in _100)."""
        return 100 if self.field.endswith("_100") else 1


class FredSource(BaseModel):
    kind: Literal["fred"]
    series: str
    lag_days: int = 1  # days after the period a value is usually published


class CoinGeckoSource(BaseModel):
    kind: Literal["coingecko"]
    coin: str


class DefiLlamaSource(BaseModel):
    kind: Literal["defillama"]
    stablecoin: int | None = None  # None: all stablecoins
    chain: str | None = None


class Deviation(BaseModel):
    kind: Literal["deviation"]
    input: str
    target: float


class Product(BaseModel):
    kind: Literal["product"]
    inputs: tuple[str, str]


class Share(BaseModel):
    kind: Literal["share"]
    part: str
    total: str


FetchSource = MasSource | FredSource | CoinGeckoSource | DefiLlamaSource
DerivedSource = Deviation | Product | Share
SeriesSource = Annotated[FetchSource | DerivedSource, Field(discriminator="kind")]


def derived_inputs(source: DerivedSource) -> tuple[str, ...]:
    match source:
        case Deviation():
            return (source.input,)
        case Product():
            return source.inputs
        case Share():
            return (source.part, source.total)


class SeriesSubjects(BaseModel):
    primary: list[str] = []
    context: list[str] = []


class SeriesDef(BaseModel):
    id: str
    name: str
    unit: str
    frequency: Frequency
    decimals: int
    bad_direction: BadDirection
    source_url: str
    source: SeriesSource
    subjects: SeriesSubjects

    @property
    def source_name(self) -> SourceName:
        """The series table's source: the API it is fetched from, or derived."""
        return "derived" if isinstance(self.source, DerivedSource) else self.source.kind


_FX_ID = re.compile(r"fx\.sgd\.([a-z]{3})")


class SeriesSeed(BaseModel):
    series: list[SeriesDef]

    @model_validator(mode="after")
    def _check(self) -> Self:
        subjects = load_subjects()
        subject_ids = {s.id for s in [*subjects.topics, *subjects.groups, *subjects.entities]}
        seen: set[str] = set()
        for s in self.series:
            if s.id in seen:
                raise ValueError(f"series {s.id} is declared twice")
            if unknown := set(s.subjects.primary + s.subjects.context) - subject_ids:
                raise ValueError(f"series {s.id} has unknown subjects {sorted(unknown)}")
            if isinstance(s.source, DerivedSource):
                if missing := set(derived_inputs(s.source)) - seen:
                    raise ValueError(
                        f"series {s.id} uses {sorted(missing)} before they are declared"
                    )
            if m := _FX_ID.fullmatch(s.id):
                # One declared FX direction: SGD per one unit of the foreign currency.
                code = m.group(1)
                source = s.source
                if s.unit != f"SGD per {code.upper()}" or not (
                    isinstance(source, MasSource)
                    and source.table == "fx"
                    and source.field in (f"{code}_sgd", f"{code}_sgd_100")
                ):
                    raise ValueError(f"FX series {s.id} must be SGD per {code.upper()}")
            seen.add(s.id)
        return self


@lru_cache
def load_series() -> SeriesSeed:
    return SeriesSeed.model_validate(yaml.safe_load((SEED_DIR / "series.yaml").read_text()))
