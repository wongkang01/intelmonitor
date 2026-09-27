"""Correct the AI: the analyst removes a wrong subject tag from a development, or marks a standing
question answer wrong. Both are rows in the feedback table, which the pipeline reads
(pipeline/feedback.py); Undo deletes the row."""

import json
import sqlite3

from intelmonitor.pipeline.subjects import questions_for
from intelmonitor.server.models import (
    AnswerFeedback,
    AnswerFeedbackRequest,
    TagFeedback,
    TagFeedbackRequest,
)
from intelmonitor.server.queries import (
    NotFoundError,
    Queries,
    answer_feedback,
    now,
    subject,
    subject_ref,
)


class FeedbackError(ValueError):
    """The correction does not fit the answer or the development."""


def tag_feedback(q: Queries, development_id: str) -> list[TagFeedback]:
    """Tags removed from the development, oldest first."""
    tagged = {
        str(r["subject_id"])
        for r in q.conn.execute(
            "SELECT subject_id FROM development_subjects WHERE run_id = ? AND development_id = ?",
            (q.run.id, development_id),
        )
    }
    return [
        TagFeedback(
            id=r["id"],
            subject=subject_ref(r["subject_id"]),
            development_id=development_id,
            reason=r["reason"],
            run_id=r["run_id"],
            created_at=r["created_at"],
            applied=r["subject_id"] not in tagged,
        )
        for r in q.conn.execute(
            "SELECT * FROM feedback WHERE kind = 'tag' AND development_id = ? "
            "ORDER BY created_at, id",
            (development_id,),
        )
    ]


def remove_tag(q: Queries, request: TagFeedbackRequest) -> TagFeedback:
    """Records that the tag is wrong; removing it again updates the reason."""
    q.development(request.development_id)
    existing = next(
        (f for f in tag_feedback(q, request.development_id) if f.subject.id == request.subject_id),
        None,
    )
    if existing is not None:
        q.conn.execute(
            "UPDATE feedback SET reason = ? WHERE id = ?", (request.reason.strip(), existing.id)
        )
    else:
        tagged = q.conn.execute(
            "SELECT 1 FROM development_subjects WHERE run_id = ? AND development_id = ? "
            "AND subject_id = ?",
            (q.run.id, request.development_id, request.subject_id),
        ).fetchone()
        if tagged is None:
            raise FeedbackError(
                f"{request.development_id} is not tagged to {request.subject_id} in run {q.run.id}"
            )
        q.conn.execute(
            "INSERT INTO feedback (kind, subject_id, development_id, run_id, reason, created_at) "
            "VALUES ('tag', ?, ?, ?, ?, ?)",
            (request.subject_id, request.development_id, q.run.id, request.reason.strip(), now()),
        )
    q.conn.commit()
    return next(
        f for f in tag_feedback(q, request.development_id) if f.subject.id == request.subject_id
    )


def mark_answer_wrong(q: Queries, request: AnswerFeedbackRequest) -> AnswerFeedback:
    """Records what is wrong with the latest run's answer to a built-in question."""
    if request.question_id not in {d.id for d in questions_for(subject(request.subject_id))}:
        raise FeedbackError(
            f"{request.question_id} is not a built-in question of {request.subject_id}; "
            "runs do not recompute custom answers"
        )
    answer = q.answer(request.subject_id, request.question_id)
    reason = request.reason.strip()
    if request.state == answer.state:
        raise FeedbackError(f"the answer is already {answer.state}")
    if unknown := set(request.development_ids) - set(answer.development_ids):
        raise FeedbackError(f"the answer does not cite {sorted(unknown)}")
    if not (request.state or request.summary_wrong or request.development_ids or reason):
        raise FeedbackError("say what is wrong: the state, the summary, a citation or a reason")
    cursor = q.conn.execute(
        "INSERT INTO feedback (kind, subject_id, question_id, run_id, answer_state, "
        "answer_summary, state, summary_wrong, development_ids, reason, created_at) "
        "VALUES ('answer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            request.subject_id,
            request.question_id,
            q.run.id,
            answer.state,
            answer.summary,
            request.state,
            int(request.summary_wrong),
            json.dumps(list(dict.fromkeys(request.development_ids))),
            reason,
            now(),
        ),
    )
    q.conn.commit()
    row = q.conn.execute("SELECT * FROM feedback WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return answer_feedback(row)


def undo(conn: sqlite3.Connection, feedback_id: int) -> None:
    cursor = conn.execute("DELETE FROM feedback WHERE id = ?", (feedback_id,))
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"feedback {feedback_id}")
