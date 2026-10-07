"""Dashboard spec and widgets. One settings schema per widget type drives the gallery, manual
edits and the Generate agent; `widget_data` fills a widget from the latest run."""

import json
from datetime import date, datetime
from typing import Annotated, Literal, Self, get_args

from pydantic import BaseModel, Field, JsonValue, model_validator

from intelmonitor.pipeline.detectors import corpus_start
from intelmonitor.pipeline.indicators import months_before
from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.seed import SeriesDef, SubjectType, load_series
from intelmonitor.server.alerts import alert_badge, watched_ids
from intelmonitor.server.models import (
    AlertBadge,
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
    week_spans,
    weekly_counts,
    worst_state,
)
from intelmonitor.server.series import (
    SubjectIndicator,
    default_series,
    home_subject,
    mapped_series,
    subject_indicators,
)
from intelmonitor.store.documents import first_document_day

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


def _listed(subject_id: str) -> list[SeriesDef]:
    return [s for s, _ in mapped_series(subject_id) if s.listed]


class IndicatorSettings(BaseModel):
    """A series id, or a subject id alone for the subject's primary series. A series given
    without a subject is shown for the subject it belongs to."""

    subject_id: SubjectId | None = Field(
        default=None,
        description="Alone, the subject's primary series is shown (a peg first); with "
        "series_id, the subject it is shown for, which the series must belong to",
    )
    series_id: str | None = Field(
        default=None,
        description='A series id from list_subjects, e.g. "derived.usdc.peg"; empty for the '
        "subject's primary series",
    )

    @model_validator(mode="after")
    def _resolve(self) -> Self:
        if self.series_id is None:
            if self.subject_id is None:
                raise ValueError("set series_id, subject_id or both")
            if default_series(self.subject_id) is None:
                raise ValueError(f"{self.subject_id!r} has no measured series")
            return self
        s = next((s for s in load_series().series if s.id == self.series_id), None)
        if s is None or not s.listed:
            raise ValueError(f"{self.series_id!r} is not a listed series")
        if self.subject_id is None:
            self.subject_id = home_subject(s)
        elif s not in _listed(self.subject_id):
            raise ValueError(f"{self.series_id!r} is not a series of {self.subject_id!r}")
        return self

    def series(self) -> SeriesDef:
        """The series shown: the one set, else the subject's default."""
        if self.series_id is not None:
            return next(s for s in load_series().series if s.id == self.series_id)
        assert self.subject_id is not None
        found = default_series(self.subject_id)
        assert found is not None
        return found


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


class IndicatorWidget(_Widget):
    type: Literal["indicator"]
    size: Literal["S", "M", "L"]
    settings: IndicatorSettings


Widget = Annotated[
    SinceWidget
    | QuestionWidget
    | SummaryWidget
    | DevelopmentsWidget
    | DirectionWidget
    | WatchlistWidget
    | UpcomingWidget
    | IndicatorWidget,
    Field(discriminator="type"),
]
WidgetType = Literal[
    "since",
    "question",
    "summary",
    "developments",
    "direction",
    "watchlist",
    "upcoming",
    "indicator",
]


# Sidebar dot colors. Hues sit away from the status colors (red, amber, green) so a dot never reads
# as a state.
DashboardColor = Literal["blue", "teal", "purple", "pink", "orange", "olive", "slate", "brown"]
DASHBOARD_COLORS: tuple[DashboardColor, ...] = get_args(DashboardColor)


class DashboardContent(BaseModel):
    """What a dashboard shows; the spec and the stored dashboard add a color."""

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


class DashboardSpec(DashboardContent):
    color: DashboardColor | None = Field(
        default=None,
        description="Sidebar dot. Unset on create picks the least used color; unset on update "
        "keeps the stored one",
    )


class Dashboard(DashboardContent):
    color: DashboardColor = Field(description="Sidebar dot; reordering never changes it")
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
    subject_ids: list[str] | None = Field(
        description="When set, only these subjects of those types have what it shows"
    )
    settings_schema: dict[str, JsonValue]


_CATALOG: list[tuple[type[_Widget], type[BaseModel], str, str, list[SubjectType]]] = [
    (SinceWidget, SinceSettings, "Since your last review", "What changed since you last looked",
     ["topic", "group", "entity"]),
    (QuestionWidget, QuestionSettings, "Focus area", "One focus area and its change",
     ["topic", "group", "entity"]),
    (SummaryWidget, SummarySettings, "Monitor summary", "Every focus area at a glance",
     ["topic", "group", "entity"]),
    (DevelopmentsWidget, DevelopmentsSettings, "Developments", "Consolidated events with sources",
     ["topic", "group", "entity"]),
    (DirectionWidget, DirectionSettings, "Direction of travel", "Rising, flat or falling",
     ["topic", "group", "entity"]),
    (WatchlistWidget, WatchlistSettings, "Watchlist", "Entities and their status",
     ["group", "entity"]),
    (UpcomingWidget, UpcomingSettings, "Upcoming", "Deadlines and effective dates",
     ["topic", "group", "entity"]),
    (IndicatorWidget, IndicatorSettings, "Indicator",
     "A measured series: its state, latest value and 12-month line, with developments on a lane "
     "at L", ["topic", "group", "entity"]),
]  # fmt: skip


def _subjects_for(widget: type[_Widget]) -> list[str] | None:
    """The subjects a widget type is limited to: indicators need a listed series."""
    if widget is IndicatorWidget:
        return [i for i in all_subjects() if default_series(i) is not None]
    return None


