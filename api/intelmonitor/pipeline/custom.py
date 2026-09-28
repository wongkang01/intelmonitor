"""Step 8: custom standing questions. Claude turns what the user typed into a question config,
then the answer job runs on demand over the stored corpus for every complete run, oldest first:
Jev scores each document tagged to the subject inside the lookback ("Does this document help
answer: ...?"), and Claude answers from the top matches, citing the run's developments. When
nothing in the lookback matches, the answer is Stable and cites the latest earlier matches, so a
quiet question still shows where things stand. The answer prompt calls the lookback the window
and asks answers to name it plainly ("in the last 14 days").

A question can name measured series of its subject (structured-data-plan.md, F7): each run's
answer then gets their facts as of the run date (pipeline/facts.py), may cite them, and is asked
again once if it quotes a number found in neither the facts nor the documents or names an FX
move other than by the SGD's side, as standing answers are."""

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel, ConfigDict, Field
from typesafe_sdk import Noul

from intelmonitor.pipeline.answers import FX_WORDING, State, answer_problems, scope
from intelmonitor.pipeline.facts import SeriesFact, SubjectFacts, subject_facts
from intelmonitor.pipeline.feedback import removed_tags
from intelmonitor.pipeline.inference import Inference, noul
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.pipeline.wording import day, fx_currency
from intelmonitor.seed import QuestionDef, SeriesDef, load_series

DEFAULT_LOOKBACK_DAYS = 14
MAX_LOOKBACK_DAYS = 60
TOP_DOCUMENTS = 8
# Earlier matches cited by a Stable answer, searched back to MAX_LOOKBACK_DAYS before the run.
EARLIER_DOCUMENTS = 3
MIN_MATCH = 0.5
MAX_SERIES = 3


class CustomConfig(BaseModel):
    subject_id: str
    question: str
    label: str
    lookback_days: int
    series_ids: list[str] = Field(
        default_factory=list[str], description="Series of the subject whose facts it gets"
    )


# Claude's reply to the draft prompt. Its schema is the one drafts had before series (the title,
# and no docstring, which would become its description), so drafts without series are still
# served from their recorded calls.
class Drafted(BaseModel):
    model_config = ConfigDict(title="CustomConfig")

    subject_id: str
    question: str = Field(description="The question, tidied into one clear sentence")
    label: str = Field(description="A short label of one to three words, sentence case")
    lookback_days: int = Field(description="How many days back the answer reads")


class DraftedWithSeries(Drafted):
    """The reply when the prompt offers the subject's series to pick from."""

    model_config = ConfigDict(title="DraftedWithSeries")

    series_ids: list[str] = Field(description="Ids of the listed series the question is about")


class SeriesChoiceError(ValueError):
    """Series a custom question cannot name: not listed for its subject, or too many."""


def listed_series(subject_id: str) -> list[SeriesDef]:
    """The series a custom question on the subject may name, as the widget gallery's series
    picker offers them: its own (primary) listed series, then its context ones, each in catalogue
    order."""
    seed = [s for s in load_series().series if s.listed]
    primary = [s for s in seed if subject_id in s.subjects.primary]
    return primary + [s for s in seed if subject_id in s.subjects.context and s not in primary]


def check_series(subject_id: str, series_ids: list[str]) -> list[str]:
    """`series_ids` without repeats, in their order. Raises SeriesChoiceError for a series the
    subject does not list, or for more than MAX_SERIES."""
    ids = list(dict.fromkeys(series_ids))
    listed = {s.id for s in listed_series(subject_id)}
    if unknown := [i for i in ids if i not in listed]:
        raise SeriesChoiceError(f"{', '.join(unknown)}: not a listed series of {subject_id}")
    if len(ids) > MAX_SERIES:
        raise SeriesChoiceError(f"a custom question names at most {MAX_SERIES} series")
    return ids


