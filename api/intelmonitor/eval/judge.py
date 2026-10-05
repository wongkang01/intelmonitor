"""The judge: Opus 5.5 with a fixed rubric, never told which variant wrote an answer.

- Correctness, per answer: the summary split into atomic claims, each checked against the text of
  the sources that answer cites (corpus documents, V2's series facts, or V0's fetched pages).
- Coverage, per question: all answers to it, shuffled under letters, against the gold
  must-mention developments and series moves.
- Consistency: a random 20% of correctness items (their claims, reshuffled with their sources)
  and of coverage items (reshuffled answers and gold items) judged again in fresh calls."""

import asyncio
import json
import math
import random
import sqlite3

from pydantic import BaseModel, Field

from intelmonitor.eval.common import (
    EVAL_DIR,
    JUDGE_MODEL,
    SCORED_RUN,
    EvalQuestion,
    ExportedAnswer,
    Variant,
    all_questions,
    ask,
    document,
    frozen,
    read_answers,
)
from intelmonitor.eval.gold import read_gold, series_moves
from intelmonitor.eval.v0 import fetch_page

JUDGE_DIR = EVAL_DIR / "judge"
VARIANTS: list[Variant] = ["V0-C", "V1", "V2"]
TOTAL_SOURCE_CHARS = 100_000
DOC_CHARS = 12_000
QUOTE_WINDOW = 1_200
REJUDGE_SHARE = 0.2

SYSTEM = (
    "You are a strict, fair fact-checker evaluating answers from a financial supervisor's "
    "monitoring system. Judge only from the text you are given. Apply the rubric the same way to "
    "every answer."
)


class Source(BaseModel):
    label: str
    heading: str
    excerpt: str  # what the judge reads
    full: str  # what numbers may come from


def _excerpt(text: str, quotes: list[str], cap: int) -> str:
    flat = " ".join(text.split())
    out = flat[:cap]
    for q in quotes:
        qn = " ".join(q.split())
        at = flat.find(qn[:80]) if qn else -1
        if at >= cap:
            start = max(0, at - QUOTE_WINDOW)
            out += f"\n[...]\n{flat[start : at + len(qn) + QUOTE_WINDOW]}"
    return out + ("\n[...]" if len(flat) > cap else "")


