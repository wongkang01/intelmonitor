"""Silver gold: Opus 5.5 stands in for the analyst (docs/archive/eval-plan.md, "Gold set"). Built
after the variants have answered and before any judging, blind to which variant cited what.

1. Pool per question, by script: documents any variant cites, documents an independent Opus pass
   over the raw window marks as about the subject (title and opening only, no pipeline tags), and
   keyword hits on the subject's aliases. Shuffled, with no provenance shown.
2. Opus marks each pooled document in or out, groups kept ones into events (key developments),
   sets the expected state and marks the events an answer must mention, with a reason for each.
3. Series questions: the facts code computes for the window (pipeline/facts.py) are listed by
   series id; Opus marks which moves an answer must mention.
4. Change gold, derived: an event whose earliest source is after the base run is new; one with
   older sources and a newer one is updated.
5. Independence check: the gold pass again, on a different ordering, for two questions."""

import asyncio
import json
import random
import sqlite3
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from intelmonitor.eval.common import (
    BASE_RUN,
    EVAL_DIR,
    EXPOSURE_ID,
    JUDGE_MODEL,
    SCORED_RUN,
    EvalQuestion,
    State,
    all_questions,
    ask,
    frozen,
    keyword_hits,
    opening,
    read_answers,
    window_documents,
)
from intelmonitor.pipeline.facts import subject_facts
from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.seed import QuestionDef

GOLD_DIR = EVAL_DIR / "gold"
SCREEN_CHARS = 800
GOLD_CHARS = 1500
SCREEN_BATCH = 40
KEYWORD_HITS = 25
CONSISTENCY_QUESTIONS = ["banking-regulation/topic.new-developments"]

# The exposure question asks about markets, not about UOB itself, so the screen also marks
# documents on adverse developments in the markets UOB lends to.
EXPOSURE_MARKETS = "uob-exposure-markets"
EXPOSURE_MARKETS_ABOUT = (
    "adverse economic, property, credit or banking-sector developments in markets where UOB has "
    "significant lending exposure: Singapore, Greater China (mainland China, Hong Kong, Taiwan) "
    "including commercial real estate, and ASEAN (Malaysia, Thailand, Indonesia, Vietnam, the "
    "Philippines)"
)

SYSTEM = (
    "You are a senior analyst at a financial supervisor building a reference answer key for "
    "evaluating a monitoring system. Judge only from the text you are given, carefully and "
    "consistently."
)


# ---- 1. screening the raw window


class ScreenedDocument(BaseModel):
    document_id: str
    subjects: list[str] = Field(description="Ids of the listed subjects the document is about")


class ScreenBatch(BaseModel):
    documents: list[ScreenedDocument]


def screen_subjects(questions: list[EvalQuestion]) -> dict[str, str]:
    subjects = {q.subject_id: q.subject.description for q in questions}
    subjects[EXPOSURE_MARKETS] = EXPOSURE_MARKETS_ABOUT
    return subjects


def screen_prompt(subjects: dict[str, str], docs: list[sqlite3.Row]) -> str:
    listing = "\n".join(f"- {sid}: {about}" for sid, about in subjects.items())
    body = "\n\n".join(
        f"[{d['id']}] {d['published']} {d['domain']} | {d['title']}\n{opening(d, SCREEN_CHARS)}"
        for d in docs
    )
    return f"""Subjects:
{listing}

For each document below (title and opening only), list the ids of the subjects it is about:
it reports news, actions, statements or data concerning that subject, not merely a passing
mention. A group counts when the document is about any of its members. A document may be about
several subjects or none. Return every document id exactly once.

{body}"""


async def screen(conn: sqlite3.Connection, questions: list[EvalQuestion]) -> dict[str, list[str]]:
    """Subject ids per document over the widest window, from Opus reading title and opening."""
    after = min(q.window(SCORED_RUN)[0] for q in questions)
    docs = window_documents(conn, after, SCORED_RUN)
    subjects = screen_subjects(questions)
    batches = [docs[i : i + SCREEN_BATCH] for i in range(0, len(docs), SCREEN_BATCH)]
    results = await asyncio.gather(
        *(
            ask("gold-screen", JUDGE_MODEL, SYSTEM, screen_prompt(subjects, b), ScreenBatch)
            for b in batches
        )
    )
    out: dict[str, list[str]] = {}
    for batch, result in zip(batches, results, strict=True):
        got = {d.document_id: [s for s in d.subjects if s in subjects] for d in result.documents}
        for d in batch:
            out[d["id"]] = got.get(d["id"], [])
    return out


# ---- the pool


def cited_documents(conn: sqlite3.Connection, eval_id: str) -> dict[str, list[str]]:
    """Document ids each variant cites for the question; V0's web pages count where their URL is
    a corpus document's."""
    by_url = {
        str(u): str(r["id"])
        for r in conn.execute("SELECT id, url, canonical_url FROM source_documents")
        for u in (r["url"], r["canonical_url"])
    }
    out: dict[str, list[str]] = {}
    for variant in ("V0-C", "V1", "V2"):
        for a in read_answers(variant):
            if a.eval_id != eval_id:
                continue
            ids = [c.document_id or by_url.get(c.url or "") for c in a.citations]
            out[variant] = list(dict.fromkeys(i for i in ids if i))
    return out


