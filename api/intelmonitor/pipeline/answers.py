"""Step 7: one Claude call per subject per run answers all of the subject's standing questions
from the developments tagged to it (for groups, also to its members) inside each question's
lookback. Code keeps only development ids that were eligible for the question."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from intelmonitor.pipeline.diff import DevelopmentChange
from intelmonitor.pipeline.inference import Inference, StepFailed
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.subjects import Subject, all_subjects, questions_for
from intelmonitor.seed import QuestionDef

# Most developments listed in one answer prompt, most material and most recent first.
MAX_PROMPT_DEVELOPMENTS = 120
UPCOMING_HORIZON_DAYS = 90

State = Literal["stable", "watch", "needs_attention", "new"]


class QuestionAnswer(BaseModel):
    question_id: str
    summary: str
    state: State
    development_ids: list[str]


class SubjectAnswers(BaseModel):
    answers: list[QuestionAnswer]


@dataclass(frozen=True)
class RunDevelopment:
    id: str
    title: str
    category: str
    stage: str | None
    last_published: date
    level: int
    adverse: float
    subjects: list[str]
    sources: int


def load_run_developments(conn: sqlite3.Connection, run_id: str) -> list[RunDevelopment]:
    rows = conn.execute(
        "SELECT d.*, (SELECT json_group_array(subject_id) FROM development_subjects s "
        "WHERE s.run_id = d.run_id AND s.development_id = d.id) AS subjects, "
        "(SELECT count(DISTINCT document_id) FROM development_sources s "
        "WHERE s.run_id = d.run_id AND s.development_id = d.id) AS sources "
        "FROM developments d WHERE d.run_id = ?",
        (run_id,),
    ).fetchall()
    return [
        RunDevelopment(
            id=r["id"],
            title=r["title"],
            category=r["category"],
            stage=r["stage"],
            last_published=date.fromisoformat(r["last_published"]),
            level=r["materiality_level"],
            adverse=r["adverse"],
            subjects=json.loads(r["subjects"]),
            sources=r["sources"],
        )
        for r in rows
    ]


def scope(subject: Subject) -> set[str]:
    """Subject ids whose developments count for `subject`: itself, plus members for a group."""
    return {subject.id, *subject.members}


ANSWER_SYSTEM = (
    "You answer standing questions for a financial supervisor's monitoring dashboard. Answers "
    "are short, specific and based only on the developments provided."
)


def _eligible(q: QuestionDef, devs: list[RunDevelopment], as_of: date) -> list[RunDevelopment]:
    since = as_of - timedelta(days=q.lookback_days)
    return [d for d in devs if d.last_published > since]


def answer_prompt(
    subject: Subject,
    as_of: date,
    questions: list[QuestionDef],
    devs: list[RunDevelopment],
    changes: dict[str, DevelopmentChange],
    upcoming: list[tuple[str, str, str]],
    previous: dict[str, tuple[str, str]],
    base_as_of: str | None,
) -> str:
    names = all_subjects()

    def line(d: RunDevelopment) -> str:
        flags = [MATERIALITY_LEVELS[d.level]]
        if d.stage:
            flags.append(f"stage {d.stage}")
        if d.adverse >= 0.5:
            flags.append("adverse")
        if c := changes.get(d.id):
            flags.append("new since last run" if c.kind == "new_development" else "new sources")
        tagged = ", ".join(names[s].name for s in d.subjects if s in names)
        return (
            f"- D:{d.id} | last source {d.last_published} | {d.sources} source(s) | "
            f"{'; '.join(flags)} | {d.category} | {tagged}\n  {d.title}"
        )

    scope_note = " or its members" if subject.members else ""
    parts = [
        f"Run date: {as_of}. Subject: {subject.description}.",
        "",
        f"Developments tagged to this subject{scope_note}:",
        "\n".join(line(d) for d in devs) or "(none)",
    ]
    if upcoming:
        parts += ["", "Upcoming dates:"]
        parts += [f"- {when}: {label} (D:{dev_id})" for when, label, dev_id in upcoming]
    if previous:
        parts += ["", f"Answers at the previous run ({base_as_of}):"]
        parts += [f"- {qid}: {state}: {summary}" for qid, (state, summary) in previous.items()]
    parts += ["", "Questions. Answer each one using only the developments eligible for it."]
    for q in questions:
        eligible = ", ".join(f"D:{d.id}" for d in _eligible(q, devs, as_of)) or "none"
        parts.append(
            f"- question_id: {q.id}\n  question: {q.question}\n"
            f"  lookback: {q.lookback_days} days\n  eligible: {eligible}"
        )
    parts += [
        "",
        """For each question return:
- question_id.
- summary: one line of at most 25 words, plain and specific (name the bodies, entities and
  actions). If nothing eligible bears on the question, say so briefly, for example "No new
  enforcement actions in the last 30 days."
- state, calm by default:
  - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now,
    such as enforcement, an incident, stress, a depeg or escalation, and it is Significant or
    Critical.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive, however significant.
  - stable: nothing relevant happened in the lookback.
- development_ids: the eligible ids the answer relies on, without the "D:" prefix, most
  important first. Empty if none.""",
    ]
    return "\n".join(parts)


async def answer_subject(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    subject: Subject,
    all_devs: list[RunDevelopment],
    changes: dict[str, DevelopmentChange],
    base_id: str | None,
) -> None:
    questions = questions_for(subject)
    ids = scope(subject)
    longest = max(q.lookback_days for q in questions)
    devs = [
        d
        for d in all_devs
        if ids & set(d.subjects) and d.last_published > as_of - timedelta(days=longest)
    ]
    devs = sorted(devs, key=lambda d: (-d.level, -d.last_published.toordinal(), d.id))
    devs = devs[:MAX_PROMPT_DEVELOPMENTS]
    dev_ids = {d.id for d in devs}
    upcoming = [
        (r["date"], r["label"], r["development_id"])
        for r in conn.execute(
            "SELECT date, label, development_id FROM upcoming_dates WHERE run_id = ? "
            "AND date <= ? ORDER BY date",
            (run_id, (as_of + timedelta(days=UPCOMING_HORIZON_DAYS)).isoformat()),
        )
        if r["development_id"] in dev_ids
    ]
    previous = {
        r["question_id"]: (r["state"], r["summary"])
        for r in conn.execute(
            "SELECT question_id, state, summary FROM question_answers "
            "WHERE run_id = ? AND subject_id = ?",
            (base_id, subject.id),
        )
    }
    base_as_of = base_id  # run ids are their as-of dates

    answered: dict[str, QuestionAnswer] = {}
    pending = questions
    for attempt in range(2):
        prompt = answer_prompt(
            subject, as_of, pending, devs, changes, upcoming, previous, base_as_of
        )
        ref = f"subject:{subject.id}" + (f":retry{attempt}" if attempt else "")
        result = await inf.claude("answer", ref, prompt, SubjectAnswers, ANSWER_SYSTEM)
        wanted = {q.id for q in pending}
        answered |= {a.question_id: a for a in result.answers if a.question_id in wanted}
        pending = [q for q in questions if q.id not in answered]
        if not pending:
            break
    if pending:
        raise RuntimeError(f"no answer for {[q.id for q in pending]}")

    conn.execute(
        "DELETE FROM question_answers WHERE run_id = ? AND subject_id = ?", (run_id, subject.id)
    )
    for q in questions:
        a = answered[q.id]
        eligible = {d.id for d in _eligible(q, devs, as_of)}
        cited = [i.removeprefix("D:") for i in a.development_ids]
        cited = [i for i in dict.fromkeys(cited) if i in eligible]
        conn.execute(
            "INSERT INTO question_answers (run_id, subject_id, question_id, summary, state, "
            "new_count, development_ids) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                subject.id,
                q.id,
                a.summary.strip(),
                a.state,
                len(cited) if a.state == "new" else 0,
                json.dumps(cited),
            ),
        )
    conn.commit()


async def answer_subjects(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    changes: dict[str, DevelopmentChange],
    base_id: str | None,
) -> None:
    devs = load_run_developments(conn, run_id)
    failures: list[str] = []

    async def one(subject: Subject) -> None:
        try:
            await answer_subject(inf, conn, run_id, as_of, subject, devs, changes, base_id)
        except Exception as error:
            failures.append(f"{subject.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(s) for s in all_subjects().values()))
    if failures:
        raise StepFailed("answer", failures)
