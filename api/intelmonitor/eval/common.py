"""Shared setup for the phase A evaluation: the eval directory, the questions, the shared answer
format, and one cached, budget-capped Claude client for every eval-side model call."""

import asyncio
import hashlib
import json
import os
import sqlite3
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from pydantic import BaseModel

from intelmonitor.config import REPO_ROOT
from intelmonitor.pipeline.claude import scrub_parent_env
from intelmonitor.pipeline.subjects import Subject, all_subjects, questions_for
from intelmonitor.store.db import connect

EVAL_DIR = Path(os.environ.get("IM_EVAL_DIR", REPO_ROOT / "eval-runs" / "phase-a-2026-10-05"))
FROZEN_DB = EVAL_DIR / "db" / "corpus-frozen.db"
BASE_RUN = date(2026, 9, 17)
SCORED_RUN = date(2026, 9, 24)

ANSWER_MODEL = "claude-sonnet-5-5"
JUDGE_MODEL = "claude-opus-5-5"
SPEND_CAP_USD = 60.0
# With IM_EVAL_CACHED_ONLY=1 any eval-side call without a cached reply fails: re-scoring is free.
CACHED_ONLY = os.environ.get("IM_EVAL_CACHED_ONLY") == "1"

Variant = Literal["V0-C", "V1", "V2"]
State = Literal["stable", "watch", "needs_attention", "new"]

# The exposure question, a known gap: the pipeline has no lending-exposure data.
EXPOSURE_TEXT = (
    "Which markets that UOB has significant lending exposure to (e.g. Greater China commercial "
    "real estate, ASEAN) had adverse developments, and what might it mean for UOB?"
)
EXPOSURE_ID = "uob/custom.exposure"

# (subject, standing question): topic, group and entity scopes; 7-day news flow, 30-day state,
# a series-driven question with numbers, and an incident question on a bank.
STANDING = [
    ("banking-regulation", "topic.new-developments"),
    ("geopolitics", "geopolitics.financial-channels"),
    ("singapore-banks", "group.peer-moves"),
    ("sea-regional-banks", "group.common-issues"),
    ("mas", "central-bank.regulation"),
    ("ocbc", "bank.incidents"),
]


class EvalQuestion(BaseModel):
    id: str  # "<subject>/<question id>"
    subject_id: str
    question_id: str
    question: str
    lookback_days: int
    custom: bool = False

    def window(self, as_of: date) -> tuple[date, date]:
        """(after, until]: documents published after the first and up to the second."""
        return as_of - timedelta(days=self.lookback_days), as_of

    @property
    def subject(self) -> Subject:
        return all_subjects()[self.subject_id]


def standing_questions() -> list[EvalQuestion]:
    out: list[EvalQuestion] = []
    for subject_id, question_id in STANDING:
        q = next(q for q in questions_for(all_subjects()[subject_id]) if q.id == question_id)
        out.append(
            EvalQuestion(
                id=f"{subject_id}/{question_id}",
                subject_id=subject_id,
                question_id=question_id,
                question=q.question,
                lookback_days=q.lookback_days,
            )
        )
    return out


EXPOSURE_CONFIG = EVAL_DIR / "v2" / "exposure-config.json"


def all_questions() -> list[EvalQuestion]:
    """The 6 standing questions and, once V2 has drafted it, the exposure question as the custom
    path worded it (question and lookback)."""
    out = standing_questions()
    if EXPOSURE_CONFIG.exists():
        c = json.loads(EXPOSURE_CONFIG.read_text())
        out.append(
            EvalQuestion(
                id=EXPOSURE_ID,
                subject_id="uob",
                question_id="custom.exposure",
                question=c["question"],
                lookback_days=c["lookback_days"],
                custom=True,
            )
        )
    return out


# ---- the shared answer format (eval-plan.md, "Code needed")


class Citation(BaseModel):
    document_id: str | None = None  # corpus document
    url: str | None = None  # V0: a web page
    quote: str | None = None
    development_id: str | None = None  # V2: the development the document came through


