"""Step 7: one Claude call per subject per run answers all of the subject's standing questions
from the developments tagged to it (for groups, also to its members) inside each question's
lookback, and from the facts code computed from the series each question links
(pipeline/facts.py). Code keeps only development ids eligible for the question and series ids
linked to it, and fixes the state where a rule fired. The analyst's corrections to this run's or
the previous run's answers go into the prompt."""

import asyncio
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from intelmonitor.pipeline.diff import DevelopmentChange
from intelmonitor.pipeline.facts import SubjectFacts, subject_facts
from intelmonitor.pipeline.feedback import AnswerCorrection, answer_corrections
from intelmonitor.pipeline.inference import Inference, StepFailed
from intelmonitor.pipeline.params import MATERIALITY_LEVELS
from intelmonitor.pipeline.subjects import Subject, all_subjects, monitored_subjects, questions_for
from intelmonitor.pipeline.wording import fx_currency
from intelmonitor.seed import QuestionDef, load_series

# Most developments listed in one answer prompt, most material and most recent first.
MAX_PROMPT_DEVELOPMENTS = 120
UPCOMING_HORIZON_DAYS = 90

State = Literal["stable", "watch", "needs_attention", "new"]
# Calm to severe: a rule that fired raises the state to at least its own.
_SEVERITY: list[State] = ["stable", "new", "watch", "needs_attention"]


class QuestionAnswer(BaseModel):
    question_id: str
    summary: str
    state: State
    development_ids: list[str]
    series_ids: list[str]


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
    adverse: bool  # adverse to at least one of its subjects
    subjects: list[str]
    sources: int


def load_run_developments(conn: sqlite3.Connection, run_id: str) -> list[RunDevelopment]:
    rows = conn.execute(
        "SELECT d.*, (SELECT json_group_array(subject_id) FROM development_subjects s "
        "WHERE s.run_id = d.run_id AND s.development_id = d.id) AS subjects, "
        "(SELECT coalesce(max(adverse), 0) FROM development_subjects s "
        "WHERE s.run_id = d.run_id AND s.development_id = d.id) AS adverse, "
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
            adverse=bool(r["adverse"]),
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
    "are short, specific and based only on the developments and facts provided."
)

# Numbers an answer could invent: decimals and percentages. Whole numbers ("30 days") pass.
_NUMBER = re.compile(r"\d[\d,]*\.\d+%?|\d[\d,]*%")
_PER_CENT = re.compile(r"\s*(?:per ?cent|percent)\b", re.IGNORECASE)


# How answers word exchange rate moves, in the answer prompts of standing and custom questions.
FX_WORDING = """\
- Exchange rates: tell every move by the SGD's side, as the facts do: "SGD weakened 0.55%
  against the MYR on the week". Never say a rate or a pair went up or down ("SGD per MYR up
  0.55%", "SGD weaker against the MYR, up 0.55%") and never write pairs such as SGD/MYR or
  USD/SGD: readers take them the other way round. A level may be named as the facts name it,
  "0.3138 SGD per MYR"."""


def unsupported_numbers(summary: str, allowed: str) -> list[str]:
    """Decimals and percentages in `summary` that appear nowhere in `allowed` (the facts and
    development text the prompt gave), ignoring thousands separators and reading "per cent" as
    "%"."""
    plain = _PER_CENT.sub("%", allowed.replace(",", ""))
    return [n for n in dict.fromkeys(_NUMBER.findall(summary)) if n.replace(",", "") not in plain]


# Currency pair names (SGD/MYR, USD-SGD, SGDMYR), and a rate said to go up or down: after a rate
# or a counter currency ("SGD per USD up 0.23%", "against the MYR, up 0.55%", "vs MYR, up 0.03%",
# "SGD/MYR rose"), or before one with no SGD before the verb ("up 0.03% vs MYR"). Readers take a
# pair or a rate's rise either way round, so answers, custom answers and Trend notes tell FX moves
# only by the SGD's side, as the facts do: "SGD weakened 0.23% against the USD" or "vs the USD".
# Codes are upper case even where the rest of a pattern ignores case.
_PAIR = r"(?-i:SGD ?[/:\-–] ?[A-Z]{3}|[A-Z]{3} ?[/:\-–] ?SGD|SGD[A-Z]{3}|[A-Z]{3}SGD)"
_CODE = r"(?-i:[A-Z]{3})"
_FX_PAIR = re.compile(rf"\b{_PAIR}\b")
_MOVED = (
    r"(?:up|down|rose|fell|rising|falling|higher|lower|gained|lost|climbed|dropped|increased|"
    r"decreased|appreciated|depreciated)"
)
_COUNTER = rf"(?:{_CODE} per {_CODE}|(?:against|vs\.?|versus) (?:the )?{_CODE}|{_PAIR})"
# A word or a number, and up to three of them between the rate and the verb ("against the MYR
# on the week, up"); a gap never crosses the end of a sentence or clause.
_WORD = r"(?:\d[\d.,]*%?|[^\s.;]+?)"
_GAP = rf"(?:[\s,:()]+{_WORD}){{0,3}}?[\s,:()]+"
_FX_RATE_MOVE = re.compile(
    rf"\b{_COUNTER}{_GAP}(?:(?:was|is|has|had)\s+)?{_MOVED}\b"
    rf"|(?<!SGD )\b{_MOVED}(?:[\s,]+{_WORD}){{0,2}}?[\s,]+"
    rf"(?:against|vs\.?|versus) (?:the )?{_CODE}\b",
    re.IGNORECASE,
)


