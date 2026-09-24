"""Dashboard spec and widgets. One settings schema per widget type drives the gallery, manual
edits and the Generate agent; `widget_data` fills a widget from the latest run."""

from datetime import datetime, timedelta
from typing import Annotated, Literal, Self, get_args

from pydantic import BaseModel, Field, JsonValue, model_validator

from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.seed import SubjectType
from intelmonitor.server.models import (
    DevelopmentSummary,
    EntityId,
    QuestionAnswerView,
    RunRef,
    State,
    SubjectId,
    SubjectRef,
    UpcomingItem,
    WhatChanged,
)
from intelmonitor.server.queries import (
    MATERIAL_LEVEL,
    STATE_RANK,
    Queries,
    subject_links,
    subject_ref,
    worst_state,
)

Size = Literal["S", "M", "L"]
CUSTOM_PREFIX = "custom-"

# ---- settings, one model per widget type


class SinceSettings(BaseModel):
    subject_id: SubjectId | None = Field(
        default=None, description="Empty: every subject on the dashboard"
    )


class QuestionSettings(BaseModel):
    subject_id: SubjectId
    question_id: str = Field(description="A built-in question id, or a custom question id")

    @model_validator(mode="after")
    def _question_applies(self) -> Self:
        if self.question_id.startswith(CUSTOM_PREFIX):
            return self  # checked against the store when the widget is filled
        ids = {q.id for q in questions_for(all_subjects()[self.subject_id])}
        if self.question_id not in ids:
            raise ValueError(f"{self.question_id!r} is not a question for {self.subject_id!r}")
        return self


class SummarySettings(BaseModel):
    subject_id: SubjectId


class DevelopmentsSettings(BaseModel):
    subject_id: SubjectId | None = Field(
        default=None, description="Empty: every subject on the dashboard"
    )


class DirectionSettings(BaseModel):
    subject_id: SubjectId


class WatchlistSettings(BaseModel):
    entity_ids: list[EntityId] = Field(description="Entities in display order")


class UpcomingSettings(BaseModel):
    subject_id: SubjectId


# ---- widgets


