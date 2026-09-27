"""The analyst's corrections (the feedback table), as the pipeline applies them: a removed tag stays
off its development in every later run, and an answer correction is shown to the answer prompt
of the run that recomputes the corrected run and of the run after it."""

import json
import sqlite3
from dataclasses import dataclass


def removed_tags(conn: sqlite3.Connection) -> set[tuple[str, str]]:
    """(development id, subject id) pairs the analyst removed."""
    return {
        (r["development_id"], r["subject_id"])
        for r in conn.execute("SELECT development_id, subject_id FROM feedback WHERE kind = 'tag'")
    }


@dataclass(frozen=True)
class AnswerCorrection:
    question_id: str
    run_id: str
    answer_state: str
    answer_summary: str
    state: str | None
    summary_wrong: bool
    development_ids: list[str]
    reason: str
    created_at: str

    def prompt_line(self) -> str:
        wrong = [f"state should be {self.state}"] if self.state else []
        if self.summary_wrong:
            wrong.append("the summary is wrong")
        if self.development_ids:
            cited = ", ".join(f"D:{i}" for i in self.development_ids)
            wrong.append(f"these cited developments do not support it: {cited}")
        lines = [
            f"- question_id: {self.question_id}",
            f"  answer at {self.run_id}: {self.answer_state}: {self.answer_summary}",
        ]
        if wrong:
            lines.append(f"  marked wrong: {'; '.join(wrong)}")
        if self.reason:
            lines.append(f'  analyst\'s reason: "{self.reason}"')
        return "\n".join(lines)


def answer_corrections(
    conn: sqlite3.Connection, subject_id: str, run_ids: list[str]
) -> list[AnswerCorrection]:
    """Corrections to the subject's answers given while one of `run_ids` was the latest run,
    oldest first."""
    marks = ",".join("?" for _ in run_ids)
    rows = conn.execute(
        f"SELECT * FROM feedback WHERE kind = 'answer' AND subject_id = ? AND run_id IN ({marks}) "
        "ORDER BY created_at, id",
        (subject_id, *run_ids),
    ).fetchall()
    return [
        AnswerCorrection(
            question_id=r["question_id"],
            run_id=r["run_id"],
            answer_state=r["answer_state"],
            answer_summary=r["answer_summary"],
            state=r["state"],
            summary_wrong=bool(r["summary_wrong"]),
            development_ids=json.loads(r["development_ids"]),
            reason=r["reason"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