DRAFT_SYSTEM = (
    "You turn an analyst's request into a standing question for a financial supervisor's "
    "monitoring dashboard. Standing questions are answered every run from news and official "
    "documents about one tracked subject."
)


def _series_line(s: SeriesDef, subject_id: str) -> str:
    role = "its own" if subject_id in s.subjects.primary else "context"
    return f"- {s.id}: {s.name} ({role})"


def draft_prompt(
    text: str, subject_id: str | None, offered: list[SeriesDef], picked: list[SeriesDef]
) -> str:
    """The draft prompt. `offered`: the subject's series Claude may pick from; `picked`: the
    series the analyst chose, which the question is worded to use."""
    subjects = "\n".join(f"- {s.id}: {s.name} ({s.type})" for s in all_subjects().values())
    pinned = (
        f"The question is about the subject {subject_id}; use that subject_id."
        if subject_id
        else "Pick the one tracked subject the request is most about."
    )
    series = ""
    if subject_id and offered:
        listing = "\n".join(_series_line(s, subject_id) for s in offered)
        series = f"""
Measured series of the subject, from official statistics and market data (context series are
system-wide or market-wide figures). A question's series give its answers their facts,
computed by code, next to the documents:
{listing}
"""
    elif subject_id and picked:
        listing = "\n".join(_series_line(s, subject_id) for s in picked)
        series = f"""
The analyst picked these measured series, from official statistics and market data. They give
the question's answers their facts, computed by code, next to the documents:
{listing}
"""
    if any(fx_currency(s) for s in offered + picked):
        series += """\
Name an exchange rate in the question and label by the SGD's side, as in "the SGD against
the ringgit", never as a pair such as SGD/MYR or USD/SGD, which readers take either way
round.
"""
    pick = (
        f"""
- series_ids: the ids of the listed series the request asks about by name or by what they
  measure (an exchange rate, a peg, supply, a ratio), at most {MAX_SERIES}. Empty when it asks
  about developments, news, risks or events in general without naming a measure: most requests
  name none."""
        if subject_id and offered
        else ""
    )
    return f"""Tracked subjects:
{subjects}

The analyst wrote: "{text}"

{pinned}{series}
Return:
- subject_id: one id from the list.
- question: the request as one clear, specific question a weekly run can answer from
  documents, keeping the analyst's intent. No preamble.
- label: one to three words, sentence case, for a widget title.
- lookback_days: {DEFAULT_LOOKBACK_DAYS} unless the request implies a different window
  (at most {MAX_LOOKBACK_DAYS}).{pick}"""


async def draft_config(
    inf: Inference, text: str, subject_id: str | None, series_ids: list[str] | None
) -> CustomConfig:
    """Claude's config for what the analyst typed. `series_ids` are the series the analyst
    picked (checked against the subject); None lets Claude pick among the subject's listed series
    those the request names or needs."""
    by_id = {s.id: s for s in load_series().series}
    picked: list[str] = []
    if series_ids is not None:
        if series_ids and subject_id is None:
            raise SeriesChoiceError("series need a subject")
        picked = check_series(subject_id, series_ids) if subject_id else []
    offered = listed_series(subject_id) if subject_id and series_ids is None else []
    prompt = draft_prompt(text, subject_id, offered, [by_id[i] for i in picked])
    ref = f"request:{subject_id}"
    schema = DraftedWithSeries if offered else Drafted
    out = await inf.claude("custom_draft", ref, prompt, schema, DRAFT_SYSTEM)
    chosen = subject_id or out.subject_id
    if chosen not in all_subjects():
        raise ValueError(f"Claude picked an unknown subject {out.subject_id!r}")
    if isinstance(out, DraftedWithSeries):
        # Ids Claude made up or took from another subject are dropped, like ineligible citations.
        allowed = {s.id for s in offered}
        picked = [i for i in dict.fromkeys(out.series_ids) if i in allowed][:MAX_SERIES]
    return CustomConfig(
        subject_id=chosen,
        question=out.question.strip(),
        label=out.label.strip()[:40],
        lookback_days=min(max(out.lookback_days, 1), MAX_LOOKBACK_DAYS),
        series_ids=picked,
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
    conn: sqlite3.Connection, run_id: str, config: CustomConfig, after: date, until: date
) -> list[Candidate]:
    """Documents published after `after` and up to `until` with findings tagged to the subject
    (or a group's members) that belong to one of the run's developments. Tags the analyst removed
    from a development do not count."""
    ids = scope(all_subjects()[config.subject_id])
    removed = removed_tags(conn)
    out: dict[str, Candidate] = {}
    for r in conn.execute(
        "SELECT f.statement, f.subjects, f.quotes, s.development_id, d.id, d.title, d.domain, "
        "substr(d.published_at, 1, 10) AS published FROM development_sources s "
        "JOIN findings f ON f.id = s.finding_id JOIN source_documents d ON d.id = s.document_id "
        "WHERE s.run_id = ? AND substr(d.published_at, 1, 10) > ? "
        "AND substr(d.published_at, 1, 10) <= ? ORDER BY d.published_at, f.id",
        (run_id, after.isoformat(), until.isoformat()),
    ):
        tagged = {s for s in json.loads(r["subjects"]) if (r["development_id"], s) not in removed}
        if not ids & tagged:
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