class _Widget(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    order: int = Field(ge=0, description="Position in the dashboard; the layout packs by order")


class SinceWidget(_Widget):
    type: Literal["since"]
    size: Literal["M", "L"]
    settings: SinceSettings


class QuestionWidget(_Widget):
    type: Literal["question"]
    size: Literal["S", "M"]
    settings: QuestionSettings


class SummaryWidget(_Widget):
    type: Literal["summary"]
    size: Literal["M", "L"]
    settings: SummarySettings


class DevelopmentsWidget(_Widget):
    type: Literal["developments"]
    size: Literal["M", "L"]
    settings: DevelopmentsSettings


class DirectionWidget(_Widget):
    type: Literal["direction"]
    size: Literal["S", "M"]
    settings: DirectionSettings


class WatchlistWidget(_Widget):
    type: Literal["watchlist"]
    size: Literal["M", "L"]
    settings: WatchlistSettings


class UpcomingWidget(_Widget):
    type: Literal["upcoming"]
    size: Literal["S", "M"]
    settings: UpcomingSettings


Widget = Annotated[
    SinceWidget
    | QuestionWidget
    | SummaryWidget
    | DevelopmentsWidget
    | DirectionWidget
    | WatchlistWidget
    | UpcomingWidget,
    Field(discriminator="type"),
]
WidgetType = Literal[
    "since", "question", "summary", "developments", "direction", "watchlist", "upcoming"
]


class DashboardSpec(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    subject_ids: list[SubjectId] = Field(description="The subjects the dashboard follows")
    widgets: list[Widget]

    @model_validator(mode="after")
    def _normalize(self) -> Self:
        ids = [w.id for w in self.widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("widget ids must be unique")
        self.widgets.sort(key=lambda w: w.order)
        for i, w in enumerate(self.widgets):
            w.order = i
        return self


class Dashboard(DashboardSpec):
    id: str
    starter: bool
    created_at: datetime
    updated_at: datetime


# ---- catalog


class WidgetTypeInfo(BaseModel):
    type: WidgetType
    name: str
    description: str
    sizes: list[Size]
    fits: list[SubjectType] = Field(description="Subject types the gallery offers it for")
    settings_schema: dict[str, JsonValue]


_CATALOG: list[tuple[type[_Widget], type[BaseModel], str, str, list[SubjectType]]] = [
    (SinceWidget, SinceSettings, "Since your last review", "What changed since you last looked",
     ["topic", "group", "entity"]),
    (QuestionWidget, QuestionSettings, "Standing question", "One question and its change",
     ["topic", "group", "entity"]),
    (SummaryWidget, SummarySettings, "Monitor summary", "Every standing question at a glance",
     ["topic", "group", "entity"]),
    (DevelopmentsWidget, DevelopmentsSettings, "Developments", "Consolidated events with sources",
     ["topic", "group", "entity"]),
    (DirectionWidget, DirectionSettings, "Direction of travel", "Rising, flat or falling",
     ["topic", "group", "entity"]),
    (WatchlistWidget, WatchlistSettings, "Watchlist", "Entities and their status",
     ["group", "entity"]),
    (UpcomingWidget, UpcomingSettings, "Upcoming", "Deadlines and effective dates",
     ["topic", "group", "entity"]),
]  # fmt: skip


def catalog() -> list[WidgetTypeInfo]:
    return [
        WidgetTypeInfo.model_validate(
            {
                "type": get_args(widget.model_fields["type"].annotation)[0],
                "name": name,
                "description": desc,
                "sizes": get_args(widget.model_fields["size"].annotation),
                "fits": fits,
                "settings_schema": settings.model_json_schema(),
            }
        )
        for widget, settings, name, desc, fits in _CATALOG
    ]


# ---- widget data


class _Data(BaseModel):
    widget_id: str
    run: RunRef


class SinceData(_Data):
    type: Literal["since"]
    scope: list[SubjectRef]
    what_changed: WhatChanged
    reviewed_at: datetime | None


class QuestionData(_Data):
    type: Literal["question"]
    subject: SubjectRef
    answer: QuestionAnswerView


class SummaryData(_Data):
    type: Literal["summary"]
    subject: SubjectRef
    answers: list[QuestionAnswerView]


class DevelopmentsData(_Data):
    type: Literal["developments"]
    scope: list[SubjectRef]
    total: int
    developments: list[DevelopmentSummary] = Field(description="At most 20, in display order")


class WeekCount(BaseModel):
    week_start: str = Field(description="First day of the 7-day bucket, YYYY-MM-DD")
    week_end: str = Field(description="Last day of the bucket, the run date for the last one")
    count: int


class DirectionData(_Data):
    type: Literal["direction"]
    subject: SubjectRef
    min_materiality_level: int
    weeks: list[WeekCount] = Field(description="Oldest first; the last week ends on the run date")
    trend: Literal["rising", "flat", "falling"]
    this_week: int
    previous_average: float = Field(description="Average of the three weeks before this one")
    caption: str


class WatchlistEntry(BaseModel):
    entity: SubjectRef
    groups: list[SubjectRef]
    state: State
    new_developments: int
    needs_attention: int
    headline: QuestionAnswerView | None = Field(description="Its most severe non-stable answer")
    latest: DevelopmentSummary | None = Field(
        description="Its most recently published development, if it has any"
    )


class WatchlistData(_Data):
    type: Literal["watchlist"]
    entries: list[WatchlistEntry]


class UpcomingData(_Data):
    type: Literal["upcoming"]
    subject: SubjectRef
    items: list[UpcomingItem]


WidgetData = Annotated[
    SinceData
    | QuestionData
    | SummaryData
    | DevelopmentsData
    | DirectionData
    | WatchlistData
    | UpcomingData,
    Field(discriminator="type"),
]


class WidgetDataRequest(BaseModel):
    widget: Widget
    dashboard_subject_ids: list[SubjectId] = Field(
        default_factory=list[str], description="Scope for widgets whose subject is empty"
    )


DIRECTION_WEEKS = 8
DEVELOPMENTS_LIMIT = 20


def widget_data(q: Queries, widget: Widget, dashboard_subject_ids: list[str]) -> WidgetData:
    match widget:
        case SinceWidget(settings=s):
            ids = [s.subject_id] if s.subject_id else dashboard_subject_ids
            return SinceData(
                widget_id=widget.id,
                run=q.run,
                type="since",
                scope=[subject_ref(i) for i in ids],
                what_changed=q.what_changed(ids),
                reviewed_at=q.reviewed_at(ids),
            )
        case QuestionWidget(settings=s):
            return QuestionData(
                widget_id=widget.id,
                run=q.run,
                type="question",
                subject=subject_ref(s.subject_id),
                answer=q.answer(s.subject_id, s.question_id),
            )
        case SummaryWidget(settings=s):
            return SummaryData(
                widget_id=widget.id,
                run=q.run,
                type="summary",
                subject=subject_ref(s.subject_id),
                answers=q.answers(s.subject_id),
            )
        case DevelopmentsWidget(settings=s):
            ids = [s.subject_id] if s.subject_id else dashboard_subject_ids
            devs = q.developments_in(ids)
            return DevelopmentsData(
                widget_id=widget.id,
                run=q.run,
                type="developments",
                scope=[subject_ref(i) for i in ids],
                total=len(devs),
                developments=devs[:DEVELOPMENTS_LIMIT],
            )
        case DirectionWidget(settings=s):
            return direction(q, widget.id, s.subject_id)
        case WatchlistWidget(settings=s):
            return WatchlistData(
                widget_id=widget.id,
                run=q.run,
                type="watchlist",
                entries=[watch(q, e) for e in s.entity_ids],
            )
        case UpcomingWidget(settings=s):
            return UpcomingData(
                widget_id=widget.id,
                run=q.run,
                type="upcoming",
                subject=subject_ref(s.subject_id),
                items=q.upcoming([s.subject_id]),
            )


def direction(q: Queries, widget_id: str, subject_id: str) -> DirectionData:
    """Material developments per week by first publication, over DIRECTION_WEEKS weeks."""
    as_of = q.run.as_of
    devs = [d for d in q.developments_in([subject_id]) if d.materiality_level >= MATERIAL_LEVEL]
    weeks: list[WeekCount] = []
    for i in reversed(range(DIRECTION_WEEKS)):
        end = as_of - timedelta(days=7 * i)
        start = end - timedelta(days=6)
        count = sum(start <= d.first_published <= end for d in devs)
        weeks.append(WeekCount(week_start=start.isoformat(), week_end=end.isoformat(), count=count))
    this_week = weeks[-1].count
    previous = sum(w.count for w in weeks[-4:-1]) / 3
    if this_week >= previous * 1.25 and this_week - previous >= 2:
        trend: Literal["rising", "flat", "falling"] = "rising"
    elif this_week <= previous * 0.75 and previous - this_week >= 2:
        trend = "falling"
    else:
        trend = "flat"
    return DirectionData(
        widget_id=widget_id,
        run=q.run,
        type="direction",
        subject=subject_ref(subject_id),
        min_materiality_level=MATERIAL_LEVEL,
        weeks=weeks,
        trend=trend,
        this_week=this_week,
        previous_average=round(previous, 1),
        caption=(
            f"{this_week} material development{'s' if this_week != 1 else ''} this week, "
            f"{previous:.1f} a week over the three before"
        ),
    )


def watch(q: Queries, entity_id: str) -> WatchlistEntry:
    answers = q.answers(entity_id)
    flagged = sorted((a for a in answers if a.state != "stable"), key=lambda a: STATE_RANK[a.state])
    devs = q.developments_in([entity_id])
    return WatchlistEntry(
        entity=subject_ref(entity_id),
        groups=subject_links(entity_id).groups,
        state=worst_state(a.state for a in answers),
        new_developments=sum(d.change is not None for d in devs),
        needs_attention=sum(d.needs_attention for d in devs),
        headline=flagged[0] if flagged else None,
        latest=max(devs, key=lambda d: d.last_published, default=None),
    )
