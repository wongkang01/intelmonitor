"""V0-C: plain Claude (Sonnet 5.5) with web search, one prompt per question "as of 2026-09-24",
asking for a state and source links. The cited pages are fetched once and kept under v0/pages/
for the judge; a page that cannot be fetched leaves its claims unsupported."""

import asyncio
import hashlib
import json
import time

import httpx
import trafilatura
from pydantic import BaseModel, Field

from intelmonitor.eval.common import (
    ANSWER_MODEL,
    CACHED_ONLY,
    EVAL_DIR,
    SCORED_RUN,
    Citation,
    EvalQuestion,
    ExportedAnswer,
    State,
    all_questions,
    ask,
    write_answers,
)

PAGES = EVAL_DIR / "v0" / "pages"


class V0Source(BaseModel):
    url: str
    title: str
    published: str = Field(description="Publication date as YYYY-MM-DD, or empty if unknown")
    quote: str = Field(description="A short quote from the page that supports the answer")


class V0Answer(BaseModel):
    summary: str
    state: State
    sources: list[V0Source]


SYSTEM = "You are a research assistant for a financial supervisor in Singapore."


def prompt(q: EvalQuestion) -> str:
    after, until = q.window(SCORED_RUN)
    return f"""Answer this standing question for a financial supervisor's monitoring dashboard, as
of {until}. Use web search. Consider only what was published after {after} and up to {until}
(the last {q.lookback_days} days); ignore anything later.

Subject: {q.subject.description}.
Question: {q.question}

Return:
- summary: one line of at most 25 words, plain and specific (name the bodies, entities and
  actions). If nothing bears on the question, say so briefly.
- state:
  - needs_attention: something could hurt the subject or needs supervisory follow-up now.
  - watch: something adverse or uncertain is developing that could become material.
  - new: relevant new items that are routine, neutral or positive.
  - stable: nothing relevant happened in the period.
- sources: the web pages the answer relies on, most important first, with their URL, title,
  publication date and a short quote supporting the answer."""


def page_path(url: str):
    return PAGES / f"{hashlib.sha256(url.encode()).hexdigest()[:24]}.json"


def fetch_page(url: str) -> dict[str, object]:
    """The page's main text, fetched once and kept; empty text when it cannot be retrieved."""
    path = page_path(url)
    if path.exists():
        return json.loads(path.read_text())
    if CACHED_ONLY:
        return {"url": url, "status": None, "text": ""}
    record: dict[str, object] = {"url": url, "status": None, "text": ""}
    try:
        r = httpx.get(
            url,
            follow_redirects=True,
            timeout=30,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh) IntelMonitor-eval"},
        )
        record["status"] = r.status_code
        if r.status_code == 200:
            record["text"] = trafilatura.extract(r.text, include_comments=False) or ""
            meta = trafilatura.extract_metadata(r.text)
            record["date"] = meta.date if meta else None
    except Exception as error:
        record["error"] = f"{type(error).__name__}: {error}"
    PAGES.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1))
    return record


async def run() -> None:
    started = time.monotonic()

    async def one(q: EvalQuestion) -> ExportedAnswer:
        a = await ask(
            "v0",
            ANSWER_MODEL,
            SYSTEM,
            prompt(q),
            V0Answer,
            tools=["WebSearch", "WebFetch"],
            max_turns=16,
            reserve=2.0,
        )
        for s in a.sources:
            await asyncio.to_thread(fetch_page, s.url)
        return ExportedAnswer(
            variant="V0-C",
            eval_id=q.id,
            question_id=q.question_id,
            subject_id=q.subject_id,
            run_id=SCORED_RUN.isoformat(),
            summary=a.summary.strip(),
            state=a.state,
            citations=[Citation(url=s.url, quote=s.quote or None) for s in a.sources],
            changes=[],
        )

    out = list(await asyncio.gather(*(one(q) for q in all_questions())))
    (EVAL_DIR / "v0").mkdir(parents=True, exist_ok=True)
    (EVAL_DIR / "v0" / "run.json").write_text(
        json.dumps({"wall_seconds": round(time.monotonic() - started, 1)})
    )
    write_answers("V0-C", out)
    print("exported", len(out), "V0-C answers")