def fx_pairs(summary: str) -> list[str]:
    """Currency pair names in `summary`, which an answer on FX series may not use."""
    return list(dict.fromkeys(_FX_PAIR.findall(summary)))


def fx_rate_moves(summary: str) -> list[str]:
    """Phrases in `summary` that move a rate up or down instead of saying how the SGD moved."""
    return list(dict.fromkeys(m.group(0) for m in _FX_RATE_MOVE.finditer(summary)))


def answer_problems(summary: str, allowed: str, fx: bool) -> list[str]:
    """Why an answer is asked again: numbers found in neither the facts nor the developments
    (`allowed`), and, for a question with FX series (`fx`), currency pair names and rates said
    to go up or down."""
    problems: list[str] = []
    if nums := unsupported_numbers(summary, allowed):
        problems.append(f"numbers in neither the facts nor the developments: {', '.join(nums)}")
    if fx and (pairs := fx_pairs(summary)):
        problems.append(
            f"currency pairs {', '.join(pairs)}: say how the SGD moved against the currency, "
            'as the facts do ("SGD weakened 0.32% against the MYR")'
        )
    if fx and (moves := fx_rate_moves(summary)):
        quoted = ", ".join(f'"{m}"' for m in moves)
        problems.append(
            f"rates said to go up or down ({quoted}): say only how the SGD moved against the "
            'currency, as the facts do ("SGD weakened 0.32% against the MYR")'
        )
    return problems


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
    corrections: list[AnswerCorrection],
    facts: SubjectFacts,
    problems: dict[str, list[str]],
) -> str:
    names = all_subjects()

    def line(d: RunDevelopment) -> str:
        flags = [MATERIALITY_LEVELS[d.level]]
        if d.stage:
            flags.append(f"stage {d.stage}")
        if d.adverse:
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
    asked = {q.id for q in questions}
    if stated := [f for f in facts.facts if asked & set(f.question_ids)]:
        parts += [
            "",
            "Facts computed by code from official statistics and market data available by the "
            "run date:",
        ]
        parts += [f"- S:{f.series_id} | {f.text}" for f in stated]
    if previous:
        parts += ["", f"Answers at the previous run ({base_as_of}):"]
        parts += [f"- {qid}: {state}: {summary}" for qid, (state, summary) in previous.items()]
    if wanted := [c for c in corrections if c.question_id in asked]:
        parts += [
            "",
            "The analyst marked these answers wrong. Take their corrections into account where "
            "the developments still bear them out:",
        ]
        parts += [c.prompt_line() for c in wanted]
    if problems:
        parts += [
            "",
            "Your last answers to these questions broke the rules below. Answer them again, "
            "quoting numbers only as the facts and developments give them:",
        ]
        parts += [f"- {qid}: {'; '.join(found)}" for qid, found in problems.items()]
    parts += [
        "",
        "Questions. Answer each one using only the developments eligible for it and the facts of "
        "its series.",
    ]
    for q in questions:
        eligible = ", ".join(f"D:{d.id}" for d in _eligible(q, devs, as_of)) or "none"
        entry = (
            f"- question_id: {q.id}\n  question: {q.question}\n"
            f"  lookback: {q.lookback_days} days\n  eligible: {eligible}"
        )
        if q.series:
            linked = ", ".join(f"S:{f.series_id}" for f in facts.for_question(q.id)) or "none"
            entry += f"\n  series: {linked}"
        for fixed in facts.fixed(q.id):
            entry += f"\n  fixed state: {fixed.state}, because {fixed.text}"
        parts.append(entry)
    parts += [
        "",
        f"""For each question return:
- question_id.
- summary: one line of at most 25 words, plain and specific (name the bodies, entities and
  actions). If nothing eligible bears on the question, say so briefly, for example "No new
  enforcement actions in the last 30 days."
- Numbers: quote only numbers the facts or developments give, as they give them; never compute,
  convert or estimate new ones. Where a question has series, say what their facts show.
{FX_WORDING}
- state, calm by default. A question with a fixed state takes that state, and its summary says
  why:
  - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now,
    such as enforcement, an incident, stress, a depeg or escalation, and it is Significant or
    Critical.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive, however significant.
  - stable: nothing relevant happened in the lookback.
- development_ids: the eligible ids the answer relies on, without the "D:" prefix, most
  important first. Empty if none.
- series_ids: the question's series whose facts the answer relies on, without the "S:" prefix.
  Empty if none.""",
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
) -> int:
    """Answers the subject's questions and stores them with the facts they were given. Returns
    how many answers still quote a number found in neither the facts nor the developments or,
    on FX series, a currency pair."""
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
    corrections = answer_corrections(conn, subject.id, [run_id, *([base_id] if base_id else [])])
    revised_since = date.fromisoformat(base_id) if base_id else None
    facts = subject_facts(conn, subject.id, questions, as_of, revised_since)
    # What answers may quote numbers from: the facts, and the developments and dates listed.
    allowed = "\n".join(
        [f.text for f in facts.facts]
        + [d.title for d in devs]
        + [f"{when} {label}" for when, label, _ in upcoming]
    )

    defs = {s.id: s for s in load_series().series}
    fx = {
        q.id
        for q in questions
        if any(fx_currency(defs[f.series_id]) for f in facts.for_question(q.id))
    }
    answered: dict[str, QuestionAnswer] = {}
    problems: dict[str, list[str]] = {}
    pending = questions
    for attempt in range(2):
        prompt = answer_prompt(
            subject,
            as_of,
            pending,
            devs,
            changes,
            upcoming,
            previous,
            base_as_of,
            corrections,
            facts,
            problems,
        )
        ref = f"subject:{subject.id}" + (f":retry{attempt}" if attempt else "")
        result = await inf.claude("answer", ref, prompt, SubjectAnswers, ANSWER_SYSTEM)
        wanted = {q.id for q in pending}
        got = {a.question_id: a for a in result.answers if a.question_id in wanted}
        answered |= got
        problems = {
            qid: found
            for qid, a in got.items()
            if (found := answer_problems(a.summary, allowed, qid in fx))
        }
        pending = [q for q in questions if q.id not in answered or q.id in problems]
        if not pending:
            break
    if missing := [q.id for q in questions if q.id not in answered]:
        raise RuntimeError(f"no answer for {missing}")

    with conn:
        conn.execute(
            "DELETE FROM question_answers WHERE run_id = ? AND subject_id = ?",
            (run_id, subject.id),
        )
        conn.execute(
            "DELETE FROM run_facts WHERE run_id = ? AND subject_id = ?", (run_id, subject.id)
        )
        conn.executemany(
            "INSERT INTO run_facts (run_id, subject_id, series_id, fact) VALUES (?, ?, ?, ?)",
            [(run_id, subject.id, f.series_id, f.model_dump_json()) for f in facts.facts],
        )
        for q in questions:
            a = answered[q.id]
            eligible = {d.id for d in _eligible(q, devs, as_of)}
            cited = [i.removeprefix("D:") for i in a.development_ids]
            cited = [i for i in dict.fromkeys(cited) if i in eligible]
            linked = {f.series_id for f in facts.for_question(q.id)}
            series = [i.removeprefix("S:") for i in a.series_ids]
            series = [i for i in dict.fromkeys(series) if i in linked]
            fixed = facts.fixed(q.id)
            states: list[State] = [a.state, *(f.state for f in fixed)]
            state = max(states, key=_SEVERITY.index)
            conn.execute(
                "INSERT INTO question_answers (run_id, subject_id, question_id, summary, state, "
                "new_count, development_ids, series_ids, state_rules) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    subject.id,
                    q.id,
                    a.summary.strip(),
                    state,
                    len(cited) if state == "new" else 0,
                    json.dumps(cited),
                    json.dumps(series),
                    json.dumps([f.text for f in fixed]),
                ),
            )
    return len(problems)


async def answer_subjects(
    inf: Inference,
    conn: sqlite3.Connection,
    run_id: str,
    as_of: date,
    changes: dict[str, DevelopmentChange],
    base_id: str | None,
) -> int:
    """Answers every subject's questions. Returns how many answers, after one retry, still quote
    a number found in neither their facts nor their developments or, on FX series, a currency
    pair."""
    devs = load_run_developments(conn, run_id)
    failures: list[str] = []
    unsupported = 0

    async def one(subject: Subject) -> None:
        nonlocal unsupported
        try:
            # Awaited before adding, so concurrent subjects do not overwrite each other's counts.
            n = await answer_subject(inf, conn, run_id, as_of, subject, devs, changes, base_id)
            unsupported += n
        except Exception as error:
            failures.append(f"{subject.id}: {type(error).__name__}: {error}")

    await asyncio.gather(*(one(s) for s in monitored_subjects().values()))
    if failures:
        raise StepFailed("answer", failures)
    return unsupported
