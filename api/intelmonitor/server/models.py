"""API response and request models. These are the source of truth for the OpenAPI schema, which
`pnpm gen:api` in web/ turns into TypeScript types."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.seed import EntityKind, SubjectType

State = Literal["stable", "watch", "needs_attention", "new"]
Stage = Literal["signal", "consultation", "proposed", "enacted", "enforced"]
STAGE_ORDER: list[Stage] = ["signal", "consultation", "proposed", "enacted", "enforced"]
Collection = Literal["dms", "official", "news"]


def _known_subject(value: str) -> str:
    if value not in all_subjects():
        raise ValueError(f"unknown subject id {value!r}")
    return value


def _known_entity(value: str) -> str:
    if _known_subject(value) and all_subjects()[value].type != "entity":
        raise ValueError(f"{value!r} is not an entity")
    return value


# A seeded subject id, such as "ocbc" or "singapore-banks".
SubjectId = Annotated[str, AfterValidator(_known_subject)]
EntityId = Annotated[str, AfterValidator(_known_entity)]


class SubjectRef(BaseModel):
    id: str
    name: str
    type: SubjectType
    kind: EntityKind | None


class SubjectSummary(SubjectRef):
    aliases: list[str]
    new_developments: int = Field(description="New or updated developments in the latest run")
    needs_attention: int = Field(description="Developments needing attention in the latest run")


class SubjectLinks(BaseModel):
    topics: list[SubjectRef]
    groups: list[SubjectRef]
    entities: list[SubjectRef]


class SubjectDetail(SubjectSummary):
    description: str
    domains: list[str]
    links: SubjectLinks


class RunInfo(BaseModel):
    """One execution of a run. A run recomputed with Run now appears once per execution."""

    execution_id: int
    id: str = Field(description="The run it computed, named by its as-of date")
    as_of: date
    previous_run_id: str | None
    status: Literal["running", "complete", "failed"]
    trigger: Literal["scheduled", "manual"]
    how: str = Field(description='"Scheduled", or "Manual, <display name>"')
    sources: int = Field(description="Distinct ingest sources among its documents")
    documents: int
    developments: int
    new_count: int
    updated_count: int
    needs_attention_count: int = Field(description="New or updated and needing attention")
    result: str | None = Field(
        description='"4 new, 1 needs attention", "First run, N developments" or '
        '"No new developments"; null unless complete'
    )
    started_at: datetime
    finished_at: datetime | None
    duration_seconds: float | None


class RunStatus(BaseModel):
    running: bool
    run_id: str | None
    how: str | None
    started_at: datetime | None
    sources: int | None
    estimate_seconds: float | None = Field(
        description="Median duration of earlier executions, when there are any"
    )


class RunSchedule(BaseModel):
    cadence: str
    next_run_at: datetime
    nominal: bool = Field(
        description="True in the POC: no scheduler runs, this is the planned cadence"
    )


class RunRef(BaseModel):
    id: str
    as_of: date
    previous_run_id: str | None


DevelopmentChangeKind = Literal["new", "updated"]


class DevelopmentSummary(BaseModel):
    id: str
    title: str
    category: str
    stage: Stage | None
    event_date: date | None
    first_published: date
    last_published: date
    materiality_level: int = Field(ge=0, le=4)
    materiality_label: str
    needs_attention: bool
    adverse: bool
    direction: Literal["positive", "negative", "neutral"]
    subjects: list[SubjectRef]
    source_count: int
    change: DevelopmentChangeKind | None = Field(description="Change since the previous run")
    new_source_count: int


class AnswerChange(BaseModel):
    kind: Literal["first_answer", "state_changed", "unchanged"]
    previous_state: State | None
    previous_summary: str | None


class QuestionAnswerView(BaseModel):
    question_id: str
    label: str
    question: str
    lookback_days: int
    custom: bool
    summary: str
    state: State
    new_count: int
    development_ids: list[str]
    change: AnswerChange


class QuestionStateChange(BaseModel):
    subject: SubjectRef
    question_id: str
    label: str
    custom: bool
    from_state: State
    to_state: State
    summary: str
    development_ids: list[str] = Field(description="The developments the new answer relies on")


class WhatChanged(BaseModel):
    run: RunRef
    new_count: int
    updated_count: int
    needs_attention_count: int
    developments: list[DevelopmentSummary] = Field(
        description="New and updated developments, needing attention first, then most material"
    )
    question_changes: list[QuestionStateChange]


class UpcomingItem(BaseModel):
    date: date
    label: str
    development_id: str
    development_title: str
    subjects: list[SubjectRef]


class StageBucket(BaseModel):
    stage: Stage
    count: int
    developments: list[DevelopmentSummary] = Field(description="Most material first, at most 3")


class StageTrack(BaseModel):
    lookback_days: int
    stages: list[StageBucket]


class CommonIssue(BaseModel):
    development: DevelopmentSummary
    members: list[SubjectRef]


class Outlier(BaseModel):
    member: SubjectRef
    reason: str
    developments: int
    needs_attention: int


class GroupInsights(BaseModel):
    lookback_days: int
    common_issues: list[CommonIssue]
    outliers: list[Outlier]


class Note(BaseModel):
    id: int
    subject_id: str | None
    development_id: str | None
    text: str
    run_id: str | None
    created_at: datetime


class Review(BaseModel):
    subject_id: str
    run_id: str | None
    created_at: datetime


class MonitorPage(BaseModel):
    subject: SubjectDetail
    run: RunRef
    what_changed: WhatChanged
    questions: list[QuestionAnswerView] = Field(description="Built-in questions, then custom")
    custom_question_slots: int = Field(description="Custom questions the user can still add")
    upcoming: list[UpcomingItem]
    stage_track: StageTrack | None = Field(description="Topics only")
    group: GroupInsights | None = Field(description="Groups only")
    reviewed_at: datetime | None
    notes: list[Note]


class Span(BaseModel):
    start: int
    end: int


class Quote(Span):
    text: str


class Passage(BaseModel):
    """An excerpt of the source around a finding's quotes; highlights are offsets into `text`."""

    text: str
    highlights: list[Span]
    clipped_start: bool = Field(description="The document continues before `text`")
    clipped_end: bool = Field(description="The document continues after `text`")