async def best(
    inf: Inference, question: str, found: list[Candidate], limit: int
) -> list[Candidate]:
    """The `limit` candidates Jev scores as most helpful, at least MIN_MATCH."""
    scores = await asyncio.gather(*(match(inf, question, c) for c in found))
    ranked = sorted(zip(scores, found, strict=True), key=lambda p: -p[0])
    return [c for s, c in ranked if s >= MIN_MATCH][:limit]


class CustomAnswer(BaseModel):
    summary: str
    state: State
    development_ids: list[str]


class CustomSeriesAnswer(CustomAnswer):
    """The reply for a question with series, which may cite their facts."""

    series_ids: list[str]


ANSWER_SYSTEM = (
    "You answer a standing question for a financial supervisor's monitoring dashboard. Answers "
    "are short, specific and based only on the documents provided."
)
SERIES_ANSWER_SYSTEM = (
    "You answer a standing question for a financial supervisor's monitoring dashboard. Answers "
    "are short, specific and based only on the documents and facts provided."
)


# Answers are read by analysts: the window is "the last 14 days", not a prompt term.
PLAIN_WINDOW = """\
- Name the window as the analyst would, "in the last 14 days" or "since 10 Sep", never
  "lookback" or "window"."""


def answer_prompt(
    config: CustomConfig,
    as_of: date,
    top: list[Candidate],
    earlier: list[Candidate],
    previous: tuple[str, str] | None,
    facts: list[SeriesFact] | None = None,
    problems: list[str] | None = None,
) -> str:
    """The answer prompt. A question with series gets their `facts` and the rules on numbers and
    FX wording; `problems` are why its last answer is asked again."""
    subject = all_subjects()[config.subject_id]

    def describe(c: Candidate) -> str:
        pairs = zip(c.statements, c.quotes, strict=True)
        findings = "\n".join(f'  finding: {s}\n  quote: "{q}"' for s, q in pairs)
        devs = ", ".join(f"D:{i}" for i in sorted(c.development_ids))
        return f"- {c.published} {c.domain}: {c.title}\n  developments: {devs}\n{findings}"

    parts = [
        f"Run date: {as_of}. Subject: {subject.description}.",
        f"Question: {config.question}",
        f"Window: the last {config.lookback_days} days, since "
        f"{day(as_of - timedelta(days=config.lookback_days))}.",
        "",
        "Best-matching documents in the window:",
        "\n".join(describe(c) for c in top) or "(none)",
    ]
    if earlier:
        quiet = (
            "No document in the window bears on the question; give the latest earlier "
            "position with its date, citing its developments, next to what the facts show:"
            if facts
            else "Nothing in the window bears on the question, so the state is stable; say so "
            "and give the latest earlier position with its date, citing its developments:"
        )
        parts += [
            "",
            f"Earlier matching documents, before the window. {quiet}",
            "\n".join(describe(c) for c in earlier),
        ]
    if facts:
        parts += [
            "",
            "Facts computed by code from official statistics and market data available by the "
            "run date, for the question's series:",
        ]
        parts += [f"- S:{f.series_id} | {f.text}" for f in facts]
    if previous:
        parts += ["", f"Answer at the previous run: {previous[0]}: {previous[1]}"]
    if problems:
        parts += [
            "",
            "Your last answer broke the rules below. Answer again, quoting numbers only as the "
            f"facts and documents give them: {'; '.join(problems)}",
        ]
    if not facts:
        parts += [
            "",
            f"""Return:
- summary: one line of at most 25 words, plain and specific. If no document bears on the
  question, say so briefly.
{PLAIN_WINDOW}
- state, calm by default:
  - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive.
  - stable: nothing relevant happened in the window.
- development_ids: the ids the answer relies on, without the "D:" prefix, most important
  first. Empty if none.""",
        ]
        return "\n".join(parts)
    parts += [
        "",
        f"""Return:
- summary: one line of at most 25 words, plain and specific. Say what the facts show, and
  what the documents add; if no document bears on the question, say so briefly.
{PLAIN_WINDOW}
- Numbers: quote only numbers the facts or documents give, as they give them; never compute,
  convert or estimate new ones.
{FX_WORDING}
- state, calm by default:
  - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now.
  - watch: something adverse or uncertain is developing that could become material, in the
    documents or the facts.
  - new: relevant new items that are routine, neutral or positive.
  - stable: nothing relevant happened in the window.
- development_ids: the ids the answer relies on, without the "D:" prefix, most important
  first. Empty if none.
- series_ids: the series whose facts the answer relies on, without the "S:" prefix. Empty if
  none.""",
    ]
    return "\n".join(parts)


