"""FastAPI app. Run with `uv run im serve` (behind Portless in development)."""

from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Annotated

from ag_ui.core import RunAgentInput
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute

from intelmonitor.agent.generate import encode_events
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.server import custom_questions as cq
from intelmonitor.server import dashboards as dash
from intelmonitor.server.evidence import development_sources, document_detail, new_documents
from intelmonitor.server.graph import neighbourhood
from intelmonitor.server.models import (
    AnswerEvidence,
    DataSources,
    DataSourceStats,
    DevelopmentDetail,
    DevelopmentSummary,
    DocumentDetail,
    Graph,
    LinkType,
    MonitorPage,
    NodeType,
    Note,
    NoteRequest,
    Profile,
    Review,
    ReviewRequest,
    RunInfo,
    SearchHit,
    SubjectConfidence,
    SubjectDetail,
    SubjectSummary,
)
from intelmonitor.server.queries import (
    NoRunError,
    NotFoundError,
    Queries,
    aliases,
    now,
    subject,
    subject_ref,
)
from intelmonitor.server.widgets import (
    Dashboard,
    DashboardSpec,
    QuestionWidget,
    WidgetData,
    WidgetDataRequest,
    WidgetTypeInfo,
    catalog,
    widget_data,
)
from intelmonitor.store.db import connect, get_meta, set_meta

WEB_ORIGIN = "https://intelmonitor.web.localhost"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    conn = connect()
    dash.seed_dashboards(conn)
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
        reviewed_at=q.reviewed_at([subject_id]),
        notes=q.notes(subject_id=subject_id),
    )


@app.get("/search")
def search(q: Q, text: Annotated[str, Query(alias="q", min_length=1)]) -> list[SearchHit]:
    """Subjects by name and alias: exact matches first, then prefixes, then word prefixes, then
    substrings."""
    needle = text.strip().lower()
    hits: list[tuple[int, int, SearchHit]] = []
    for position, s in enumerate(all_subjects().values()):
        best: tuple[int, str] | None = None
        for name in [s.name, *aliases(s.id)]:
            low = name.lower()
            if low == needle:
                rank = 0
            elif low.startswith(needle):
                rank = 1
            elif any(w.startswith(needle) for w in low.split()):
                rank = 2
            elif needle in low:
                rank = 3
            else:
                continue
            if best is None or rank < best[0]:
                best = (rank, name)
        if best:
            hit = SearchHit(subject=subject_ref(s.id), matched=best[1])
            hits.append((best[0], position, hit))
    return [h for _, _, h in sorted(hits, key=lambda t: (t[0], t[1]))]


# ---- developments, evidence, documents, graph


