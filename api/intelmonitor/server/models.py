"""API response and request models. These are the source of truth for the OpenAPI schema, which
`pnpm gen:api` in web/ turns into TypeScript types."""

from datetime import date, datetime
from enum import IntEnum
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from intelmonitor.pipeline.extract import Tone
from intelmonitor.pipeline.facts import SeriesFact
from intelmonitor.pipeline.graph import Theme
from intelmonitor.pipeline.impact import Confidence, Direction
from intelmonitor.pipeline.params import Priority
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.relationships import (
    EndpointKind,
    Evidence,
    FigureMeasure,
    FigureUnit,
    HeadlineMeasure,
    HeadlineUnit,
    RelType,
)
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
Collection = Literal["dms", "official", "news", "data", "social"]


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
    members: list[str] = Field(description="Member entity ids, for a group; else empty")
    new_developments: int = Field(
        description="Changed since the subject was last reviewed, and not read or dismissed"
    )
    needs_attention: int = Field(description="High-priority developments in the latest run")
    recent: int = Field(
        description="Developments it happened to or that it did, last published in the 30 days "
        "to the run date"
    )
    recent_high: int = Field(description="Of those, the ones at High priority for it")
    new_high: int = Field(
        description="High for it, first published after the last visit (else the previous "
        "run), and not read or dismissed"
    )


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


class LatestRun(RunRef):
    """The latest complete run, for the top bar's "Week to" date."""

    latest_news: date | None = Field(
        description="The latest last-published date among its developments"
    )


DevelopmentChangeKind = Literal["new", "updated"]


class SourceTypeCount(BaseModel):
    collection: Collection
    count: int


class DevelopmentSummary(BaseModel):
    """A development as a scope sees it: priority, adverse and tone are over the subjects in
    scope that it is tagged to (over all its subjects when unscoped)."""

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
    priority: Priority = Field(description="High, Medium or Low for the subjects in scope")
    priority_for: list[SubjectRef] = Field(
        description="The subjects in scope at that priority, when others in scope rank lower; "
        "empty when they all agree"
    )
    adverse: bool
    direction: Tone = Field(description="Its tone: the most telling over the subjects in scope")
    subjects: list[SubjectRef] = Field(
        description="What it happened to or who did it, highest priority first"
    )
    actors: list[str] = Field(description="Ids of the subjects that did it, among `subjects`")
    also_affects: list[SubjectRef] = Field(
        description="Tracked subjects it reaches indirectly through stored relationships"
    )
    source_count: int
    source_types: list[SourceTypeCount] = Field(description="Sources per collection")
    outlet_count: int = Field(
        description="Distinct news outlets among its sources, one per parent domain"
    )
    social_count: int = Field(description="Social posts among its sources")
    unconfirmed: bool = Field(
        description="Its sources do not pass the source gate (pipeline/corroboration.py), so "
        "lists leave it out unless asked"
    )
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
        description="Highest priority first, then most recent"
    )
    question_changes: list[QuestionStateChange]


class FacetValue(BaseModel):
    value: str = Field(description="What the filter parameter takes")
    label: str
    count: int = Field(description="Matches with this value and every other facet's filter")


class DevelopmentFacets(BaseModel):
    """Each facet's values with counts. A value shows when something matches it or it is
    selected."""

    priority: list[FacetValue] = Field(description="High, Medium, Low")
    adverse: list[FacetValue] = Field(description="'true' (adverse) and 'false'")
    tone: list[FacetValue] = Field(description="Negative, neutral, positive")
    category: list[FacetValue] = Field(description="Most matches first")
    materiality: list[FacetValue] = Field(description="Most material first; values are levels")
    jurisdiction: list[FacetValue] = Field(description="Most matches first; values are codes")
    date: list[FacetValue] = Field(
        description="Today, this week and this month (1, 7 and 30 days to the run date), then 'any'"
    )
    source: list[FacetValue] = Field(description="Collections: official, research, data, news")


class DevelopmentList(ChangeCounts):
    """A scope's developments in the latest run that match the filters, with facet counts over
    the listed ones. The change counts count every development matching the filters, whatever
    `changed` lists; new plus updated is what New since review counts."""

    in_scope: int = Field(
        description="Every development in scope: what a Developments widget counts"
    )
    matching: int = Field(description="Developments in scope matching the filters")
    since: date = Field(
        description="New and Updated count from this date: a development is new when first "
        "published after it, updated when first published before and last published after"
    )
    dismissed: int = Field(description="Dismissed developments matching the filters")
    unconfirmed: int = Field(
        description="Unconfirmed developments the list would show with `unconfirmed`, whether "
        "it is on or not"
    )
    developments: list[ChangedDevelopment] = Field(
        description="High adverse first, then other High, Medium adverse, other Medium and the "
        "rest; most recent first within each"
    )
    facets: DevelopmentFacets