@dataclass(frozen=True)
class RunAnswer:
    run_id: str
    summary: str
    state: State
    new_count: int
    development_ids: list[str]
    document_ids: list[str]
    series_ids: list[str]
    facts: list[SeriesFact]


def question_facts(
    conn: sqlite3.Connection,
    question_id: str,
    config: CustomConfig,
    as_of: date,
    revised_since: date | None,
) -> SubjectFacts:
    """The facts of the question's series as of the run date, as a standing question linking
    them gets them: a daily series' low and high over the question's lookback."""
    linked = QuestionDef(
        id=question_id,
        label=config.label,
        question=config.question,
        lookback_days=config.lookback_days,
        series=config.series_ids,
    )
    return subject_facts(conn, config.subject_id, [linked], as_of, revised_since)


async def answer_run(
    conn: sqlite3.Connection,
    question_id: str,
    run_id: str,
    as_of: date,
    config: CustomConfig,
    previous: tuple[str, str] | None,
    revised_since: date | None,
) -> RunAnswer:
    inf = Inference(conn, run_id)
    since = as_of - timedelta(days=config.lookback_days)
    found = candidates(conn, run_id, config, since, as_of)
    top = await best(inf, config.question, found, TOP_DOCUMENTS)
    earlier: list[Candidate] = []
    if not top:
        before = candidates(conn, run_id, config, as_of - timedelta(days=MAX_LOOKBACK_DAYS), since)
        earlier = await best(inf, config.question, before, EARLIER_DOCUMENTS)
    facts = (
        question_facts(conn, question_id, config, as_of, revised_since).facts
        if config.series_ids
        else []
    )
    series_ids: list[str] = []
    if facts:
        out, series_ids = await _answer_with_facts(
            inf, question_id, config, as_of, top, earlier, previous, facts
        )
    else:
        out = await inf.claude(
            "custom_answer",
            f"question:{question_id}",
            answer_prompt(config, as_of, top, earlier, previous),
            CustomAnswer,
            ANSWER_SYSTEM,
        )
    recent = {i for c in top for i in c.development_ids}
    eligible = recent | {i for c in earlier for i in c.development_ids}
    cited = [i for i in dict.fromkeys(d.removeprefix("D:") for d in out.development_ids)]
    cited = [i for i in cited if i in eligible]
    # Earlier documents are context only: with nothing in the lookback and no facts, the answer
    # is Stable. Facts are this run's, so they can move it.
    state = out.state if top or facts else "stable"
    return RunAnswer(
        run_id=run_id,
        summary=out.summary.strip(),
        state=state,
        new_count=sum(i in recent for i in cited) if state == "new" else 0,
        development_ids=cited,
        document_ids=[c.document_id for c in top + earlier],
        series_ids=series_ids,
        facts=facts,
    )


