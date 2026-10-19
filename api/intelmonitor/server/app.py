"""FastAPI app. Run with `uv run im serve` (behind Portless in development)."""

from collections import Counter
from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

from ag_ui.core import RunAgentInput
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute

from intelmonitor.agent.generate import encode_events
from intelmonitor.pipeline import runlog
from intelmonitor.pipeline.custom import SeriesChoiceError
from intelmonitor.pipeline.params import (
    MATERIALITY_LEVELS,
    MATERIALITY_RUBRIC,
    NEEDS_ATTENTION_LEVEL,
)
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.seed import load_detectors
from intelmonitor.server import alerts as alert_list
from intelmonitor.server import custom_questions as cq
from intelmonitor.server import dashboards as dash
from intelmonitor.server import feedback as fb
from intelmonitor.server import profiles, runs
from intelmonitor.server import series as series_views
from intelmonitor.server import trend as trend_view
from intelmonitor.server import triage as tri
from intelmonitor.server.developments import DevelopmentQuery, development_list
from intelmonitor.server.evidence import development_sources, document_detail, new_documents
from intelmonitor.server.graph import neighbourhood
from intelmonitor.server.impacts import (
    IMPACT_PERIOD_DAYS,
    development_impacts,
    direct_subjects,
    shared_relationships,
    subject_impacts,
)
from intelmonitor.server.linked import linked_institutions
from intelmonitor.server.models import (
    Alerts,
    AnswerEvidence,
    AnswerFeedback,
    AnswerFeedbackRequest,
    DashboardOverview,
    DataSources,
    DataSourceStats,
    DevelopmentDetail,
    DevelopmentList,
    DocumentDetail,
    EntityId,
    Graph,
    LatestRun,
    LinkedInstitution,
    LinkType,
    MaterialityLevel,
    MonitorPage,
    NodeType,
    Note,
    NoteRequest,
    Profile,
    ProfileCreate,
    RelatedDays,
    RelatedGraph,
    Review,
    ReviewRequest,
    Role,
    RunInfo,
    RunStatus,
    SearchResults,
    SharedRelationships,
    SubjectConfidence,
    SubjectDetail,
    SubjectId,
    SubjectImpact,
    SubjectRef,
    SubjectSummary,
    Suggestions,
    TagFeedback,
    TagFeedbackRequest,
    Triage,
    TriageChange,
    Visit,
    WhatChanged,
)
from intelmonitor.server.overview import dashboard_overview, new_count
from intelmonitor.server.queries import (
    MATERIAL_LEVEL,
    NoRunError,
    NotFoundError,
    Queries,
    expand,
    now,
    peers,
    subject,
    subject_ref,
)
from intelmonitor.server.related_graph import related_graph
from intelmonitor.server.search import search as search_all
from intelmonitor.server.widgets import (
    Dashboard,
    DashboardItem,
    DashboardSpec,
    WidgetData,
    WidgetDataRequest,
    WidgetTypeInfo,
    catalog,
    widget_data,
)
from intelmonitor.store.db import connect, get_meta, purge_deleted

WEB_ORIGIN = "https://intelmonitor.web.localhost"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    conn = connect()
    purge_deleted(conn)
    dash.seed_dashboards(conn)
    profiles.seed_profiles(conn)
    tri.seed_follows(conn)
    runlog.interrupt_stale(conn)
    runlog.backfill(conn)
    runlog.migrate(conn)
    conn.close()
    yield


def _operation_id(route: APIRoute) -> str:
    """Operation ids are the handler names, so the generated TS client reads naturally."""
    return route.name