class EvidenceFinding(BaseModel):
    id: str
    statement: str
    event_date: date | None
    quotes: list[Quote] = Field(description="Offsets into the full document text")
    passage: Passage


class EvidenceSource(BaseModel):
    document_id: str
    title: str
    url: str
    domain: str
    source: str
    collection: Collection
    doc_type: str
    classification: str
    published_at: datetime
    new_in_run: bool = Field(description="Added to the development since the previous run")
    findings: list[EvidenceFinding]


class SubjectConfidence(BaseModel):
    subject: SubjectRef
    confidence: float
    source: str


class DevelopmentDetail(DevelopmentSummary):
    run: RunRef
    materiality_confidence: float
    subject_confidence: list[SubjectConfidence]
    sources: list[EvidenceSource] = Field(description="Primary sources first, then earliest")
    notes: list[Note]


class AnswerEvidence(BaseModel):
    """Everything behind one standing question answer: the answer and the developments it
    relies on, each with its sources."""

    subject: SubjectRef
    run: RunRef
    answer: QuestionAnswerView
    developments: list[DevelopmentDetail] = Field(description="In the order the answer cites them")


class DocumentDetail(BaseModel):
    id: str
    title: str
    url: str
    domain: str
    source: str
    collection: Collection
    doc_type: str
    classification: str
    published_at: datetime
    text: str
    quotes: list[Quote] = Field(description="Every verified quote in the document, by offset")


NodeType = Literal["topic", "group", "entity", "development"]
LinkType = Literal["MEMBER_OF", "EXPOSED_TO", "AFFECTS"]


class GraphNode(BaseModel):
    id: str = Field(description="Subject id, or dev:<development id>")
    type: NodeType
    label: str
    kind: EntityKind | None
    hop: int
    has_new: bool = Field(
        description="A development: new or updated this run. A subject: affected by one."
    )
    needs_attention: bool
    materiality_level: int | None
    last_published: date | None


class GraphEdge(BaseModel):
    source: str
    target: str
    type: LinkType
    origin: str = Field(description="seed, jev or claude")
    confidence: float


class Graph(BaseModel):
    run: RunRef
    center: str
    hops: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated_developments: int = Field(description="Development nodes left out by the cap")


class SearchHit(BaseModel):
    subject: SubjectRef
    matched: str = Field(description="The name or alias that matched")


class DataSourceStats(BaseModel):
    source: str
    collection: Collection
    documents: int
    relevant_documents: int
    first_published: date
    last_published: date


class DataSources(BaseModel):
    t0: date | None
    total_documents: int
    sources: list[DataSourceStats]


class Profile(BaseModel):
    display_name: str
    role: str
    default_dashboard_id: str | None


class ReviewRequest(BaseModel):
    subject_ids: list[SubjectId] = Field(min_length=1)


class NoteRequest(BaseModel):
    subject_id: SubjectId | None = None
    development_id: str | None = None
    text: str = Field(min_length=1, max_length=4000)


AlertBadge = Literal["needs_attention", "watch"]


class Alert(BaseModel):
    id: str = Field(description="The development id")
    title: str
    badge: AlertBadge
    meta: str = Field(description='"OCBC, financial, 3 sources"')
    read: bool


class AlertCounts(BaseModel):
    needs_attention: int
    watch: int
    total: int


class Alerts(BaseModel):
    """The latest run's new or updated developments needing attention, then those to watch."""

    run: RunRef
    alerts: list[Alert]
    unread: AlertCounts