class ExportedAnswer(BaseModel):
    variant: Variant
    eval_id: str
    question_id: str
    subject_id: str
    run_id: str
    summary: str
    state: State
    citations: list[Citation]
    changes: list[str]  # V2: cited development ids flagged new or updated since the base run
    facts: list[str] = []  # series facts the answer was given and cites (V2)


def export_path(variant: Variant) -> Path:
    return EVAL_DIR / "answers" / f"{variant}.json"


def write_answers(variant: Variant, answers: list[ExportedAnswer]) -> None:
    path = export_path(variant)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([a.model_dump() for a in answers], indent=2))


def read_answers(variant: Variant) -> list[ExportedAnswer]:
    path = export_path(variant)
    if not path.exists():
        return []
    return [ExportedAnswer.model_validate(a) for a in json.loads(path.read_text())]


# ---- corpus access (read only, on the frozen copy)


def frozen() -> sqlite3.Connection:
    return connect(FROZEN_DB)


def window_documents(conn: sqlite3.Connection, after: date, until: date) -> list[sqlite3.Row]:
    """Non-data documents published after `after` and up to `until`, oldest first."""
    return conn.execute(
        "SELECT id, title, text, domain, url, canonical_url, collection, "
        "substr(published_at, 1, 10) AS published FROM source_documents "
        "WHERE collection != 'data' AND substr(published_at, 1, 10) > ? "
        "AND substr(published_at, 1, 10) <= ? ORDER BY published_at, id",
        (after.isoformat(), until.isoformat()),
    ).fetchall()


def document(conn: sqlite3.Connection, doc_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, title, text, domain, url, collection, substr(published_at, 1, 10) AS published "
        "FROM source_documents WHERE id = ?",
        (doc_id,),
    ).fetchone()


def opening(row: sqlite3.Row, chars: int) -> str:
    text = " ".join(str(row["text"]).split())
    return text[:chars] + ("..." if len(text) > chars else "")


def search_terms(subject: Subject) -> list[str]:
    """The subject's name and aliases, its members' for a group, or a topic's keywords."""
    from intelmonitor.seed import load_subjects

    seed = load_subjects()
    entities = {e.id: e for e in seed.entities}
    if subject.type == "topic":
        topic = next(t for t in seed.topics if t.id == subject.id)
        return [topic.name, *topic.keywords]
    ids = list(subject.members) if subject.type == "group" else [subject.id]
    terms = [subject.name] if subject.type == "group" else []
    for i in ids:
        terms += [entities[i].name, *entities[i].aliases]
    return list(dict.fromkeys(terms))


def fts_query(terms: list[str]) -> str:
    return " OR ".join('"' + t.replace('"', "") + '"' for t in terms)


def keyword_hits(conn: sqlite3.Connection, subject: Subject, after: date, until: date) -> list[str]:
    """Document ids matching the subject's terms in title or text, best bm25 first."""
    rows = conn.execute(
        "SELECT f.document_id FROM documents_fts f JOIN source_documents d ON d.id = f.document_id "
        "WHERE documents_fts MATCH ? AND d.collection != 'data' "
        "AND substr(d.published_at, 1, 10) > ? AND substr(d.published_at, 1, 10) <= ? "
        "ORDER BY bm25(documents_fts, 4.0, 1.0)",
        (fts_query(search_terms(subject)), after.isoformat(), until.isoformat()),
    ).fetchall()
    return [str(r[0]) for r in rows]


# ---- Claude for eval-side calls (V1, V0-C, gold, judge): cached by input hash, budget-capped

CACHE_DIR = EVAL_DIR / "cache"
_limit: asyncio.Semaphore | None = None


class BudgetExceeded(RuntimeError):
    pass


class NotCached(RuntimeError):
    pass


def _cache_files() -> list[Path]:
    return list(CACHE_DIR.glob("*/*.json")) if CACHE_DIR.exists() else []