class PoolEntry(BaseModel):
    document_id: str
    published: str
    sources: list[Literal["cited:V0-C", "cited:V1", "cited:V2", "screen", "keyword"]]


def build_pool(
    conn: sqlite3.Connection, q: EvalQuestion, screened: dict[str, list[str]]
) -> list[PoolEntry]:
    after, until = q.window(SCORED_RUN)
    in_window = {r["id"]: r["published"] for r in window_documents(conn, after, until)}
    marks: set[str] = {q.subject_id} | ({EXPOSURE_MARKETS} if q.id == EXPOSURE_ID else set())
    sources: dict[str, list[str]] = {}
    for variant, ids in cited_documents(conn, q.id).items():
        for i in ids:
            sources.setdefault(i, []).append(f"cited:{variant}")
    for i, subjects in screened.items():
        if i in in_window and marks & set(subjects):
            sources.setdefault(i, []).append("screen")
    for i in keyword_hits(conn, q.subject, after, until)[:KEYWORD_HITS]:
        sources.setdefault(i, []).append("keyword")
    published = {
        r["id"]: r["published"]
        for r in conn.execute(
            "SELECT id, substr(published_at, 1, 10) AS published FROM source_documents"
        )
    }
    return [
        PoolEntry(document_id=i, published=published[i], sources=s)  # type: ignore[arg-type]
        for i, s in sorted(sources.items())
    ]


# ---- 2 and 3. the gold pass


class DocumentDecision(BaseModel):
    document_id: str
    include: bool = Field(description="True when the document bears on the question")
    reason: str


class GoldEvent(BaseModel):
    title: str = Field(description="The development in one plain sentence")
    document_ids: list[str]
    must_mention: bool = Field(description="A good one-line answer must mention it")
    reason: str


class SeriesDecision(BaseModel):
    series_id: str
    must_mention: bool
    reason: str


class GoldPass(BaseModel):
    decisions: list[DocumentDecision]
    events: list[GoldEvent]
    series: list[SeriesDecision]
    expected_state: State
    state_reason: str


def series_moves(conn: sqlite3.Connection, q: EvalQuestion) -> list[tuple[str, str]]:
    """(series id, fact text) for a series-linked standing question, as code computes them."""
    if q.custom:
        return []
    qdef: QuestionDef = next(
        x for x in questions_for(all_subjects()[q.subject_id]) if x.id == q.question_id
    )
    if not qdef.series:
        return []
    facts = subject_facts(conn, q.subject_id, [qdef], SCORED_RUN, BASE_RUN)
    return [(f.series_id, f.text) for f in facts.for_question(q.question_id)]


def gold_prompt(conn: sqlite3.Connection, q: EvalQuestion, pool: list[PoolEntry], seed: int) -> str:
    after, until = q.window(SCORED_RUN)
    order = list(pool)
    random.Random(f"{q.id}:{seed}").shuffle(order)
    docs: list[str] = []
    for e in order:
        r = conn.execute(
            "SELECT id, title, text, domain, substr(published_at, 1, 10) AS published "
            "FROM source_documents WHERE id = ?",
            (e.document_id,),
        ).fetchone()
        docs.append(
            f"[{r['id']}] {r['published']} {r['domain']} | {r['title']}\n{opening(r, GOLD_CHARS)}"
        )
    moves = series_moves(conn, q)
    series = (
        "\n\nMeasured series, facts computed by code from official statistics and market data "
        "available by the run date:\n" + "\n".join(f"- {sid}: {text}" for sid, text in moves)
        if moves
        else ""
    )
    return f"""Build the reference answer for one standing question of a supervisor's monitoring
dashboard.

Run date: {until}. Subject: {q.subject.description}.
Question: {q.question}
Lookback: {q.lookback_days} days, documents published after {after} and up to {until}.

Candidate documents (title and opening only), in no particular order:

{"\n\n".join(docs)}{series}

Steps:
1. decisions: for every candidate document, include = true when it reports something that bears
   on the question for this subject within the lookback, false otherwise, with a short reason.
   Return every document id exactly once.
2. events: group the included documents into distinct key developments (one event may have
   several documents reporting it). For each, a one-sentence title, its document ids, and
   must_mention: true only for the developments a good one-line answer (about 25 words) to this
   question must mention to be right and useful to a supervisor, usually one to three, none when
   nothing relevant happened. Give a reason for each must_mention decision.
3. series: for each measured series listed (if any), must_mention true when its move matters
   for the question enough that a one-line answer should state it, with a reason. Empty if no
   series are listed.
4. expected_state, one of:
   - needs_attention: something could hurt a tracked subject or needs supervisory follow-up now,
     such as enforcement, an incident, stress, a depeg or escalation, and it is significant or
     critical.
   - watch: something adverse or uncertain is developing that could become material.
   - new: relevant new items that are routine, neutral or positive, however significant.
   - stable: nothing relevant happened in the lookback.
   With a reason (state_reason)."""