class UpcomingItem(BaseModel):
    date: date
    label: str
    development_id: str
    development_title: str
    subjects: list[SubjectRef]


class WatchItem(BaseModel):
    """One entity on a dashboard's watchlist. Priorities are the entity's own."""

    subject: SubjectRef
    new_high: int = Field(
        description="High developments first published after `since`, not read or dismissed"
    )
    month_count: int = Field(description="Developments last published in the 30 days to the run")
    top: DevelopmentSummary | None = Field(
        description="The highest priority of those, then the most recent; dismissed ones skipped"
    )
    latest: DevelopmentSummary | None = Field(
        description="The most recent development, only when `top` is null"
    )


class DashboardOverview(BaseModel):
    """What a dashboard shows beside its feed (the feed is GET /developments?dashboard_id=)."""

    since: date = Field(description="New counts from this date (the last visit, else the run)")
    new_count: int = Field(description="Developments first published after it, unread")
    watchlist: list[WatchItem] = Field(
        description="Its entities in dashboard order, groups resolved to their members"
    )
    upcoming: list[UpcomingItem]


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


BriefDirection = Literal["worse", "better", "unchanged", "mixed"]


class BriefConcern(BaseModel):
    label: str | None = Field(
        description="2 to 4 words naming its topic, shown bold before the text; None for a brief "
        "written before labels"
    )
    text: str = Field(description="A risk or an opening for the subject and why it matters")
    development_ids: list[str] = Field(
        description="The developments, open matters and indirect impacts behind it, kept for "
        "checks; the page does not list them"
    )


class BriefDate(BaseModel):
    date: date
    label: str
    development_id: str


class EntityBrief(BaseModel):
    """The brief at the top of a subject's page (pipeline/summaries.py): written by Claude from
    the last 7 days of developments, indirect impacts, series events and upcoming dates and the
    subject's standing position (Key data, main links, open matters), checked and counted by
    code."""

    state: str = Field(description="One sentence on the subject's situation now")
    direction: BriefDirection = Field(
        description="Against the previous brief; unchanged when the model's direction disagreed "
        "with the evidence and was flagged"
    )
    direction_reason: str = Field(description="Empty when the direction was flagged")
    direction_flagged: bool = Field(
        description="The model's direction disagreed with code's signals after a retry"
    )
    concerns: list[BriefConcern] = Field(
        description="At most 2, most serious first; none on a quiet week unless a matter High "
        "and adverse to the subject is open, which a concern then cites. A brief written before "
        "concerns gives its points' claims"
    )
    coming_up: list[BriefDate]
    developments: int = Field(description="Developments with a source in the last 7 days")
    high: int = Field(description="Of those, High for the subject")
    adverse: int = Field(description="Of those, adverse to the subject")
    latest_news: date | None = Field(description="The last source of its latest development")
    model: str = Field(description="none when code wrote it, with no evidence to brief on")


class RelationshipFigure(BaseModel):
    """A further figure behind an exposure, such as loans by currency, risk-weighted assets or
    NPLs, with its own source."""

    measure: FigureMeasure
    segment: str = Field(description="The row label in the source table")
    value: float
    unit: FigureUnit
    share: float | None
    period: date
    chart_reading: bool
    source_url: str
    source_title: str
    page: int | None
    quote: str


class RelationshipLink(BaseModel):
    """A stored relationship as evidence: its type, ends, size, grade and source."""

    id: str
    type: RelType
    label: str = Field(description='The type in plain words: "depends on, for cloud services"')
    from_id: str
    from_name: str
    to_id: str
    to_name: str
    weight: float | None = Field(
        description="Exposures: the headline figure's share of its total (a bank's loans, an "
        "issuer's reserves, a firm's revenue). Ownership: the share held. Else null; an exposure "
        "with no weight discloses no share"
    )
    measure: HeadlineMeasure | None
    value: float | None
    unit: HeadlineUnit | None
    evidence: Evidence
    chart_reading: bool = Field(description="The figure was read off a chart")
    as_of: date | None = Field(description="When the link is known to hold")
    last_confirmed: date
    source_url: str | None
    source_title: str | None
    page: int | None
    quote: str | None = Field(description="Verbatim from the source")
    detail: str
    figures: list[RelationshipFigure]


class ImpactPassage(BaseModel):
    """A passage from the development's sources that the impact's reason relies on."""

    document_id: str
    domain: str
    published: date
    text: str


