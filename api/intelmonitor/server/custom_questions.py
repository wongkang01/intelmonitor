"""Custom standing questions: draft (Claude config plus a preview answer for every run), keep,
edit, delete. Drafts are stored so the preview can be kept without answering again. A question
can name series of its subject, whose facts its answers get (docs/archive/structured-data-plan.md,
F7)."""

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.pipeline.custom import (
    MAX_LOOKBACK_DAYS,
    MAX_SERIES,
    CustomConfig,
    answer_all_runs,
    check_series,
    draft_config,
    store_answers,
)
from intelmonitor.pipeline.inference import Inference
from intelmonitor.seed import load_series
from intelmonitor.server.models import (
    DevelopmentSummary,
    QuestionAnswerView,
    RunRef,
    SeriesInfo,
    State,
    SubjectId,
    SubjectRef,
)
from intelmonitor.server.queries import NotFoundError, Queries, QuestionDefView, now, subject_ref
from intelmonitor.server.series import series_info
from intelmonitor.server.widgets import CUSTOM_PREFIX

MAX_CUSTOM_QUESTIONS = 10

Status = Literal["draft", "kept"]


class CapReachedError(RuntimeError):
    """The user already keeps MAX_CUSTOM_QUESTIONS custom questions."""

    def __init__(self) -> None:
        super().__init__(
            f"You have {MAX_CUSTOM_QUESTIONS} custom focus areas, the most allowed. "
            "Delete one to add another."
        )


class CustomQuestionSlots(BaseModel):
    limit: int = Field(description="The most custom questions a user can keep")
    kept: int
    left: int


class CustomQuestionRequest(BaseModel):
    text: str = Field(min_length=5, max_length=500, description="What the user typed")
    subject_id: SubjectId | None = Field(
        default=None, description="The monitor page's subject; empty lets Claude pick one"
    )
    series_ids: list[str] | None = Field(
        default=None,
        max_length=MAX_SERIES,
        description="Listed series of the subject whose facts the answers get; empty lets "
        "Claude pick those the text names or needs",
    )


class CustomQuestionEdit(BaseModel):
    question: str | None = Field(default=None, min_length=5, max_length=500)
    label: str | None = Field(default=None, min_length=1, max_length=40)
    lookback_days: int | None = Field(default=None, ge=1, le=MAX_LOOKBACK_DAYS)
    series_ids: list[str] | None = Field(
        default=None, max_length=MAX_SERIES, description="Empty keeps them; [] removes them"
    )


class CustomRunAnswer(BaseModel):
    run: RunRef
    summary: str
    state: State
    development_ids: list[str]
    document_ids: list[str]
    series_ids: list[str] = Field(description="Series whose facts the answer cites")


class CustomQuestion(BaseModel):
    id: str
    subject: SubjectRef
    request: str
    question: str
    label: str
    lookback_days: int
    series: list[SeriesInfo] = Field(description="Series whose facts its answers get, in order")
    status: Status
    created_at: datetime
    updated_at: datetime
    answer: QuestionAnswerView | None = Field(description="Latest run, with its change badge")
    runs: list[CustomRunAnswer] = Field(description="One answer per run, oldest first")
    evidence: list[DevelopmentSummary] = Field(description="Developments the answer cites")