def sources(conn: sqlite3.Connection, a: ExportedAnswer) -> list[Source]:
    """The cited sources in citation order, each document once with every quote cited from it."""
    keys = list(dict.fromkeys(c.document_id or c.url or "" for c in a.citations))
    keys = [k for k in keys if k]
    quotes = {
        k: [c.quote for c in a.citations if (c.document_id or c.url) == k and c.quote] for k in keys
    }
    cap = min(DOC_CHARS, TOTAL_SOURCE_CHARS // max(len(keys), 1))
    out: list[Source] = []
    for k in keys:
        label = f"S{len(out) + 1}"
        if a.variant == "V0-C":
            page = fetch_page(k)
            text = str(page.get("text") or "")
            when = page.get("date") or "date unknown"
            heading = f"{k} (published {when})"
            excerpt = (
                _excerpt(text, quotes[k], cap) if text else "(the page could not be retrieved)"
            )
        else:
            r = document(conn, k)
            if r is None:
                continue
            text = f"{r['title']}\n{r['text']}"
            heading = f"{r['title']} ({r['domain']}, published {r['published']})"
            excerpt = _excerpt(str(r["text"]), quotes[k], cap)
        out.append(Source(label=label, heading=heading, excerpt=excerpt, full=text))
    if a.facts:
        facts = "\n".join(f"- {f}" for f in a.facts)
        out.append(
            Source(
                label=f"S{len(out) + 1}",
                heading="Facts computed by code from official statistics and market data",
                excerpt=facts,
                full=facts,
            )
        )
    return out


def allowed_text(conn: sqlite3.Connection, a: ExportedAnswer) -> str:
    """Everything an answer's numbers may come from: its cited sources in full, and its quotes."""
    return "\n".join([s.full for s in sources(conn, a)] + [c.quote or "" for c in a.citations])


# ---- correctness


class Claim(BaseModel):
    claim: str
    kind: str = Field(description="fact, or absence for a claim that nothing happened")
    supported: bool
    after_run_date: bool = Field(description="The claim reports something after the run date")
    source_labels: list[str]
    reason: str


class ClaimCheck(BaseModel):
    claims: list[Claim]


RUBRIC = """Rubric:
- A claim is supported when the cited sources' text states it or clearly implies it, including
  its numbers, names, dates and direction. Paraphrase is fine; a number that differs, an actor
  or action the sources do not name, or a stronger statement than the sources make is not.
- Evaluative or forward-looking wording ("could", "peers may follow") is supported when the
  sources state or clearly imply that assessment.
- A claim about something published or happening after the run date is unsupported, and marked
  after_run_date.
- A claim that nothing relevant happened ("no incidents in the last 7 days") is kind absence;
  mark supported true when no cited source contradicts it. Every other claim is kind fact."""


def _sources_block(srcs: list[Source]) -> str:
    return (
        "\n\n".join(f"[{s.label}] {s.heading}\n{s.excerpt}" for s in srcs) or "(no sources cited)"
    )


def correctness_prompt(q_text: str, a: ExportedAnswer, srcs: list[Source]) -> str:
    return f"""Run date: {SCORED_RUN}. Question: {q_text}

Answer: "{a.summary}"

Sources the answer cites:

{_sources_block(srcs)}

Split the answer into atomic claims (each one checkable statement; keep the answer's wording)
and check each against the sources above only, not your own knowledge.
{RUBRIC}"""


class Verdict(BaseModel):
    claim_id: str
    supported: bool
    reason: str


class Verdicts(BaseModel):
    verdicts: list[Verdict]


def recheck_prompt(q_text: str, claims: list[tuple[str, str]], srcs: list[Source]) -> str:
    listing = "\n".join(f"- {cid}: {text}" for cid, text in claims)
    return f"""Run date: {SCORED_RUN}. Question: {q_text}

Sources:

{_sources_block(srcs)}

Claims from an answer to this question:
{listing}

For each claim, decide whether the sources above support it.
{RUBRIC}"""


# ---- coverage


class Mention(BaseModel):
    answer: str
    item: str
    mentioned: bool
    reason: str


class CoverageCheck(BaseModel):
    mentions: list[Mention]


def gold_items(conn: sqlite3.Connection, q: EvalQuestion) -> list[tuple[str, str]]:
    """(key, description) of the gold must-mention events and series moves."""
    g = read_gold(q.id).gold
    items = [(f"event:{i}", e.title) for i, e in enumerate(g.events) if e.must_mention]
    facts = dict(series_moves(conn, q))
    items += [
        (f"series:{s.series_id}", f"Series {s.series_id}: {facts.get(s.series_id, '')}")
        for s in g.series
        if s.must_mention
    ]
    return items


def coverage_prompt(
    q_text: str, answers: list[tuple[str, str]], items: list[tuple[str, str]]
) -> str:
    a_list = "\n".join(f'- Answer {label}: "{summary}"' for label, summary in answers)
    i_list = "\n".join(f"- {label}: {text}" for label, text in items)
    return f"""Run date: {SCORED_RUN}. Question: {q_text}

Key developments a good answer must mention:
{i_list}

Answers:
{a_list}

For every answer and every key development, decide whether the answer mentions that
development: it names the same event or move, even briefly or in other words. A vaguer
reference that a reader could not tie to that event does not count. Return one mention per
(answer, development) pair."""


async def run() -> None:
    conn = frozen()
    JUDGE_DIR.mkdir(parents=True, exist_ok=True)
    questions = {q.id: q for q in all_questions()}
    answers = [a for v in VARIANTS for a in read_answers(v)]

    async def correct(a: ExportedAnswer) -> dict[str, object]:
        srcs = sources(conn, a)
        q = questions[a.eval_id]
        check = await ask(
            "judge-correctness",
            JUDGE_MODEL,
            SYSTEM,
            correctness_prompt(q.question, a, srcs),
            ClaimCheck,
        )
        return {
            "variant": a.variant,
            "eval_id": a.eval_id,
            "sources": [s.heading for s in srcs],
            "claims": [c.model_dump() for c in check.claims],
        }

    correctness = await asyncio.gather(*(correct(a) for a in answers))

    async def cover(eval_id: str, seed: int) -> dict[str, object]:
        rng = random.Random(f"{eval_id}:{seed}")
        mine = [a for a in answers if a.eval_id == eval_id]
        rng.shuffle(mine)
        labels = {chr(65 + i): a.variant for i, a in enumerate(mine)}
        items = gold_items(conn, questions[eval_id])
        rng.shuffle(items)
        item_labels = {f"G{i + 1}": key for i, (key, _) in enumerate(items)}
        if not items:
            return {"eval_id": eval_id, "seed": seed, "items": 0, "mentions": []}
        check = await ask(
            "judge-coverage",
            JUDGE_MODEL,
            SYSTEM,
            coverage_prompt(
                questions[eval_id].question,
                [(label, a.summary) for label, a in zip(labels, mine, strict=True)],
                [(f"G{i + 1}", text) for i, (_, text) in enumerate(items)],
            ),
            CoverageCheck,
        )
        return {
            "eval_id": eval_id,
            "seed": seed,
            "items": len(items),
            "mentions": [
                {
                    "variant": labels.get(m.answer.removeprefix("Answer ").strip()),
                    "item": item_labels.get(m.item.strip()),
                    "mentioned": m.mentioned,
                    "reason": m.reason,
                }
                for m in check.mentions
            ],
        }

    coverage = await asyncio.gather(*(cover(i, 1) for i in questions))

    # Consistency: a fixed random 20% of items, judged again in fresh, reshuffled calls.
    rng = random.Random("rejudge")
    redo = rng.sample(range(len(answers)), math.ceil(REJUDGE_SHARE * len(answers)))

    async def recheck(index: int) -> dict[str, object]:
        a = answers[index]
        first: list[dict[str, object]] = correctness[index]["claims"]  # type: ignore[assignment]
        claims = [(f"C{i + 1}", str(c["claim"])) for i, c in enumerate(first)]
        order = list(claims)
        rng_i = random.Random(f"recheck:{index}")
        rng_i.shuffle(order)
        srcs = sources(conn, a)
        rng_i.shuffle(srcs)
        got = await ask(
            "judge-recheck",
            JUDGE_MODEL,
            SYSTEM,
            recheck_prompt(questions[a.eval_id].question, order, srcs),
            Verdicts,
        )
        second = {v.claim_id: v.supported for v in got.verdicts}
        pairs = [
            (bool(c["supported"]), second.get(f"C{i + 1}"))
            for i, c in enumerate(first)
            if c["kind"] != "absence"
        ]
        return {
            "variant": a.variant,
            "eval_id": a.eval_id,
            "pairs": [[x, y] for x, y in pairs],
        }

    rechecks = await asyncio.gather(*(recheck(i) for i in redo))
    recover_ids = rng.sample(sorted(questions), math.ceil(REJUDGE_SHARE * len(questions)))
    recovered = await asyncio.gather(*(cover(i, 2) for i in recover_ids))

    out = {
        "correctness": correctness,
        "coverage": coverage,
        "rejudge": {"correctness": rechecks, "coverage": recovered},
    }
    (JUDGE_DIR / "judge.json").write_text(json.dumps(out, indent=1))
    print("judged", len(correctness), "answers,", len(coverage), "questions")
