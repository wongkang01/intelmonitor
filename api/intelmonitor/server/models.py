"""API response and request models. These are the source of truth for the OpenAPI schema, which
`pnpm gen:api` in web/ turns into TypeScript types."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from intelmonitor.pipeline.facts import SeriesFact
from intelmonitor.pipeline.graph import Theme
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.seed import (
    BadDirection,
    EntityKind,
    Frequency,
    SeriesScope,
    SourceName,
    SubjectType,
    TopicIcon,
)
from intelmonitor.store.series import Observation, Revision

State = Literal["stable", "watch", "needs_attention", "new"]
Stage = Literal["signal", "consultation", "proposed", "enacted", "enforced"]
STAGE_ORDER: list[Stage] = ["signal", "consultation", "proposed", "enacted", "enforced"]
Collection = Literal["dms", "official", "news", "data"]


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
    logo: str | None = Field(
        default=None, description="Entity icon path in the web app, if one exists"
    )
    logo_full: str | None = Field(
        default=None, description="Full entity logo path in the web app, if one exists"
    )
    icon: TopicIcon | None = Field(
        default=None, description="Topic glyph from the web icon library"
    )


class SubjectSummary(SubjectRef):
    aliases: list[str]
    new_developments: int = Field(
        description="Changed since the subject was last reviewed, and not read or dismissed"
    )
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
    trigger: Literal["cli", "manual"] = Field(description="cli: `im run`. manual: Run now")
    how: str = Field(description='"Command line", or "Run now, <display name>"')
    sources: int = Field(description="Distinct ingest sources among its documents")
    documents: int
    developments: int
    new_count: int
    updated_count: int
    needs_attention_count: int = Field(description="New or updated and needing attention")
    result: str | None = Field(
        description='Against the previous run: "4 new, 2 need attention since 17 Sep", '
        '"No new developments since 17 Sep" or "First run, N developments"; null unless complete'
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
    collections: list[Collection] = Field(description="Where its sources come from")
    jurisdictions: list[str] = Field(
        description="Names of the jurisdictions its sources report on, alphabetical"
    )
    change: DevelopmentChangeKind | None = Field(description="Change since the previous run")
    new_source_count: int


class AnswerChange(BaseModel):
    kind: Literal["first_answer", "state_changed", "unchanged"]
    previous_state: State | None
    previous_summary: str | None


class AnswerFeedback(BaseModel):
    """The analyst marked an answer wrong. The run that recomputes the answer's run, and the run
    after it, see the correction in their answer prompt."""

    id: int
    subject_id: str
    question_id: str
    run_id: str = Field(description="The run whose answer was marked wrong")
    answer_state: State = Field(description="The answer as it was marked wrong")
    answer_summary: str
    state: State | None = Field(description="What the state should be, when the state is wrong")
    summary_wrong: bool
    development_ids: list[str] = Field(description="Cited developments that do not support it")
    reason: str
    created_at: datetime


class QuestionAnswerView(BaseModel):
    question_id: str
    label: str
    question: str
    lookback_days: int
    custom: bool = Field(description="Custom answers are not recomputed by runs, so not corrected")
    summary: str
    state: State
    new_count: int
    development_ids: list[str]
    series_ids: list[str] = Field(description="Series whose facts the answer cites")
    state_rules: list[str] = Field(
        description="Why rules fixed the state, one sentence per rule that fired; empty when the "
        "state is the model's"
    )
    change: AnswerChange
    feedback: AnswerFeedback | None = Field(
        description="The latest correction given since the latest run finished, which the next "
        "run takes in"
    )


class QuestionStateChange(BaseModel):
    subject: SubjectRef
    question_id: str
    label: str
    custom: bool
    from_state: State
    to_state: State
    summary: str
    development_ids: list[str] = Field(description="The developments the new answer relies on")
    series_ids: list[str] = Field(description="Series whose facts the new answer cites")
    unreviewed: bool = Field(description="The latest run changed it after the subject's review")


class ChangedDevelopment(DevelopmentSummary):
    """A development with its What changed and triage state. When unreviewed, `change` is its
    change since the review: new if a run after it added the development, else updated. When
    reviewed, it is the change in the latest run."""

    unreviewed: bool = Field(description="Changed in a run after the review of its subject")
    read: bool
    flagged: bool
    dismissed: bool


class ChangeCounts(BaseModel):
    """What a Since widget counts among the developments changed since the review."""

    new_count: int = Field(description="Unreviewed new developments not read or dismissed")
    updated_count: int = Field(description="Unreviewed updated developments not read or dismissed")
    needs_attention_count: int = Field(
        description="Unreviewed developments needing attention, not dismissed"
    )


class WhatChanged(ChangeCounts):
    """What changed since the last review of each subject in scope: developments that runs after
    the review added or updated, and answers whose state the latest run changed. A subject never
    reviewed counts from the previous run. The latest run's changes are listed too, marked
    reviewed, so a reviewed scope can still show its run."""

    run: RunRef
    reviewed_at: datetime | None = Field(
        description="When every subject in scope was last marked reviewed; null if one never was"
    )
    developments: list[ChangedDevelopment] = Field(
        description="Needing attention first, then changed this run, most material, most recent"
    )
    question_changes: list[QuestionStateChange]


class FacetValue(BaseModel):
    value: str = Field(description="What the filter parameter takes")
    label: str
    count: int = Field(description="Matches with this value and every other facet's filter")


class DevelopmentFacets(BaseModel):
    """Each facet's values with counts. A value shows when something matches it or it is
    selected."""

    category: list[FacetValue] = Field(description="Most matches first")
    materiality: list[FacetValue] = Field(description="Most material first; values are levels")
    jurisdiction: list[FacetValue] = Field(description="Most matches first; values are codes")
    date: list[FacetValue] = Field(
        description="Last 7, 30 and 90 days before the run date as day counts, then 'any'"
    )
    source: list[FacetValue] = Field(description="Collections: official, DMS, data, news")


class DevelopmentList(ChangeCounts):
    """A scope's developments in the latest run that match the filters, with facet counts over
    the listed ones. The change counts count every development matching the filters, whatever
    `changed` lists; new plus updated is what New since review counts."""

    in_scope: int = Field(
        description="Every development in scope: what a Developments widget counts"
    )
    matching: int = Field(description="Developments in scope matching the filters")
    developments: list[ChangedDevelopment] = Field(
        description="Needing attention first, then changed this run, most material, most recent"
    )
    facets: DevelopmentFacets


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
    id: int
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
    notes: list[Note]
    trend: bool = Field(description="The subject has measured series for a Trend view")


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


class SeriesInfo(BaseModel):
    id: str
    name: str
    short_name: str = Field(description="The row name under its group heading")
    group: str | None = Field(description="The heading its rows sit under on monitor pages")
    scope: SeriesScope | None = Field(
        description="system: the banking system's figures; market: market-wide"
    )
    listed: bool = Field(description="False: an input to a derived series, off the Indicators")
    unit: str = Field(description='"%" for ratios and rates, else e.g. "USD" or "SGD per MYR"')
    frequency: Frequency
    decimals: int
    bad_direction: BadDirection = Field(description="Which way is worse, if either")
    baseline: float | None = Field(
        description="A level its line is read against: 0 for a distance from a peg"
    )
    source: SourceName
    source_label: str = Field(description='Where its values come from: "MAS I.18", "FRED DFF"')
    providers: list[str] = Field(
        description='The APIs its values come from, following derived inputs: ["CoinGecko", "MAS"]'
    )
    source_url: str


class LinePoint(BaseModel):
    period: date
    value: float
    preliminary: bool


class SeriesChart(BaseModel):
    """A cited series as the evidence drawer draws it: its values over a span ending on the run
    date, as known by the end of that day, with the period its sentence cites highlighted."""

    series: SeriesInfo
    start: date = Field(
        description="12 months before the run date for daily series, 24 months for monthly, "
        "the stored history's start for quarterly"
    )
    end: date = Field(description="The run date")
    line: list[LinePoint] = Field(description="Observations from start to end, by period")
    cited_from: date | None = Field(description="First period the sentence cites")
    cited_to: date | None = Field(description="Last period the sentence cites")
    cited: Observation | None = Field(description="The value the sentence states")
    revisions: list[Revision] = Field(
        description="Revisions of the cited period made by the run date, in the order made"
    )


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
    series: SeriesChart | None = Field(
        description="A detector's document: the series it measured, the event highlighted"
    )


class SubjectConfidence(BaseModel):
    subject: SubjectRef
    confidence: float
    source: str


class TagFeedback(BaseModel):
    """The analyst removed a subject tag from a development; every later run leaves it off."""

    id: int
    subject: SubjectRef
    development_id: str
    reason: str
    run_id: str = Field(description="The latest run when it was given")
    created_at: datetime
    applied: bool = Field(description="The latest run already leaves the tag off")


class DevelopmentDetail(DevelopmentSummary):
    run: RunRef
    materiality_confidence: float
    materiality_rule: str | None = Field(
        description='The detector whose rule set the level, by name ("Fed funds rate change"); '
        "null when Jev scored it"
    )
    subject_confidence: list[SubjectConfidence]
    tag_feedback: list[TagFeedback] = Field(description="Tags the analyst removed, oldest first")
    sources: list[EvidenceSource] = Field(
        description="A detection first, then the tagged institutions' own publications, then DMS, "
        "official and news documents; earliest first within each"
    )
    notes: list[Note]


class SeriesFactView(BaseModel):
    """A series and what code stated about it for an answer."""

    series: SeriesInfo
    fact: SeriesFact


class CitedSeries(SeriesFactView):
    chart: SeriesChart


class AnswerEvidence(BaseModel):
    """Everything behind one standing question answer: the answer, the developments it relies
    on, each with its sources, and the series it cites with the facts the run gave it."""

    subject: SubjectRef
    run: RunRef
    answer: QuestionAnswerView
    developments: list[DevelopmentDetail] = Field(description="In the order the answer cites them")
    series: list[CitedSeries] = Field(description="In the order the answer cites them")


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
    theme: Theme | None = Field(description="A development's theme, which the view groups by")


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


class DocumentHit(BaseModel):
    id: str
    title: str
    domain: str
    published_at: datetime
    snippet: str = Field(
        description="The best matching passage of the body as plain text, without the title, "
        "with … where clipped"
    )
    development_id: str = Field(
        description="The development whose evidence it opens: the first citing it in display order"
    )


class SearchResults(BaseModel):
    subjects: list[SearchHit] = Field(description="By name and alias, best first")
    developments: list[DevelopmentSummary] = Field(
        description="The latest run's, by title and summary, best first"
    )
    documents: list[DocumentHit] = Field(
        description="Sources of the latest run's developments, by title and text, best first"
    )


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
    tour_seen_at: datetime | None = Field(
        default=None, description="When the first-run tour last started; null shows it once"
    )


class MaterialityLevel(BaseModel):
    """A materiality level for Help: what it means and how the app treats it."""

    level: int = Field(ge=0, le=4)
    name: str
    description: str
    material: bool = Field(description="Counted as material, as in the Direction widget")
    needs_attention: bool
    developments: int = Field(description="Developments at this level in the latest run")


class ReviewRequest(BaseModel):
    subject_ids: list[SubjectId] = Field(min_length=1)


class NoteRequest(BaseModel):
    subject_id: SubjectId | None = None
    development_id: str | None = None
    text: str = Field(min_length=1, max_length=4000)


class TagFeedbackRequest(BaseModel):
    development_id: str
    subject_id: SubjectId
    reason: str = Field(default="", max_length=2000)


class AnswerFeedbackRequest(BaseModel):
    """What is wrong with the latest run's answer to a built-in question: at least one of the
    state, the summary, cited developments, or a reason."""

    subject_id: SubjectId
    question_id: str
    state: State | None = Field(default=None, description="What the state should be")
    summary_wrong: bool = False
    development_ids: list[str] = Field(
        default_factory=list[str], description="Cited developments that do not support it"
    )
    reason: str = Field(default="", max_length=2000)


AlertBadge = Literal["needs_attention", "watch"]


class Alert(BaseModel):
    id: str = Field(description="The development id")
    title: str
    badge: AlertBadge
    meta: str = Field(description='"OCBC, financial, 3 sources"')
    read: bool = Field(description="The development's triage read state")


class AlertCounts(BaseModel):
    needs_attention: int
    watch: int
    total: int


class Alerts(BaseModel):
    """The latest run's new or updated developments on followed subjects that need attention,
    then those to watch. Dismissed developments are left out."""

    run: RunRef
    followed: int = Field(description="How many subjects are followed")
    alerts: list[Alert]
    unread: AlertCounts


class Triage(BaseModel):
    development_id: str
    read: bool = Field(description="Read since the latest run that changed it")
    flagged: bool
    dismissed: bool


class TriageChange(BaseModel):
    """Only the states given change."""

    read: bool | None = None
    flagged: bool | None = None
    dismissed: bool | None = None