@app.get("/developments")
def list_developments(
    q: Q,
    subject_id: Annotated[list[str] | None, Query()] = None,
    changed: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> list[DevelopmentSummary]:
    """The latest run's developments in display order, optionally for some subjects (groups
    include their members) or only those new or updated since the previous run."""
    devs = q.developments_in(subject_id) if subject_id else list(q.devs.by_id.values())
    return [d for d in devs if d.change or not changed][:limit]


@app.get("/developments/{development_id}")
def get_development(q: Q, development_id: str) -> DevelopmentDetail:
    return _development_detail(q, development_id)


@app.get("/subjects/{subject_id}/answers/{question_id}/evidence")
def get_answer_evidence(q: Q, subject_id: str, question_id: str) -> AnswerEvidence:
    """One answer in the latest run with the developments and sources it relies on."""
    answer = q.answer(subject_id, question_id)
    return AnswerEvidence(
        subject=subject_ref(subject_id),
        run=q.run,
        answer=answer,
        developments=[_development_detail(q, i) for i in answer.development_ids],
    )


def _development_detail(q: Queries, development_id: str) -> DevelopmentDetail:
    d = q.development(development_id)
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
        "SELECT materiality_confidence FROM developments WHERE run_id = ? AND id = ?",
        (q.run.id, development_id),
    ).fetchone()
    return DevelopmentDetail(
        **d.model_dump(),
        run=q.run,
        materiality_confidence=row["materiality_confidence"],
        subject_confidence=confidence,
        sources=development_sources(
            q.conn, q.run.id, development_id, new_documents(q.conn, q.run.id, development_id)
        ),
        notes=q.notes(development_id=development_id),
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
        set(node_type or ["topic", "group", "entity", "development"]),
        set(link_type or ["MEMBER_OF", "EXPOSED_TO", "AFFECTS"]),
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
def list_dashboards(q: Q) -> list[Dashboard]:
    return dash.list_dashboards(q.conn)


@app.post("/dashboards", status_code=201)
def create_dashboard(q: Q, spec: DashboardSpec) -> Dashboard:
    return dash.create_dashboard(q.conn, spec)


@app.get("/dashboards/{dashboard_id}")
def get_dashboard(q: Q, dashboard_id: str) -> Dashboard:
    return dash.get_dashboard(q.conn, dashboard_id)


@app.put("/dashboards/{dashboard_id}")
def update_dashboard(q: Q, dashboard_id: str, spec: DashboardSpec) -> Dashboard:
    return dash.update_dashboard(q.conn, dashboard_id, spec)


@app.delete("/dashboards/{dashboard_id}", status_code=204)
def delete_dashboard(q: Q, dashboard_id: str) -> None:
    dash.delete_dashboard(q.conn, dashboard_id)


@app.get("/dashboards/{dashboard_id}/data")
def get_dashboard_data(q: Q, dashboard_id: str) -> list[WidgetData]:
    """Every widget's data in widget order."""
    d = dash.get_dashboard(q.conn, dashboard_id)
    return [widget_data(q, w, d.subject_ids) for w in d.widgets]


# ---- analyst actions


@app.post("/reviews", status_code=201)
def mark_reviewed(q: Q, request: ReviewRequest) -> list[Review]:
    at = now()
    ids = list(dict.fromkeys(request.subject_ids))
    for sid in ids:
        q.conn.execute(
            "INSERT INTO analyst_actions (kind, subject_id, run_id, created_at) "
            "VALUES ('review', ?, ?, ?)",
            (sid, q.run.id, at),
        )
    q.conn.commit()
    return [
        Review(subject_id=sid, run_id=q.run.id, created_at=datetime.fromisoformat(at))
        for sid in ids
    ]


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
    notes = q.notes(request.subject_id, request.development_id)
    return next(n for n in notes if n.id == cursor.lastrowid)


@app.delete("/notes/{note_id}", status_code=204)
def delete_note(q: Q, note_id: int) -> None:
    cursor = q.conn.execute(
        "DELETE FROM analyst_actions WHERE id = ? AND kind = 'note'", (note_id,)
    )
    q.conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"note {note_id}")


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
    for d in dash.list_dashboards(q.conn):
        kept = [
            w
            for w in d.widgets
            if not (isinstance(w, QuestionWidget) and w.settings.question_id == question_id)
        ]
        if len(kept) != len(d.widgets):
            spec = DashboardSpec(name=d.name, subject_ids=d.subject_ids, widgets=kept)
            dash.update_dashboard(q.conn, d.id, spec)


# ---- profile menu: settings, data sources, run history


_DEFAULT_PROFILE = Profile(
    display_name="Analyst", role="Supervisory analyst", default_dashboard_id="singapore-banks"
)


@app.get("/profile")
def get_profile(q: Q) -> Profile:
    stored = get_meta(q.conn, "profile")
    return Profile.model_validate_json(stored) if stored else _DEFAULT_PROFILE


@app.put("/profile")
def update_profile(q: Q, profile: Profile) -> Profile:
    if profile.default_dashboard_id is not None:
        dash.get_dashboard(q.conn, profile.default_dashboard_id)
    set_meta(q.conn, "profile", profile.model_dump_json())
    return profile


@app.get("/runs")
def list_runs(q: Q) -> list[RunInfo]:
    return q.runs()


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