def catalog() -> list[WidgetTypeInfo]:
    return [
        WidgetTypeInfo.model_validate(
            {
                "type": get_args(widget.model_fields["type"].annotation)[0],
                "name": name,
                "description": desc,
                "sizes": get_args(widget.model_fields["size"].annotation),
                "fits": fits,
                "subject_ids": _subjects_for(widget),
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


class QuestionData(_Data):
    type: Literal["question"]
    subject: SubjectRef
    answer: QuestionAnswerView
    indicator: SubjectIndicator | None = Field(
        description="A custom question's first series as of the run date, for the line at M; "
        "none for built-in questions and custom ones without series"
    )


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


class MarkedDevelopment(BaseModel):
    """A development marked on an indicator's lane."""

    development: DevelopmentSummary
    on: date = Field(
        description="Where it sits: its event date when in the lane's 12 months, else its first "
        "publication"
    )
    badge: AlertBadge


class IndicatorData(_Data):
    type: Literal["indicator"]
    subject: SubjectRef
    indicator: SubjectIndicator = Field(description="As of the run date")
    documents_from: date = Field(description="The first document's day: none before it")
    developments: list[MarkedDevelopment] = Field(
        description="For the Large lane: the subject's Needs attention and Watch developments "
        "dated in the 12 months to the run date, newest first"
    )


WidgetData = Annotated[
    SinceData
    | QuestionData
    | SummaryData
    | DevelopmentsData
    | DirectionData
    | WatchlistData
    | UpcomingData
    | IndicatorData,
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
            )
        case QuestionWidget(settings=s):
            return QuestionData(
                widget_id=widget.id,
                run=q.run,
                type="question",
                subject=subject_ref(s.subject_id),
                answer=q.answer(s.subject_id, s.question_id),
                indicator=question_line(q, s.subject_id, s.question_id),
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
        case IndicatorWidget(settings=s):
            return indicator(q, widget.id, s)


def question_line(q: Queries, subject_id: str, question_id: str) -> SubjectIndicator | None:
    """A custom question's first series as of the run date. Every size gets it, since widget
    data is cached across resizes."""
    row = q.conn.execute(
        "SELECT series_ids FROM custom_questions WHERE id = ? AND subject_id = ?",
        (question_id, subject_id),
    ).fetchone()
    ids: list[str] = json.loads(row["series_ids"]) if row else []
    if not ids:
        return None
    found = subject_indicators(q.conn, subject_id, q.run.as_of, ids[0]).indicators
    return found[0] if found else None  # a series since removed from the seed


def direction(q: Queries, widget_id: str, subject_id: str) -> DirectionData:
    """Material developments per week by first publication, over DIRECTION_WEEKS weeks."""
    devs = [d for d in q.developments_in([subject_id]) if d.materiality_level >= MATERIAL_LEVEL]
    spans = week_spans(q.run.as_of, DIRECTION_WEEKS)
    weeks = [
        WeekCount(week_start=start.isoformat(), week_end=end.isoformat(), count=count)
        for (start, end), count in zip(
            spans, weekly_counts((d.first_published for d in devs), spans), strict=True
        )
    ]
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


def indicator(q: Queries, widget_id: str, settings: IndicatorSettings) -> IndicatorData:
    """The series as of the run date and the developments for its lane. Every size gets them,
    since widget data is cached across resizes."""
    assert settings.subject_id is not None
    series = settings.series()
    as_of = q.run.as_of
    shown = subject_indicators(q.conn, settings.subject_id, as_of, series.id).indicators[0]
    return IndicatorData(
        widget_id=widget_id,
        run=q.run,
        type="indicator",
        subject=subject_ref(settings.subject_id),
        indicator=shown,
        documents_from=documents_from(q, as_of),
        developments=marked(q, settings.subject_id, as_of),
    )


def documents_from(q: Queries, as_of: date) -> date:
    """The day of the earliest stored document, else the corpus start: the lane is empty before
    it because nothing was collected, not because nothing happened."""
    return first_document_day(q.conn) or corpus_start(q.conn, as_of)


def marked(q: Queries, subject_id: str, as_of: date) -> list[MarkedDevelopment]:
    """The subject's developments that need attention or are to watch, as the alerts rank them,
    each at its event date within the 12 months to `as_of`, else at its first publication.
    Dismissed ones are left out."""
    start = months_before(as_of, 12)
    watched = watched_ids(q)
    out: list[MarkedDevelopment] = []
    for d in q.developments_in([subject_id]):
        badge = alert_badge(d, watched)
        if badge is None or q.is_dismissed(d.id):
            continue
        on = d.event_date if d.event_date and start <= d.event_date <= as_of else d.first_published
        if start <= on <= as_of:
            out.append(MarkedDevelopment(development=d, on=on, badge=badge))
    return sorted(out, key=lambda m: m.on, reverse=True)


def watch(q: Queries, entity_id: str) -> WatchlistEntry:
    answers = q.answers(entity_id)
    flagged = sorted((a for a in answers if a.state != "stable"), key=lambda a: STATE_RANK[a.state])
    devs = q.developments_in([entity_id])
    return WatchlistEntry(
        entity=subject_ref(entity_id),
        groups=subject_links(entity_id).groups,
        state=worst_state(a.state for a in answers),
        new_developments=q.unread_count(entity_id),
        needs_attention=sum(d.needs_attention for d in devs),
        headline=flagged[0] if flagged else None,
        latest=max(devs, key=lambda d: d.last_published, default=None),
    )