class IndirectImpact(BaseModel):
    """An entity a development reaches through stored relationships, as judged by Claude. Code
    writes the route from the relationships; Claude only judged it and wrote why."""

    development_id: str
    subject: SubjectRef
    direction: Direction
    route: str = Field(description='Plain words: "via its Hong Kong loans, 12.2% of total"')
    why: str = Field(description="One or two sentences citing the development")
    confidence: Confidence
    weight: float | None = Field(description="The route's exposure share, if it has an exposure")
    region: str | None = Field(
        description="The region's name when the share covers a whole region (Greater China)"
    )
    evidence: Evidence = Field(description="The weakest grade along the route")
    last_confirmed: date = Field(description="The oldest last confirmation along the route")
    relationships: list[RelationshipLink] = Field(description="From the entity outward")
    finding_ids: list[str] = Field(description="The development's findings the reason relies on")
    passages: list[ImpactPassage]


class SubjectImpact(IndirectImpact):
    """An indirect impact on a subject, with the development that causes it."""

    development: DevelopmentSummary


class DirectSubject(BaseModel):
    """A subject the development happened to (affected) or that did it (actor)."""

    subject: SubjectRef
    role: Literal["affected", "actor"]
    priority: Priority
    adverse: bool
    tone: Tone


class SharedEndpoint(BaseModel):
    """A subject or endpoint both entities link to, with each one's links to it."""

    id: str
    name: str
    kind: EntityKind | EndpointKind
    subject: bool = Field(description="A tracked subject; otherwise a relationship endpoint")
    a_links: list[RelationshipLink]
    b_links: list[RelationshipLink]


class SharedRelationships(BaseModel):
    a: SubjectRef
    b: SubjectRef
    endpoints: list[SharedEndpoint] = Field(description="By name")


class LinkedRoute(BaseModel):
    """How an institution links to the subject: one stored link, or two through a company it
    owns, written in plain words by code."""

    text: str = Field(
        description='"Has 12.2% of its loans in Hong Kong"; "Owns 100% of DBS Bank (Hong Kong), '
        'which operates in Hong Kong"; region-level routes end ", a figure for the whole region"'
    )
    region: str | None = Field(description="The region's name when the route ends in a region")
    links: list[RelationshipLink] = Field(description="From the institution outward")


class LinkedInstitution(BaseModel):
    """A bank or other financial institution linked to a country, sector, supplier or payment
    system in the relationship store (GET /subjects/{id}/linked)."""

    id: str
    name: str
    kind: EntityKind | EndpointKind
    subject: SubjectRef | None = Field(description="None when the institution is not tracked")
    region: bool = Field(description="Its largest figure covers a whole region, not the subject")
    routes: list[LinkedRoute] = Field(
        description="Direct links first, then through a company it owns, then region-level"
    )
    impacts: list[SubjectImpact] = Field(
        description="Developments in the last 7 days that reach it through these routes"
    )


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
    brief: EntityBrief | None = Field(description="None until the run has one for the subject")
    impacts: list[SubjectImpact] = Field(
        description="Developments in the last 7 days that reach the subject indirectly"
    )


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
    year_to_date: bool = Field(
        description="A running total since January: only its 1y change, against the same period "
        "a year earlier, is given"
    )
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
    direct_subjects: list[DirectSubject] = Field(
        description="What it happened to or who did it, highest priority first"
    )
    impacts: list[IndirectImpact] = Field(
        description="Entities it reaches indirectly: direct links with a loan share, largest "
        "first, then region-level ones, then links without a share"
    )
    triage: "Triage"


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


NodeType = Literal["topic", "group", "entity", "endpoint", "development"]
# The relationship store's types in capitals; MEMBER_OF also links an entity to its peer group in
# the seed. AFFECTS: a development to what it happened to or who did it. IMPACTS: a development to
# an entity it reaches indirectly.
LinkType = Literal[
    "EXPOSED_TO",
    "DEPENDS_ON",
    "PARTICIPATES_IN",
    "OWNS",
    "SUBSIDIARY_OF",
    "OPERATES_IN",
    "SUPERVISED_BY",
    "SHAREHOLDER_OF",
    "MEMBER_OF",
    "LISTED_ON",
    "AFFECTS",
    "IMPACTS",
]


class GraphNode(BaseModel):
    id: str = Field(description="Subject or endpoint id, or dev:<development id>")
    type: NodeType
    label: str
    kind: EntityKind | EndpointKind | None
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
    label: str = Field(description='The link in plain words: "depends on, for cloud services"')
    origin: str = Field(description="relationships, seed, jev, claude or detector")
    confidence: float
    relationship_id: str | None = Field(description="A stored relationship's id")
    route: str | None = Field(description="IMPACTS: the route in plain words")


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


