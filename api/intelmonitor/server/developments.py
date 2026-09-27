"""The developments list: a scope's developments filtered by facets, with each facet's counts.

Values within a facet match any of them; facets and the words filter combine. A facet's counts
cover the developments listed and apply every filter but its own, so they say what picking a
value would list."""

from collections import Counter
from collections.abc import Callable, Iterable
from datetime import date, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.screen import JURISDICTION_NAMES, Category, Jurisdiction
from intelmonitor.server.models import (
    ChangedDevelopment,
    Collection,
    DevelopmentFacets,
    DevelopmentList,
    FacetValue,
    SubjectId,
)
from intelmonitor.server.queries import COLLECTION_ORDER, Queries, change_counts

DATE_PRESETS = [7, 30, 90]
COLLECTION_LABELS: dict[Collection, str] = {"official": "Official", "dms": "DMS", "news": "News"}
JURISDICTION_CODES: dict[str, Jurisdiction] = {
    name: code for code, name in JURISDICTION_NAMES.items()
}

Facet = Literal["category", "materiality", "jurisdiction", "date", "source"]
ChangedFilter = Literal["review", "run"]


class DevelopmentQuery(BaseModel):
    """GET /developments query parameters: the scope, then filters that narrow it."""

    subject_id: list[SubjectId] = Field(
        default_factory=list[str], description="Subjects in scope; groups include their members"
    )
    dashboard_id: str | None = Field(default=None, description="Adds a dashboard's subjects")
    changed: ChangedFilter | None = Field(
        default=None,
        description="review: only What changed since the review; run: only those the latest "
        "run added or updated",
    )
    limit: int | None = Field(default=None, ge=1)
    category: list[Category] = Field(default_factory=list[Category])
    materiality: list[Annotated[int, Field(ge=0, le=4)]] = Field(
        default_factory=list[int], description="Materiality levels, 0 Trivial to 4 Critical"
    )
    jurisdiction: list[Jurisdiction] = Field(default_factory=list[Jurisdiction])
    days: int | None = Field(
        default=None, ge=1, description="Last published in the last this many days of the run"
    )
    source: list[Collection] = Field(default_factory=list[Collection])
    q: str | None = Field(default=None, description="Words that must all appear in the title")


Test = Callable[[ChangedDevelopment], bool]


def _tests(f: DevelopmentQuery, as_of: date) -> dict[Facet, Test]:
    """Each facet's filter as a test; a facet with nothing selected passes everything."""
    names = {JURISDICTION_NAMES[c] for c in f.jurisdiction}
    since = as_of - timedelta(days=f.days) if f.days else None
    return {
        "category": lambda d: not f.category or d.category in f.category,
        "materiality": lambda d: not f.materiality or d.materiality_level in f.materiality,
        "jurisdiction": lambda d: not names or not names.isdisjoint(d.jurisdictions),
        "date": lambda d: since is None or d.last_published > since,
        "source": lambda d: not f.source or not set(f.source).isdisjoint(d.collections),
    }


def _words(text: str | None) -> Test:
    words = (text or "").lower().split()
    return lambda d: all(w in d.title.lower() for w in words)


def _values[K: str](
    counts: Counter[K], selected: Iterable[K], label: Callable[[K], str]
) -> list[FacetValue]:
    """Values with matches, most first, plus selected ones without."""
    keys = [*counts, *(s for s in selected if s not in counts)]
    keys.sort(key=lambda k: (-counts[k], label(k)))
    return [FacetValue(value=k, label=label(k), count=counts[k]) for k in keys]


def _facets(
    devs: list[ChangedDevelopment], f: DevelopmentQuery, tests: dict[Facet, Test], as_of: date
) -> DevelopmentFacets:
    def base(facet: Facet) -> list[ChangedDevelopment]:
        others = [t for name, t in tests.items() if name != facet]
        return [d for d in devs if all(t(d) for t in others)]

    levels = Counter(str(d.materiality_level) for d in base("materiality"))
    sources = Counter(c for d in base("source") for c in d.collections)
    dated = base("date")
    presets = sorted({*DATE_PRESETS, f.days} if f.days else DATE_PRESETS)
    return DevelopmentFacets(
        category=_values(Counter(d.category for d in base("category")), f.category, str.capitalize),
        materiality=[
            FacetValue(value=str(lvl), label=MATERIALITY_LEVELS[lvl], count=levels[str(lvl)])
            for lvl in reversed(range(len(MATERIALITY_LEVELS)))
            if levels[str(lvl)] or lvl in f.materiality
        ],
        jurisdiction=_values(
            Counter[Jurisdiction](
                JURISDICTION_CODES[j] for d in base("jurisdiction") for j in d.jurisdictions
            ),
            f.jurisdiction,
            JURISDICTION_NAMES.__getitem__,
        ),
        date=[
            *(
                FacetValue(
                    value=str(n),
                    label=f"Last {n} days",
                    count=sum(d.last_published > as_of - timedelta(days=n) for d in dated),
                )
                for n in presets
            ),
            FacetValue(value="any", label="Any time", count=len(dated)),
        ],
        source=[
            FacetValue(value=c, label=COLLECTION_LABELS[c], count=sources[c])
            for c in COLLECTION_ORDER
            if sources[c] or c in f.source
        ],
    )


def development_list(
    q: Queries, subject_ids: list[str] | None, f: DevelopmentQuery
) -> DevelopmentList:
    """The developments of the subjects (every development when None) matching the filters."""
    changed = f.changed
    scope = q.scope_developments(subject_ids)
    words = _words(f.q)
    tests = _tests(f, q.run.as_of)
    worded = [d for d in scope if words(d)]
    matching = [d for d in worded if all(t(d) for t in tests.values())]

    def shown(d: ChangedDevelopment) -> bool:
        if changed == "review":
            return d.unreviewed
        if changed == "run":
            return q.development(d.id).change is not None
        return True

    return DevelopmentList(
        in_scope=len(scope),
        matching=len(matching),
        **change_counts(matching).model_dump(),
        developments=[d for d in matching if shown(d)][: f.limit],
        facets=_facets([d for d in worded if shown(d)], f, tests, q.run.as_of),
    )
