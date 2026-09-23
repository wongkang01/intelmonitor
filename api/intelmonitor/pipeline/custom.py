"""Step 8: custom standing questions. Claude turns what the user typed into a question config,
then the answer job runs on demand over the stored corpus for every complete run, oldest first:
Jev scores each document tagged to the subject inside the lookback ("Does this document help
answer: ...?"), and Claude answers from the top matches, citing the run's developments."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel, Field
from typesafe_sdk import Noul

from intelmonitor.pipeline.answers import State, scope
from intelmonitor.pipeline.inference import Inference, noul
from intelmonitor.pipeline.subjects import all_subjects

DEFAULT_LOOKBACK_DAYS = 14
MAX_LOOKBACK_DAYS = 60
TOP_DOCUMENTS = 8
MIN_MATCH = 0.5


class CustomConfig(BaseModel):
    subject_id: str
    question: str = Field(description="The question, tidied into one clear sentence")
    label: str = Field(description="A short label of one to three words, sentence case")
    lookback_days: int = Field(description="How many days back the answer reads")


DRAFT_SYSTEM = (
    "You turn an analyst's request into a standing question for a financial supervisor's "
    "monitoring dashboard. Standing questions are answered every run from news and official "
    "documents about one tracked subject."
)


def draft_prompt(text: str, subject_id: str | None) -> str:
    subjects = "\n".join(f"- {s.id}: {s.name} ({s.type})" for s in all_subjects().values())
    pinned = (
        f"The question is about the subject {subject_id}; use that subject_id."
        if subject_id
        else "Pick the one tracked subject the request is most about."
    )
    return f"""Tracked subjects:
{subjects}

The analyst wrote: "{text}"

{pinned}
Return:
- subject_id: one id from the list.
- question: the request as one clear, specific question a weekly run can answer from
  documents, keeping the analyst's intent. No preamble.