class Gold(BaseModel):
    eval_id: str
    question: str
    lookback_days: int
    seed: int
    pool: list[PoolEntry]
    gold: GoldPass
    changes: dict[str, Literal["new", "updated", "unchanged"]] = Field(
        description="Change gold per event index"
    )


def change_gold(events: list[GoldEvent], published: dict[str, str]) -> dict[str, str]:
    base = BASE_RUN.isoformat()
    out: dict[str, str] = {}
    for i, e in enumerate(events):
        dates = [published[d] for d in e.document_ids if d in published]
        if not dates:
            continue
        if min(dates) > base:
            out[str(i)] = "new"
        elif max(dates) > base:
            out[str(i)] = "updated"
        else:
            out[str(i)] = "unchanged"
    return out


async def gold_for(
    conn: sqlite3.Connection, q: EvalQuestion, pool: list[PoolEntry], seed: int
) -> Gold:
    result = await ask("gold", JUDGE_MODEL, SYSTEM, gold_prompt(conn, q, pool, seed), GoldPass)
    pooled = {e.document_id for e in pool}
    # Ids outside the pool are dropped: Opus may only use documents it was shown.
    for e in result.events:
        e.document_ids = [d for d in e.document_ids if d in pooled]
    published = {e.document_id: e.published for e in pool}
    return Gold(
        eval_id=q.id,
        question=q.question,
        lookback_days=q.lookback_days,
        seed=seed,
        pool=pool,
        gold=result,
        changes=change_gold(result.events, published),  # type: ignore[arg-type]
    )


def gold_path(eval_id: str, seed: int = 1) -> Path:
    name = eval_id.replace("/", "__")
    return GOLD_DIR / (f"{name}.json" if seed == 1 else f"{name}.seed{seed}.json")


def read_gold(eval_id: str, seed: int = 1) -> Gold:
    return Gold.model_validate_json(gold_path(eval_id, seed).read_text())


# ---- 5. independence check


def _events_match(a: GoldEvent, b: GoldEvent) -> bool:
    return bool(set(a.document_ids) & set(b.document_ids))


def consistency(first: Gold, second: Gold) -> dict[str, object]:
    one = {d.document_id: d.include for d in first.gold.decisions}
    two = {d.document_id: d.include for d in second.gold.decisions}
    shared = [i for i in one if i in two]
    agree = sum(one[i] == two[i] for i in shared)
    musts1 = [e for e in first.gold.events if e.must_mention]
    musts2 = [e for e in second.gold.events if e.must_mention]
    matched = sum(any(_events_match(e, f) for f in musts2) for e in musts1)
    # Cohen's kappa on in/out.
    n = len(shared) or 1
    p1 = sum(one[i] for i in shared) / n
    p2 = sum(two[i] for i in shared) / n
    pe = p1 * p2 + (1 - p1) * (1 - p2)
    po = agree / n
    return {
        "eval_id": first.eval_id,
        "documents": len(shared),
        "in_out_agreement": round(po, 3),
        "kappa": round((po - pe) / (1 - pe), 3) if pe < 1 else 1.0,
        "kept": [sum(one.values()), sum(two.values())],
        "state": [first.gold.expected_state, second.gold.expected_state],
        "state_agrees": first.gold.expected_state == second.gold.expected_state,
        "must_mention_events": [len(musts1), len(musts2)],
        "must_mention_matched": matched,
    }


async def run() -> None:
    conn = frozen()
    questions = all_questions()
    GOLD_DIR.mkdir(parents=True, exist_ok=True)
    screened = await screen(conn, questions)
    (GOLD_DIR / "screen.json").write_text(json.dumps(screened, indent=1))
    pools = {q.id: build_pool(conn, q, screened) for q in questions}
    (GOLD_DIR / "pools.json").write_text(
        json.dumps({k: [e.model_dump() for e in v] for k, v in pools.items()}, indent=1)
    )
    print({k: len(v) for k, v in pools.items()})
    golds = await asyncio.gather(*(gold_for(conn, q, pools[q.id], 1) for q in questions))
    for g in golds:
        gold_path(g.eval_id).write_text(g.model_dump_json(indent=2))
    by_id = {q.id: q for q in questions}
    seconds = await asyncio.gather(
        *(gold_for(conn, by_id[i], pools[i], 2) for i in CONSISTENCY_QUESTIONS)
    )
    checks: list[dict[str, object]] = []
    for g in seconds:
        gold_path(g.eval_id, 2).write_text(g.model_dump_json(indent=2))
        checks.append(consistency(read_gold(g.eval_id), g))
    (GOLD_DIR / "consistency.json").write_text(json.dumps(checks, indent=2))
    print(json.dumps(checks, indent=1))