# The roles onboarding asks for (phase1-plan.md, item U3). A role stands in for identity.
Role = Literal["regulatory_supervisor", "tech_cyber_supervisor", "development_staff", "other"]


class Profile(BaseModel):
    """Who is using the app: a role with its own dashboards. Before the first visit picks a role,
    id and role are null and the web shows onboarding."""

    id: str | None
    name: str = Field(description='On the profile button: "TCRD", "FMD" or the role in words')
    role: Role | None
    default_dashboard_id: str | None
    last_visit: date | None = Field(
        default=None,
        description="The role's latest visit before today; New counts from it when set",
    )
    tour_seen_at: datetime | None = Field(
        default=None, description="When the first-run tour last started; null shows it once"
    )


class ProfileCreate(BaseModel):
    """Onboarding's answer: the role and the picks for its first dashboard. Creating it makes the
    dashboard the profile's default and the profile the active one."""

    role: Role
    dashboard_name: str = Field(min_length=1, max_length=80)
    subject_ids: list[SubjectId] = Field(min_length=1)


class Visit(BaseModel):
    path: str = Field(max_length=500, description="The page the app opened on")


class PickerRow(BaseModel):
    subject_id: str
    reason: str | None = Field(
        description='Provider rows only, from the relationship store: "Used by DBS and UOB, for '
        'cloud services"'
    )
    evidence: Evidence | None = Field(description="The weakest grade among the links behind it")


class PickerGroup(BaseModel):
    id: str = Field(description='A group id, "topics", or "mas-supervised"')
    name: str
    rows: list[PickerRow]
    suggested: bool = Field(description="Shown open; the others sit under More to add")


class Suggestions(BaseModel):
    """What the subject picker shows for a role, written by code: groups in the role's order and
    the picks ticked at the start. Without a role, every group is open and nothing is ticked."""

    role: Role | None
    name: str = Field(description="The dashboard name the picks suggest")
    groups: list[PickerGroup]
    picks: list[str] = Field(description="Subject ids ticked at the start")


class MaterialityLevel(BaseModel):
    """A materiality level for Help: what it means and how the app treats it."""

    level: int = Field(ge=0, le=4)
    name: str
    description: str
    material: bool = Field(description="Counted as material, as in the Direction widget")
    needs_attention: bool
    developments: int = Field(
        description="Developments at this level in the latest run, unconfirmed ones left out"
    )


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
    meta: str = Field(description='"OCBC, financial": the lead entity (else subject) and category')
    outlet_count: int = Field(description="As on the development's summary")
    social_count: int = Field(description="As on the development's summary")
    source_types: list[SourceTypeCount] = Field(description="As on the development's summary")
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
    not_relevant: bool = Field(description="Marked as wrongly matched, kept for the eval set")


class TriageChange(BaseModel):
    """Only the states given change. Not relevant also dismisses."""

    read: bool | None = None
    flagged: bool | None = None
    dismissed: bool | None = None
    not_relevant: bool | None = None


class RelatedDays(IntEnum):
    """The Related graph's windows in days: the brief's week, a month and a quarter. An enum, not
    a Literal, so a query string's "7" validates."""

    week = 7
    month = 30
    quarter = 90


class RelatedLink(BaseModel):
    """A stored link between the Related graph's centre and one of its nodes."""

    id: str
    type: RelType
    outbound: bool = Field(description="The centre is the link's from end: DBS owns DBS India")
    label: str = Field(
        description='A few words from the centre: "owns 100%", "24.4% of loans", "depended on by"'
    )


class RelatedNode(BaseModel):
    """A subject or endpoint linked to the centre, with the developments that reach the centre
    through it."""

    id: str
    name: str
    kind: EntityKind | EndpointKind
    subject: SubjectRef | None = Field(description="None when the node is not tracked")
    links: list[RelatedLink] = Field(description="Its links to the centre, either direction")
    development_ids: list[str] = Field(
        description="Shown developments in the window that reach the centre through this node, "
        "in display order"
    )
    harmful: int = Field(description="How many of them are negative for the centre")


class RelatedGraph(BaseModel):
    """Everything linked to a subject in the relationship store, for the Overview's Related
    graph (GET /subjects/{id}/related-graph)."""

    run: RunRef
    center: SubjectRef
    days: RelatedDays
    nodes: list[RelatedNode] = Field(
        description="Most developments first, then most harmful, then by name"
    )
    developments: list[DevelopmentSummary] = Field(
        description="Every development a node lists, in display order"
    )