async def _answer_with_facts(
    inf: Inference,
    question_id: str,
    config: CustomConfig,
    as_of: date,
    top: list[Candidate],
    earlier: list[Candidate],
    previous: tuple[str, str] | None,
    facts: list[SeriesFact],
) -> tuple[CustomAnswer, list[str]]:
    """The answer and the series it cites. Asked again once when it quotes a number found in
    neither the facts nor the documents, or, on FX series, names a pair or moves a rate up or
    down; a second answer is kept whatever it quotes."""
    allowed = "\n".join(
        [f.text for f in facts]
        + [text for c in top + earlier for text in (c.title, *c.statements, *c.quotes)]
    )
    by_id = {s.id: s for s in load_series().series}
    fx = any(fx_currency(by_id[f.series_id]) for f in facts)
    problems: list[str] = []
    out: CustomSeriesAnswer | None = None
    for attempt in range(2):
        out = await inf.claude(
            "custom_answer",
            f"question:{question_id}" + (f":retry{attempt}" if attempt else ""),
            answer_prompt(config, as_of, top, earlier, previous, facts, problems),
            CustomSeriesAnswer,
            SERIES_ANSWER_SYSTEM,
        )
        problems = answer_problems(out.summary, allowed, fx)
        if not problems:
            break
    assert out is not None
    linked = {f.series_id for f in facts}
    cited = [i for i in dict.fromkeys(i.removeprefix("S:") for i in out.series_ids) if i in linked]
    return out, cited


async def answer_all_runs(
    conn: sqlite3.Connection, question_id: str, config: CustomConfig
) -> list[RunAnswer]:
    """Answer the question for every complete run, oldest first. Nothing is written, so callers
    store the answers in the same short transaction as the question itself. A fact counts
    revisions made since the run before."""
    answers: list[RunAnswer] = []
    previous: tuple[str, str] | None = None
    before: date | None = None
    for r in conn.execute(
        "SELECT id, as_of FROM runs WHERE status = 'complete' ORDER BY as_of"
    ).fetchall():
        as_of = date.fromisoformat(r["as_of"])
        a = await answer_run(conn, question_id, r["id"], as_of, config, previous, before)
        answers.append(a)
        previous = (a.state, a.summary)
        before = as_of
    return answers


def store_answers(conn: sqlite3.Connection, question_id: str, answers: list[RunAnswer]) -> None:
    """Replace the question's answers, each with the facts it was given. Does not commit."""
    conn.execute("DELETE FROM custom_question_answers WHERE question_id = ?", (question_id,))
    conn.executemany(
        "INSERT INTO custom_question_answers (question_id, run_id, summary, state, new_count, "
        "development_ids, document_ids, series_ids, facts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                question_id,
                a.run_id,
                a.summary,
                a.state,
                a.new_count,
                json.dumps(a.development_ids),
                json.dumps(a.document_ids),
                json.dumps(a.series_ids),
                json.dumps([f.model_dump(mode="json") for f in a.facts]),
            )
            for a in answers
        ],
    )