def eval_spend() -> dict[str, float]:
    """Recorded cost of eval-side calls by group (the cache directory's first level)."""
    out: dict[str, float] = {}
    for path in _cache_files():
        out[path.parent.name] = out.get(path.parent.name, 0.0) + float(
            json.loads(path.read_text())["usage"]["cost_usd"] or 0.0
        )
    return out


def v2_spend() -> float:
    """Cost of the Claude calls V2 made in its own store copy (answer and custom stages)."""
    path = EVAL_DIR / "db" / "v2.db"
    if not path.exists():
        return 0.0
    with sqlite3.connect(path) as conn:
        row = conn.execute(
            "SELECT coalesce(sum(cost_usd), 0) FROM inference_records WHERE model = ?",
            (ANSWER_MODEL,),
        ).fetchone()
    return float(row[0])


def total_spend() -> float:
    return sum(eval_spend().values()) + v2_spend()


def check_budget(reserve: float = 1.0) -> None:
    if (spent := total_spend()) + reserve > SPEND_CAP_USD:
        raise BudgetExceeded(f"spent ${spent:.2f}; the next call could pass ${SPEND_CAP_USD}")


def _key(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


async def ask[T: BaseModel](
    group: str,
    model: str,
    system: str,
    prompt: str,
    schema: type[T],
    *,
    tools: list[str] | None = None,
    max_turns: int | None = None,
    reserve: float = 1.0,
) -> T:
    """One structured Claude turn through the Agent SDK. Replies are cached under
    cache/<group>/<input hash>.json with their usage, so a rerun costs nothing."""
    global _limit
    schema_json = schema.model_json_schema()
    key = _key(
        {"model": model, "system": system, "prompt": prompt, "schema": schema_json, "tools": tools}
    )
    path = CACHE_DIR / group / f"{key}.json"
    if path.exists():
        return schema.model_validate(json.loads(path.read_text())["output"])
    if CACHED_ONLY:
        raise NotCached(f"{group}: no cached reply for {key[:12]}")
    if _limit is None:
        _limit = asyncio.Semaphore(4)
    async with _limit:
        check_budget(reserve)
        scrub_parent_env()
        options = ClaudeAgentOptions(
            model=model,
            system_prompt=system,
            tools=tools or [],
            allowed_tools=tools or [],
            setting_sources=[],
            strict_mcp_config=True,
            skills=[],
            max_turns=max_turns,
            output_format={"type": "json_schema", "schema": schema_json},
        )
        error: Exception | None = None
        for attempt in range(3):
            started = time.monotonic()
            try:
                result: ResultMessage | None = None
                async for message in query(prompt=prompt, options=options):
                    if isinstance(message, ResultMessage):
                        result = message
                if result is None or result.is_error or result.structured_output is None:
                    raise RuntimeError(f"no structured output: {result.result if result else ''}")
                output = schema.model_validate(result.structured_output)
            except Exception as e:  # retried: transient CLI and validation failures
                error = e
                await asyncio.sleep(10 * (attempt + 1))
                continue
            usage = result.usage or {}
            record = {
                "group": group,
                "model": model,
                "models_used": list(result.model_usage or {}),
                "output": output.model_dump(mode="json"),
                "usage": {
                    "cost_usd": result.total_cost_usd,
                    "input_tokens": sum(
                        int(v)
                        for k in (
                            "input_tokens",
                            "cache_read_input_tokens",
                            "cache_creation_input_tokens",
                        )
                        if isinstance(v := usage.get(k), int)
                    ),
                    "output_tokens": usage.get("output_tokens"),
                    "duration_ms": int((time.monotonic() - started) * 1000),
                    "turns": result.num_turns,
                },
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(record, indent=1))
            return output
        raise RuntimeError(f"{group}: failed after 3 attempts") from error


def call_records(group: str) -> list[dict[str, object]]:
    return [json.loads(p.read_text()) for p in sorted((CACHE_DIR / group).glob("*.json"))]
