"""Typed loaders for api/seed/subjects.yaml, questions.yaml, series.yaml and detectors.yaml."""

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


# Detectors (api/seed/detectors.yaml): rules over series whose firings become developments
# (pipeline/detectors.py). Each detector applies to every series its pattern matches.

MaterialityName = Literal["trivial", "minor", "notable", "significant", "critical"]
DetectorCategory = Literal["market", "financial"]
MoveWindow = Literal["previous", "1w", "1m", "3m", "1y"]
MoveDirection = Literal["up", "down", "either"]
# Windows a series' frequency can answer: a weekly move on a monthly series says nothing.
_MOVE_WINDOWS: dict[Frequency, set[MoveWindow]] = {
    "daily": {"previous", "1w", "1m", "3m", "1y"},
    "monthly": {"previous", "1m", "3m", "1y"},
    "quarterly": {"previous", "3m", "1y"},
}


class LevelCondition(BaseModel):
    """A detector's `when`: the series' value, in its own unit, is `below` a level or `at_least`
    one. A rule for small coins and another for large ones split a series between them."""

    below: float | None = None
    at_least: float | None = None

    @model_validator(mode="after")
    def _one_level(self) -> Self:
        if (self.below is None) == (self.at_least is None):
            raise ValueError("when: give one of below or at_least")
        return self

    def holds(self, v: float) -> bool:
        if self.below is not None:
            return v < self.below
        assert self.at_least is not None  # the validator requires one of them
        return v >= self.at_least


class _Detector(BaseModel):
    id: str
    name: str  # what the rule watches for, as the evidence drawer shows it
    series: str  # pattern over series ids (fnmatch, `*` spans dots)
    category: DetectorCategory
    materiality: MaterialityName  # the level its developments get, instead of Jev's score
    # Evaluated only at points where the series' value meets this; the rest never fire.
    when: LevelCondition | None = None

    def applies_to(self, series_id: str) -> bool:
        return fnmatchcase(series_id, self.series)


class ThresholdDetector(_Detector):
    """The level crosses `above` from at or below it, or `below` from at or above it."""

    kind: Literal["threshold"]
    above: float | None = None
    below: float | None = None

    @model_validator(mode="after")
    def _one_level(self) -> Self:
        if (self.above is None) == (self.below is None):
            raise ValueError(f"detector {self.id}: give one of above or below")
        return self


class DeviationDetector(_Detector):
    """A distance-from-target series more than `beyond` either way for at least `for_hours`, from
    the spell's first point to the point that completes it."""

    kind: Literal["deviation"]
    beyond: float
    for_hours: int


class MoveDetector(_Detector):
    """The change over `window` (from the previous observation, or the last one on or before the
    window's start) beyond `beyond`, in points for series in % and percent otherwise, or beyond
    `sigmas` standard deviations of the series' earlier changes over the same window."""

    kind: Literal["move"]
    window: MoveWindow
    beyond: float | None = None
    sigmas: float | None = None
    direction: MoveDirection = "either"

    @model_validator(mode="after")
    def _one_size(self) -> Self:
        if (self.beyond is None) == (self.sigmas is None):
            raise ValueError(f"detector {self.id}: give one of beyond or sigmas")
        return self


class ReleaseDetector(_Detector):
    """A monthly or quarterly release whose change from the previous period is beyond `beyond`,
    in points for series in % and percent otherwise."""

    kind: Literal["release"]
    beyond: float
    direction: MoveDirection = "either"


DetectorDef = Annotated[
    ThresholdDetector | DeviationDetector | MoveDetector | ReleaseDetector,
    Field(discriminator="kind"),
]


class DetectorsSeed(BaseModel):
    detectors: list[DetectorDef]

    @model_validator(mode="after")
    def _check(self) -> Self:
        catalogue = load_series().series
        ids = [d.id for d in self.detectors]
        if len(ids) != len(set(ids)):
            raise ValueError("detector ids must be unique")
        for d in self.detectors:
            matched = [s for s in catalogue if d.applies_to(s.id)]
            if not matched:
                raise ValueError(f"detector {d.id}: {d.series} matches no series")
            for s in matched:
                if not s.subjects.primary:
                    raise ValueError(f"detector {d.id}: {s.id} has no primary subject to tag")
                if isinstance(d, DeviationDetector) and not isinstance(s.source, Deviation):
                    raise ValueError(f"detector {d.id}: {s.id} is not a deviation series")
                if isinstance(d, ReleaseDetector) and s.frequency == "daily":
                    raise ValueError(f"detector {d.id}: {s.id} is daily, not a release")
                if isinstance(d, MoveDetector) and d.window not in _MOVE_WINDOWS[s.frequency]:
                    raise ValueError(f"detector {d.id}: {d.window} is too short for {s.id}")
        return self

    def matching(self, series_ids: list[str]) -> list[tuple[DetectorDef, str]]:
        """Each detector with each series it applies to, in seed then catalogue order."""
        return [(d, i) for d in self.detectors for i in series_ids if d.applies_to(i)]


@lru_cache
def load_detectors() -> DetectorsSeed:
    return DetectorsSeed.model_validate(yaml.safe_load((SEED_DIR / "detectors.yaml").read_text()))