app = FastAPI(
    title="IntelMonitor API",
    lifespan=lifespan,
    generate_unique_id_function=_operation_id,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[WEB_ORIGIN, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotFoundError)
async def _not_found(_: Request, error: NotFoundError) -> JSONResponse:
    return JSONResponse({"detail": f"not found: {error}"}, status_code=404)


@app.exception_handler(NoRunError)
async def _no_run(_: Request, error: NoRunError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=503)


@app.exception_handler(cq.CapReachedError)
async def _cap(_: Request, error: cq.CapReachedError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=409)


@app.exception_handler(SeriesChoiceError)
async def _series_choice(_: Request, error: SeriesChoiceError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=422)


@app.exception_handler(dash.OrderError)
async def _order(_: Request, error: dash.OrderError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=409)


@app.exception_handler(fb.FeedbackError)
async def _feedback(_: Request, error: fb.FeedbackError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=422)


@app.exception_handler(runs.RunInProgressError)
async def _run_in_progress(_: Request, error: runs.RunInProgressError) -> JSONResponse:
    return JSONResponse({"detail": str(error)}, status_code=409)


def _queries() -> Iterator[Queries]:
    conn = connect()
    try:
        yield Queries(conn)
    finally:
        conn.close()


Q = Annotated[Queries, Depends(_queries)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- subjects, monitor pages, search


@app.get("/subjects")
def list_subjects(q: Q) -> list[SubjectSummary]:
    return [q.subject_summary(s) for s in all_subjects()]


@app.get("/subjects/{subject_id}")
def get_subject(q: Q, subject_id: str) -> SubjectDetail:
    return q.subject_detail(subject_id)


@app.get("/subjects/{subject_id}/page")
def get_monitor_page(q: Q, subject_id: str) -> MonitorPage:
    s = subject(subject_id)
    return MonitorPage(
        subject=q.subject_detail(subject_id),
        run=q.run,
        what_changed=q.what_changed([subject_id]),
        questions=q.answers(subject_id),
        custom_question_slots=cq.slots(q.conn).left,
        upcoming=q.upcoming([subject_id]),
        stage_track=q.stage_track(subject_id) if s.type == "topic" else None,
        group=q.group_insights(subject_id) if s.type == "group" else None,
        notes=q.notes(subject_id=subject_id),
        trend=trend_view.has_trend(subject_id),
        brief=q.brief(subject_id),
        impacts=subject_impacts(q, subject_id, IMPACT_PERIOD_DAYS),
    )


@app.get("/subjects/{subject_id}/impacts")
def get_subject_impacts(
    q: Q,
    subject_id: str,
    days: Annotated[int, Query(ge=1, le=365)] = IMPACT_PERIOD_DAYS,
) -> list[SubjectImpact]:
    """Developments in the latest run that reach the subject indirectly through stored
    relationships, last published within `days` of the run date (day, week or month filters).
    Never news about the subject itself."""
    subject(subject_id)
    return subject_impacts(q, subject_id, days)


@app.get("/subjects/{subject_id}/linked")
def get_linked_institutions(q: Q, subject_id: str) -> list[LinkedInstitution]:
    """For a country, sector, technology provider or payment system: the banks and other
    institutions linked to it in the relationship store, directly or through a company they own,
    with the developments of the last 7 days that reach them that way. Empty for other subjects."""
    subject(subject_id)
    return linked_institutions(q, subject_id)


@app.get("/subjects/{subject_id}/related-graph")
def get_related_graph(q: Q, subject_id: str, days: RelatedDays = RelatedDays.week) -> RelatedGraph:
    """Every subject and endpoint linked to the subject in the relationship store, either
    direction, each with its links and the shown developments of the last `days` (7, as the
    brief, 30 or 90) that reach the subject through it, with link-type counts for filters."""
    subject(subject_id)
    return related_graph(q, subject_id, days)


@app.get("/shared")
def get_shared(q: Q, a: EntityId, b: EntityId) -> SharedRelationships:
    """What links both entities in the relationship store: shared vendors, payment systems,
    markets, ventures and memberships, each link with its type and source."""
    if a == b:
        raise HTTPException(422, "shared relationships need two different entities")
    return shared_relationships(q.conn, a, b)


@app.get("/subjects/{subject_id}/trend")
def get_subject_trend(q: Q, subject_id: str) -> trend_view.SubjectTrend:
    """The subject's series over the 12 months to the latest run with its Needs attention and
    Watch developments, each run's note on why the series moved with the developments it cites
    and the facts it was given, and each standing question's state and answer per run."""
    return trend_view.trend(q, subject_id)


@app.get("/subjects/{subject_id}/indicators")
def get_subject_indicators(
    q: Q, subject_id: str, as_of: date | None = None
) -> series_views.SubjectIndicators:
    """The subject's measured series, primary then context, each with its latest value, change
    over 1 week, 1 month, 3 months and 1 year, percentile in its history and state, from what was
    available by the end of `as_of` (default today)."""
    return series_views.subject_indicators(q.conn, subject_id, as_of or date.today())


@app.get("/subjects/{subject_id}/facts")
def get_subject_facts(
    q: Q, subject_id: str, as_of: date | None = None
) -> series_views.SubjectFacts:
    """The facts a run as of `as_of` (default today) gives the subject's standing answers: one per
    series its questions link, written by code from what was available by the end of that day,
    and the states rules fix."""
    return series_views.facts_as_of(q.conn, subject_id, as_of or date.today())


@app.get("/series/{series_id}")
def get_series(
    q: Q,
    series_id: str,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
) -> series_views.SeriesDetail:
    """A series' observations with periods from `from` to `to` (inclusive, both optional) and
    the revisions of those periods."""
    return series_views.series_detail(q.conn, series_id, start, end)


@app.get("/search")
def search(
    q: Q,
    text: Annotated[str, Query(alias="q", min_length=1)],
    limit: Annotated[int, Query(ge=1, le=50)] = 5,
) -> SearchResults:
    """Subjects by name and alias, plus up to `limit` of the latest run's developments and up to
    `limit` of their source documents by full text."""
    return search_all(q, text, limit)


# ---- developments, evidence, documents, graph


@app.get("/developments")
def list_developments(q: Q, query: Annotated[DevelopmentQuery, Query()]) -> DevelopmentList:
    """The latest run's developments in display order, for some subjects, for a dashboard's
    subjects, for an entity's peers, or all of them, narrowed by facet filters, with each
    facet's counts."""
    ids = list(query.subject_id)
    if query.peers_of is not None:
        ids += peers(query.peers_of)
    if query.dashboard_id is not None:
        ids += dash.get_dashboard(q.conn, query.dashboard_id).subject_ids
    # An entity with no peers lists nothing rather than every development.
    return development_list(q, ids if ids or query.peers_of else None, query)


@app.get("/what-changed")
def get_what_changed(
    q: Q,
    subject_id: Annotated[list[str] | None, Query()] = None,
    dashboard_id: str | None = None,
) -> WhatChanged:
    """What changed since the last review of some subjects (groups include their members) or of
    a dashboard's subjects: what a dashboard-wide Since widget counts."""
    ids = [subject(i).id for i in subject_id or []]
    if dashboard_id is not None:
        ids += dash.get_dashboard(q.conn, dashboard_id).subject_ids
    if not ids:
        raise HTTPException(422, "what changed needs a subject_id or a dashboard_id")
    return q.what_changed(ids)


@app.patch("/developments/{development_id}/triage")
def set_triage(q: Q, development_id: str, change: TriageChange) -> Triage:
    """Marks a development read or unread, flagged or not, dismissed or not; states left out of
    the body stay as they are."""
    return tri.set_triage(q, development_id, change)


@app.get("/developments/{development_id}")
def get_development(
    q: Q,
    development_id: str,
    subject_id: Annotated[list[SubjectId] | None, Query()] = None,
    dashboard_id: str | None = None,
) -> DevelopmentDetail:
    """One development with its sources and who it impacts. Priority, adverse and tone are for
    the subjects in view (some subjects or a dashboard's) when given, else over all its
    subjects."""
    ids = list(subject_id or [])
    if dashboard_id is not None:
        ids += dash.get_dashboard(q.conn, dashboard_id).subject_ids
    return _development_detail(q, development_id, ids)


@app.get("/subjects/{subject_id}/answers/{question_id}/evidence")
def get_answer_evidence(q: Q, subject_id: str, question_id: str) -> AnswerEvidence:
    """One answer in the latest run with the developments and sources it relies on."""
    answer = q.answer(subject_id, question_id)
    return AnswerEvidence(
        subject=subject_ref(subject_id),
        run=q.run,
        answer=answer,
        developments=[_development_detail(q, i) for i in answer.development_ids],
        series=series_views.cited_series(
            q.conn,
            q.run,
            subject_id,
            answer.question_id if answer.custom else None,
            answer.series_ids,
        ),
    )


def _development_detail(
    q: Queries, development_id: str, scope: list[str] | None = None
) -> DevelopmentDetail:
    d = q.development(development_id)
    if scope:
        d = q.devs.scoped(d, expand(scope))
    confidence = [
        SubjectConfidence(
            subject=subject_ref(r["subject_id"]), confidence=r["confidence"], source=r["source"]
        )
        for r in q.conn.execute(
            "SELECT subject_id, confidence, source FROM development_subjects "
            "WHERE run_id = ? AND development_id = ? ORDER BY confidence DESC",
            (q.run.id, development_id),
        )
        if r["subject_id"] in all_subjects()
    ]
    row = q.conn.execute(
        "SELECT materiality_confidence, materiality_rule FROM developments "
        "WHERE run_id = ? AND id = ?",
        (q.run.id, development_id),
    ).fetchone()
    rule = row["materiality_rule"]
    detectors = {x.id: x.name for x in load_detectors().detectors}
    return DevelopmentDetail(
        **d.model_dump(),
        run=q.run,
        materiality_confidence=row["materiality_confidence"],
        materiality_rule=detectors.get(rule, rule) if rule else None,
        subject_confidence=confidence,
        tag_feedback=fb.tag_feedback(q, development_id),
        sources=development_sources(
            q.conn,
            q.run.id,
            q.run.as_of,
            development_id,
            new_documents(q.conn, q.run.id, development_id),
        ),
        notes=q.notes(development_id=development_id),
        direct_subjects=direct_subjects(q, development_id),
        impacts=development_impacts(q, development_id),
        triage=tri.triage(q, development_id),
    )


@app.get("/documents/{document_id}")
def get_document(q: Q, document_id: str) -> DocumentDetail:
    doc = document_detail(q.conn, document_id)
    if doc is None:
        raise NotFoundError(f"document {document_id}")
    return doc


@app.get("/graph")
def get_graph(
    q: Q,
    center: str,
    hops: Annotated[int, Query(ge=1, le=2)] = 1,
    node_type: Annotated[list[NodeType] | None, Query()] = None,
    link_type: Annotated[list[LinkType] | None, Query()] = None,
    window_days: Annotated[int | None, Query(ge=1, le=365)] = None,
) -> Graph:
    """The neighbourhood of `center` at 1 or 2 hops. Filters: node types, link types, and a
    time window on development nodes (last source within `window_days` of the run date)."""
    return neighbourhood(
        q,
        center,
        hops,
        set(node_type or NodeType.__args__),
        set(link_type or LinkType.__args__),
        window_days,
    )


# ---- widgets and dashboards


@app.get("/widgets/catalog")
def widget_catalog() -> list[WidgetTypeInfo]:
    return catalog()


@app.post("/widgets/data")
def get_widget_data(q: Q, request: WidgetDataRequest) -> WidgetData:
    """Fill one widget, saved or not (the gallery previews unsaved widgets)."""
    return widget_data(q, request.widget, request.dashboard_subject_ids)


@app.get("/dashboards")
def list_dashboards(q: Q) -> list[DashboardItem]:
    """The active profile's dashboards and those no profile made, in sidebar order, each with
    its new count."""
    return [
        DashboardItem(**d.model_dump(), new_count=new_count(q, d.subject_ids))
        for d in dash.profile_dashboards(q.conn, profiles.active_profile(q).id)
    ]


@app.post("/dashboards", status_code=201)
def create_dashboard(q: Q, spec: DashboardSpec) -> Dashboard:
    """Creates a dashboard for the active profile and follows its subjects."""
    created = dash.create_dashboard(q.conn, spec, profiles.active_profile(q).id)
    tri.follow(q.conn, created.subject_ids)
    return created


# Declared before /dashboards/{dashboard_id} so "order" is not read as an id.
@app.put("/dashboards/order")
def reorder_dashboards(q: Q, ids: Annotated[list[str], Body()]) -> list[Dashboard]:
    """Sets the sidebar order: every dashboard id once, first to last. Colors stay as they are."""
    return dash.reorder_dashboards(q.conn, ids, profiles.active_profile(q).id)


@app.get("/dashboards/{dashboard_id}")
def get_dashboard(q: Q, dashboard_id: str) -> Dashboard:
    return dash.get_dashboard(q.conn, dashboard_id)


@app.put("/dashboards/{dashboard_id}")
def update_dashboard(q: Q, dashboard_id: str, spec: DashboardSpec) -> Dashboard:
    return dash.update_dashboard(q.conn, dashboard_id, spec)


@app.delete("/dashboards/{dashboard_id}", status_code=204)
def delete_dashboard(q: Q, dashboard_id: str) -> None:
    """Soft delete: the dashboard leaves every list and read until it is restored."""
    dash.delete_dashboard(q.conn, dashboard_id)


@app.post("/dashboards/{dashboard_id}/restore")
def restore_dashboard(q: Q, dashboard_id: str) -> Dashboard:
    """Undo a delete; the dashboard returns to its place in the sidebar."""
    return dash.restore_dashboard(q.conn, dashboard_id)


@app.get("/dashboards/{dashboard_id}/overview")
def get_dashboard_overview(q: Q, dashboard_id: str) -> DashboardOverview:
    """The new count, watchlist and upcoming dates that sit beside the dashboard's feed."""
    return dashboard_overview(q, dash.get_dashboard(q.conn, dashboard_id).subject_ids)


@app.get("/dashboards/{dashboard_id}/data")
def get_dashboard_data(q: Q, dashboard_id: str) -> list[WidgetData]:
    """Every widget's data in widget order."""
    d = dash.get_dashboard(q.conn, dashboard_id)
    return [widget_data(q, w, d.subject_ids) for w in d.widgets]


# ---- analyst actions


@app.post("/reviews", status_code=201)
def mark_reviewed(q: Q, request: ReviewRequest) -> list[Review]:
    """Sets each subject's review watermark to the latest run: its What changed then counts from
    later runs. Flags and dismissals stay."""
    return tri.mark_reviewed(q, request.subject_ids)


@app.delete("/reviews/{review_id}", status_code=204)
def undo_review(q: Q, review_id: int) -> None:
    """Undo Mark reviewed: the subject counts from its review before."""
    tri.undo_review(q.conn, review_id)


@app.post("/feedback/tags", status_code=201)
def remove_tag(q: Q, request: TagFeedbackRequest) -> TagFeedback:
    """Marks a development's subject tag wrong. Every later run leaves the tag off it."""
    return fb.remove_tag(q, request)


@app.post("/feedback/answers", status_code=201)
def mark_answer_wrong(q: Q, request: AnswerFeedbackRequest) -> AnswerFeedback:
    """Marks the latest run's answer to a built-in question wrong. The next run's answer prompt
    for the subject sees the correction."""
    return fb.mark_answer_wrong(q, request)


@app.delete("/feedback/{feedback_id}", status_code=204)
def undo_feedback(q: Q, feedback_id: int) -> None:
    """Undo a correction: later runs no longer see it."""
    fb.undo(q.conn, feedback_id)


@app.get("/follows")
def list_follows(q: Q) -> list[SubjectRef]:
    """Followed subjects, oldest first. Alerts cover these."""
    return tri.follows(q.conn)


@app.put("/follows/{subject_id}")
def follow_subject(q: Q, subject_id: str) -> list[SubjectRef]:
    tri.follow(q.conn, [subject_id])
    return tri.follows(q.conn)


@app.delete("/follows/{subject_id}")
def unfollow_subject(q: Q, subject_id: str) -> list[SubjectRef]:
    tri.unfollow(q.conn, subject_id)
    return tri.follows(q.conn)


@app.get("/notes")
def list_notes(
    q: Q, subject_id: str | None = None, development_id: str | None = None
) -> list[Note]:
    return q.notes(subject_id=subject_id, development_id=development_id)


@app.post("/notes", status_code=201)
def add_note(q: Q, request: NoteRequest) -> Note:
    if request.subject_id is None and request.development_id is None:
        raise HTTPException(422, "a note needs a subject_id or a development_id")
    if request.development_id is not None:
        q.development(request.development_id)
    cursor = q.conn.execute(
        "INSERT INTO analyst_actions (kind, subject_id, development_id, text, run_id, created_at) "
        "VALUES ('note', ?, ?, ?, ?, ?)",
        (request.subject_id, request.development_id, request.text.strip(), q.run.id, now()),
    )
    q.conn.commit()
    assert cursor.lastrowid is not None
    return q.note(cursor.lastrowid)


@app.delete("/notes/{note_id}", status_code=204)
def delete_note(q: Q, note_id: int) -> None:
    """Soft delete: the note leaves every list until it is restored."""
    cursor = q.conn.execute(
        "UPDATE analyst_actions SET deleted_at = ? "
        "WHERE id = ? AND kind = 'note' AND deleted_at IS NULL",
        (now(), note_id),
    )
    q.conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"note {note_id}")


@app.post("/notes/{note_id}/restore")
def restore_note(q: Q, note_id: int) -> Note:
    """Undo a delete. Restoring a note that is not deleted changes nothing."""
    q.conn.execute(
        "UPDATE analyst_actions SET deleted_at = NULL WHERE id = ? AND kind = 'note'", (note_id,)
    )
    q.conn.commit()
    return q.note(note_id)


# ---- custom questions


@app.get("/custom-questions")
def list_custom_questions(
    q: Q, subject_id: str | None = None, status: cq.Status | None = None
) -> list[cq.CustomQuestion]:
    return [cq.view(q, i) for i in cq.list_questions(q, subject_id, status)]


@app.post("/custom-questions", status_code=201)
async def draft_custom_question(q: Q, request: cq.CustomQuestionRequest) -> cq.CustomQuestion:
    """Claude drafts the config and the answer job runs for every run; the result is a draft
    with its preview answer until the user keeps it."""
    return await cq.create_draft(q, request)


@app.get("/custom-questions/slots")
def custom_question_slots(q: Q) -> cq.CustomQuestionSlots:
    return cq.slots(q.conn)


@app.get("/custom-questions/{question_id}")
def get_custom_question(q: Q, question_id: str) -> cq.CustomQuestion:
    return cq.view(q, question_id)


@app.post("/custom-questions/{question_id}/keep")
def keep_custom_question(q: Q, question_id: str) -> cq.CustomQuestion:
    return cq.keep(q, question_id)


@app.patch("/custom-questions/{question_id}")
async def edit_custom_question(
    q: Q, question_id: str, change: cq.CustomQuestionEdit
) -> cq.CustomQuestion:
    return await cq.edit(q, question_id, change)


@app.delete("/custom-questions/{question_id}", status_code=204)
def delete_custom_question(q: Q, question_id: str) -> None:
    """Discard a draft or delete a kept question, and drop widgets that show it."""
    cq.delete(q.conn, question_id)
    dash.drop_question_widgets(q.conn, question_id)


# ---- profiles, visits and onboarding (server/profiles.py)


@app.get("/profile")
def get_profile(q: Q) -> Profile:
    """The active profile; id and role are null until the first visit picks a role."""
    return profiles.active_profile(q)


@app.put("/profile")
def update_profile(q: Q, profile: Profile) -> Profile:
    """Sets the active profile's default dashboard and when the tour was seen."""
    return profiles.update_active(q, profile)


@app.get("/profiles")
def list_profiles(q: Q) -> list[Profile]:
    """Every profile for the profile menu's role switch, preloaded departments first."""
    return profiles.list_profiles(q.conn)


@app.post("/profiles", status_code=201)
def create_profile(q: Q, request: ProfileCreate) -> Profile:
    """Onboarding: makes the role's first dashboard from the picks and switches to the role."""
    created = profiles.create_profile(q, request)
    tri.follow(q.conn, request.subject_ids)
    return created


@app.post("/profiles/{profile_id}/activate")
def activate_profile(q: Q, profile_id: str) -> Profile:
    """Switches role: the sidebar then lists that profile's dashboards."""
    return profiles.activate(q, profile_id)


@app.post("/visits", status_code=204)
def log_visit(q: Q, visit: Visit) -> None:
    """Logs an app load with the active role, for counting days with a visit per role."""
    profiles.log_visit(q, visit.path)


@app.get("/onboarding/suggestions")
def onboarding_suggestions(q: Q, role: Role | None = None) -> Suggestions:
    """The subject picker for a role: groups in the role's order and the picks ticked at the
    start, with who uses each provider. Without a role, every group and nothing ticked."""
    return profiles.suggestions(q.conn, role)


@app.get("/materiality-levels")
def materiality_levels(q: Q) -> list[MaterialityLevel]:
    """Materiality levels for Help, most material first, with the latest run's count of shown
    developments at each."""
    counts = Counter(d.materiality_level for d in q.devs.by_id.values())
    return [
        MaterialityLevel(
            level=level,
            name=name,
            description=MATERIALITY_RUBRIC[level],
            material=level >= MATERIAL_LEVEL,
            needs_attention=level >= NEEDS_ATTENTION_LEVEL,
            developments=counts[level],
        )
        for level, name in reversed(list(enumerate(MATERIALITY_LEVELS)))
    ]


# ---- top bar: run status chip, Runs popover, alerts


@app.get("/runs")
def list_runs(q: Q) -> list[RunInfo]:
    """Every run execution, newest first, with how it started and what it found."""
    return runs.list_runs(q.conn)


@app.get("/runs/latest")
def latest_run(q: Q) -> LatestRun:
    """The latest complete run and the date of the latest news it covers."""
    news = max((d.last_published for d in q.devs.by_id.values()), default=None)
    return LatestRun(**q.run.model_dump(), latest_news=min(news, q.run.as_of) if news else None)


@app.get("/runs/status")
def run_status(q: Q) -> RunStatus:
    return runs.status(q.conn)


@app.post("/runs/now", status_code=202)
def run_now(q: Q) -> RunStatus:
    """Recompute Run 2 over the stored corpus in the background; 409 while a run is going."""
    return runs.run_now(q.conn, profiles.active_profile(q).name or "Analyst")


@app.get("/alerts")
def list_alerts(q: Q) -> Alerts:
    return alert_list.alerts(q)


@app.post("/alerts/read")
def mark_alerts_read(q: Q) -> Alerts:
    """Mark every current alert's development read; the alerts stay listed."""
    return alert_list.mark_all_read(q)


@app.get("/data-sources")
def data_sources(q: Q) -> DataSources:
    rows = q.conn.execute(
        "SELECT d.source, d.collection, count(*) AS documents, "
        "coalesce(sum(t.relevant), 0) AS relevant, min(substr(d.published_at, 1, 10)) AS first, "
        "max(substr(d.published_at, 1, 10)) AS last FROM source_documents d "
        "LEFT JOIN document_tags t ON t.document_id = d.id "
        "GROUP BY d.source, d.collection ORDER BY documents DESC"
    ).fetchall()
    t0 = get_meta(q.conn, "t0")
    return DataSources(
        t0=date.fromisoformat(t0) if t0 else None,
        total_documents=sum(r["documents"] for r in rows),
        sources=[
            DataSourceStats(
                source=r["source"],
                collection=r["collection"],
                documents=r["documents"],
                relevant_documents=r["relevant"],
                first_published=r["first"],
                last_published=r["last"],
            )
            for r in rows
        ],
    )


# ---- Generate (AG-UI over SSE)


@app.post("/agent/generate", response_class=StreamingResponse)
async def generate(run: RunAgentInput) -> StreamingResponse:
    """AG-UI run for the New dashboard Generate tab: the page sends the conversation and the
    draft dashboard as state, and gets text, tool call and STATE_DELTA events back over SSE."""
    return StreamingResponse(encode_events(run), media_type="text/event-stream")