- label: one to three words, sentence case, for a widget title.
- lookback_days: {DEFAULT_LOOKBACK_DAYS} unless the request implies a different window
  (at most {MAX_LOOKBACK_DAYS})."""


async def draft_config(inf: Inference, text: str, subject_id: str | None) -> CustomConfig:
    prompt = draft_prompt(text, subject_id)
    ref = f"request:{subject_id}"
    out = await inf.claude("custom_draft", ref, prompt, CustomConfig, DRAFT_SYSTEM)
    chosen = subject_id or out.subject_id
    if chosen not in all_subjects():
        raise ValueError(f"Claude picked an unknown subject {out.subject_id!r}")
    return CustomConfig(
        subject_id=chosen,
        question=out.question.strip(),
        label=out.label.strip()[:40],
        lookback_days=min(max(out.lookback_days, 1), MAX_LOOKBACK_DAYS),
    )


@dataclass
class Candidate:
    document_id: str
    title: str
    domain: str
    published: str
    statements: list[str]
    quotes: list[str]
    development_ids: set[str]


def candidates(
    conn: sqlite3.Connection, run_id: str, as_of: date, config: CustomConfig
) -> list[Candidate]:
    """Documents in the lookback with findings tagged to the subject (or a group's members)
    that belong to one of the run's developments."""
    ids = scope(all_subjects()[config.subject_id])
    since = as_of - timedelta(days=config.lookback_days)
    out: dict[str, Candidate] = {}
    for r in conn.execute(
        "SELECT f.statement, f.subjects, f.quotes, s.development_id, d.id, d.title, d.domain, "
        "substr(d.published_at, 1, 10) AS published FROM development_sources s "
        "JOIN findings f ON f.id = s.finding_id JOIN source_documents d ON d.id = s.document_id "
        "WHERE s.run_id = ? AND substr(d.published_at, 1, 10) > ? ORDER BY d.published_at, f.id",
        (run_id, since.isoformat()),
    ):
        if not ids & set(json.loads(r["subjects"])):
            continue
        c = out.get(r["id"])
        if c is None:
            c = out[r["id"]] = Candidate(
                r["id"], r["title"], r["domain"], r["published"], [], [], set()
            )
        c.statements.append(r["statement"])
        c.quotes.append(json.loads(r["quotes"])[0]["text"])
        c.development_ids.add(r["development_id"])
    return list(out.values())


def _document_state(c: Candidate) -> str:
    findings = "\n".join(f"- {s}" for s in c.statements)
    return f"{c.title}\nPublished {c.published} by {c.domain}.\nFindings:\n{findings}"


async def match(inf: Inference, question: str, c: Candidate) -> float:
    answers = await inf.jev(
        "custom_match",
        f"doc:{c.document_id}",
        _document_state(c),
        {"helps": Noul(instructions=f"Does this document help answer: {question}")},
    )
    return noul(answers, "helps")


class CustomAnswer(BaseModel):
    summary: str
    state: State
    development_ids: list[str]


ANSWER_SYSTEM = (
    "You answer a standing question for a financial supervisor's monitoring dashboard. Answers "
    "are short, specific and based only on the documents provided."
)


def answer_prompt(
    config: CustomConfig, as_of: date, top: list[Candidate], previous: tuple[str, str] | None
) -> str:
    subject = all_subjects()[config.subject_id]

    def describe(c: Candidate) -> str:
        pairs = zip(c.statements, c.quotes, strict=True)
        findings = "\n".join(f'  finding: {s}\n  quote: "{q}"' for s, q in pairs)
        devs = ", ".join(f"D:{i}" for i in sorted(c.development_ids))
        return f"- {c.published} {c.domain}: {c.title}\n  developments: {devs}\n{findings}"

    docs = "\n".join(describe(c) for c in top)
    parts = [
        f"Run date: {as_of}. Subject: {subject.description}.",
        f"Question: {config.question}",
        f"Lookback: {config.lookback_days} days.",
        "",
        "Best-matching documents:",
        docs or "(none)",
    ]
    if previous:
        parts += ["", f"Answer at the previous run: {previous[0]}: {previous[1]}"]
    parts += [
        "",
        """Return:
- summary: one line of at most 25 words, plain and specific. If the documents do not bear on
  the question, say so briefly.
- state, calm by default:
  - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive.
  - stable: nothing relevant happened in the lookback.
- development_ids: the ids the answer relies on, without the "D:" prefix, most important
  first. Empty if none.""",
    ]
    return "\n".join(parts)


async def answer_run(
    conn: sqlite3.Connection,
    question_id: str,
    run_id: str,
    as_of: date,
    config: CustomConfig,
    previous: tuple[str, str] | None,
) -> tuple[str, str]:
    """Answer one run and store it; returns (state, summary) for the next run's context."""
    inf = Inference(conn, run_id)
    found = candidates(conn, run_id, as_of, config)
    scores = await asyncio.gather(*(match(inf, config.question, c) for c in found))
    ranked = sorted(zip(scores, found, strict=True), key=lambda p: -p[0])
    top = [c for s, c in ranked if s >= MIN_MATCH][:TOP_DOCUMENTS]
    out = await inf.claude(
        "custom_answer",
        f"question:{question_id}",
        answer_prompt(config, as_of, top, previous),
        CustomAnswer,
        ANSWER_SYSTEM,
    )
    eligible = {i for c in top for i in c.development_ids}
    cited = [i for i in dict.fromkeys(d.removeprefix("D:") for d in out.development_ids)]
    cited = [i for i in cited if i in eligible]
    conn.execute(
        "INSERT OR REPLACE INTO custom_question_answers (question_id, run_id, summary, state, "
        "new_count, development_ids, document_ids) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            question_id,
            run_id,
            out.summary.strip(),
            out.state,
            len(cited) if out.state == "new" else 0,
            json.dumps(cited),
            json.dumps([c.document_id for c in top]),
        ),
    )
    conn.commit()
    return out.state, out.summary


async def answer_custom_question(
    conn: sqlite3.Connection, question_id: str, config: CustomConfig
) -> None:
    """Answer the question for every complete run, oldest first, replacing earlier answers."""
    conn.execute("DELETE FROM custom_question_answers WHERE question_id = ?", (question_id,))
    previous: tuple[str, str] | None = None
    for r in conn.execute(
        "SELECT id, as_of FROM runs WHERE status = 'complete' ORDER BY as_of"
    ).fetchall():
        previous = await answer_run(
            conn, question_id, r["id"], date.fromisoformat(r["as_of"]), config, previous
        )
