"""V1, the simple baseline: per question, FTS5 over the frozen corpus (title and text, the subject's
name, aliases or topic keywords) inside the question's lookback, then one Sonnet 5.5 call that
answers from the retrieved documents and cites them with quotes. No screening, extraction, merge,
materiality, facts or diff. It answers the scored run only: with no diff, the base run would
score nothing."""

import asyncio
import json
import time

from pydantic import BaseModel, Field

from intelmonitor.eval.common import (
    ANSWER_MODEL,
    EVAL_DIR,
    SCORED_RUN,
    Citation,
    EvalQuestion,
    ExportedAnswer,
    State,
    all_questions,
    ask,
    document,
    frozen,
    keyword_hits,
    opening,
    write_answers,
)

TOP_DOCUMENTS = 30
EXCERPT_CHARS = 2500


class V1Citation(BaseModel):
    document_id: str
    quote: str = Field(description="A short verbatim quote from the document")


class V1Answer(BaseModel):
    summary: str
    state: State
    citations: list[V1Citation]


SYSTEM = (
    "You answer a standing question for a financial supervisor's monitoring dashboard. Answers "
    "are short, specific and based only on the documents provided."
)


def prompt(q: EvalQuestion, docs: list[tuple[str, str, str, str, str]]) -> str:
    after, until = q.window(SCORED_RUN)
    listing = "\n\n".join(
        f"[{doc_id}] {published} {domain} | {title}\n{excerpt}"
        for doc_id, published, domain, title, excerpt in docs
    )
    return f"""Run date: {until}. Subject: {q.subject.description}.
Question: {q.question}
Lookback: {q.lookback_days} days (documents published after {after}).

Documents found by keyword search, best match first (they may be off-topic):

{listing or "(none)"}

Return:
- summary: one line of at most 25 words, plain and specific (name the bodies, entities and
  actions). If nothing bears on the question, say so briefly.
- Numbers: quote only numbers the documents give, as they give them; never compute, convert or
  estimate new ones.
- state, calm by default:
  - needs_attention: something could hurt the subject or needs supervisory follow-up now, such as
    enforcement, an incident, stress, a depeg or escalation, and it is significant or critical.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive, however significant.
  - stable: nothing relevant happened in the lookback.
- citations: the documents the answer relies on, most important first, each with a short
  verbatim quote from it that supports the answer. Empty if none."""


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


async def run() -> None:
    conn = frozen()
    meta: dict[str, object] = {}
    started = time.monotonic()

    async def one(q: EvalQuestion) -> ExportedAnswer:
        after, until = q.window(SCORED_RUN)
        ids = keyword_hits(conn, q.subject, after, until)[:TOP_DOCUMENTS]
        rows = [r for i in ids if (r := document(conn, i)) is not None]
        docs = [
            (r["id"], r["published"], r["domain"], r["title"], opening(r, EXCERPT_CHARS))
            for r in rows
        ]
        a = await ask("v1", ANSWER_MODEL, SYSTEM, prompt(q, docs), V1Answer)
        texts = {r["id"]: _norm(r["text"] + " " + r["title"]) for r in rows}
        cited = [c for c in a.citations if c.document_id in texts]
        meta[q.id] = {
            "retrieved": len(rows),
            "cited": len(a.citations),
            "cited_outside_retrieved": len(a.citations) - len(cited),
            "quotes_verbatim": sum(_norm(c.quote) in texts[c.document_id] for c in cited),
        }
        return ExportedAnswer(
            variant="V1",
            eval_id=q.id,
            question_id=q.question_id,
            subject_id=q.subject_id,
            run_id=SCORED_RUN.isoformat(),
            summary=a.summary.strip(),
            state=a.state,
            citations=[Citation(document_id=c.document_id, quote=c.quote) for c in cited],
            changes=[],
        )

    out = list(await asyncio.gather(*(one(q) for q in all_questions())))
    meta["wall_seconds"] = round(time.monotonic() - started, 1)
    (EVAL_DIR / "v1").mkdir(parents=True, exist_ok=True)
    (EVAL_DIR / "v1" / "run.json").write_text(json.dumps(meta, indent=2))
    write_answers("V1", out)
    print("exported", len(out), "V1 answers")