def _row(conn: sqlite3.Connection, question_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM custom_questions WHERE id = ?", (question_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"custom question {question_id}")
    return row


def kept_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT count(*) FROM custom_questions WHERE status = 'kept'").fetchone()[0]


def slots(conn: sqlite3.Connection) -> CustomQuestionSlots:
    kept = kept_count(conn)
    return CustomQuestionSlots(
        limit=MAX_CUSTOM_QUESTIONS, kept=kept, left=max(0, MAX_CUSTOM_QUESTIONS - kept)
    )


def keep_ids(conn: sqlite3.Connection, question_ids: list[str]) -> None:
    """Keeps the drafts among `question_ids`, all or none: raises CapReachedError when they would
    go over the cap. Used by Keep and by saving a dashboard whose widgets show drafts."""
    marks = ",".join("?" * len(question_ids))
    drafts = [
        r["id"]
        for r in conn.execute(
            f"SELECT id FROM custom_questions WHERE status = 'draft' AND id IN ({marks})",
            question_ids,
        )
    ]
    if not drafts:
        return
    if kept_count(conn) + len(drafts) > MAX_CUSTOM_QUESTIONS:
        raise CapReachedError()
    conn.executemany(
        "UPDATE custom_questions SET status = 'kept', updated_at = ? WHERE id = ?",
        [(now(), i) for i in drafts],
    )
    conn.commit()


def view(q: Queries, question_id: str) -> CustomQuestion:
    r = _row(q.conn, question_id)
    qdef = QuestionDefView(r["id"], r["label"], r["question"], r["lookback_days"], True)
    answers = q.answers(r["subject_id"], [qdef])
    runs = [
        CustomRunAnswer(
            run=RunRef(id=a["id"], as_of=a["as_of"], previous_run_id=a["previous_run_id"]),
            summary=a["summary"],
            state=a["state"],
            development_ids=json.loads(a["development_ids"]),
            document_ids=json.loads(a["document_ids"]),
            series_ids=json.loads(a["series_ids"]),
        )
        for a in q.conn.execute(
            "SELECT a.*, r.id, r.as_of, r.previous_run_id FROM custom_question_answers a "
            "JOIN runs r ON r.id = a.run_id WHERE a.question_id = ? ORDER BY r.as_of",
            (question_id,),
        )
    ]
    answer = answers[0] if answers else None
    by_id = {s.id: s for s in load_series().series}
    return CustomQuestion(
        id=r["id"],
        subject=subject_ref(r["subject_id"]),
        request=r["request"],
        question=r["question"],
        label=r["label"],
        lookback_days=r["lookback_days"],
        series=[series_info(by_id[i]) for i in json.loads(r["series_ids"]) if i in by_id],
        status=r["status"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
        answer=answer,
        runs=runs,
        evidence=[q.development(i) for i in answer.development_ids] if answer else [],
    )


def list_questions(q: Queries, subject_id: str | None, status: Status | None) -> list[str]:
    rows = q.conn.execute(
        "SELECT id FROM custom_questions WHERE (? IS NULL OR subject_id = ?) "
        "AND (? IS NULL OR status = ?) ORDER BY created_at",
        (subject_id, subject_id, status, status),
    ).fetchall()
    return [r["id"] for r in rows]


async def create_draft(q: Queries, request: CustomQuestionRequest) -> CustomQuestion:
    """Draft the config and answer every run, then store the draft and its answers together.
    No transaction stays open across the model calls, so parallel drafts do not lock the store."""
    if kept_count(q.conn) >= MAX_CUSTOM_QUESTIONS:
        raise CapReachedError()
    config = await draft_config(
        Inference(q.conn, None), request.text, request.subject_id, request.series_ids
    )
    question_id = f"{CUSTOM_PREFIX}{uuid.uuid4().hex[:10]}"
    answers = await answer_all_runs(q.conn, question_id, config)
    at = now()
    q.conn.execute(
        "INSERT INTO custom_questions (id, subject_id, question, label, lookback_days, request, "
        "status, created_at, updated_at, series_ids) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
        (
            question_id,
            config.subject_id,
            config.question,
            config.label,
            config.lookback_days,
            request.text,
            at,
            at,
            json.dumps(config.series_ids),
        ),
    )
    store_answers(q.conn, question_id, answers)
    q.conn.commit()
    return view(q, question_id)


def keep(q: Queries, question_id: str) -> CustomQuestion:
    _row(q.conn, question_id)
    keep_ids(q.conn, [question_id])
    return view(q, question_id)


async def edit(q: Queries, question_id: str, change: CustomQuestionEdit) -> CustomQuestion:
    """Apply the edit; a new wording, lookback or set of series answers the question again for
    every run first, and the edit and its answers are stored together."""
    r = _row(q.conn, question_id)
    stored: list[str] = json.loads(r["series_ids"])
    config = CustomConfig(
        subject_id=r["subject_id"],
        question=change.question or r["question"],
        label=change.label or r["label"],
        lookback_days=change.lookback_days or r["lookback_days"],
        series_ids=stored
        if change.series_ids is None
        else check_series(r["subject_id"], change.series_ids),
    )
    answers = None
    if (
        config.question != r["question"]
        or config.lookback_days != r["lookback_days"]
        or config.series_ids != stored
    ):
        answers = await answer_all_runs(q.conn, question_id, config)
        _row(q.conn, question_id)  # deleted while answering
    q.conn.execute(
        "UPDATE custom_questions SET question = ?, label = ?, lookback_days = ?, series_ids = ?, "
        "updated_at = ? WHERE id = ?",
        (
            config.question,
            config.label,
            config.lookback_days,
            json.dumps(config.series_ids),
            now(),
            question_id,
        ),
    )
    if answers is not None:
        store_answers(q.conn, question_id, answers)
    q.conn.commit()
    return view(q, question_id)


def delete(conn: sqlite3.Connection, question_id: str) -> None:
    _row(conn, question_id)
    conn.execute("DELETE FROM custom_question_answers WHERE question_id = ?", (question_id,))
    conn.execute("DELETE FROM custom_questions WHERE id = ?", (question_id,))
    conn.commit()
