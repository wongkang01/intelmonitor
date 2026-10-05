"""V2: the current pipeline in its own copy of the frozen store. Every stage up to the answers is
replayed from recorded model calls only (no Jev or Claude call may be live), then the answer step
runs for the evaluated subjects on Sonnet 5.5, at the base run and then the scored run, so the
scored answers see the base answers as their previous run, as in `im run`.

The model is part of every call's cache key (pipeline/inference.py), so switching it globally would
recompute extraction and routing. Instead the setting is switched only around the answer step,
which needs no change to the pipeline code."""

import json
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, timedelta
from typing import Any

from intelmonitor.config import get_settings
from intelmonitor.eval.common import (
    ANSWER_MODEL,
    BASE_RUN,
    EVAL_DIR,
    EXPOSURE_CONFIG,
    EXPOSURE_ID,
    EXPOSURE_TEXT,
    FROZEN_DB,
    SCORED_RUN,
    Citation,
    ExportedAnswer,
    check_budget,
    standing_questions,
    write_answers,
)
from intelmonitor.pipeline.answers import answer_subject, load_run_developments
from intelmonitor.pipeline.custom import CustomConfig, answer_run, candidates, draft_config
from intelmonitor.pipeline.detectors import store_detections
from intelmonitor.pipeline.developments import build_developments
from intelmonitor.pipeline.diff import DevelopmentChange, development_changes, previous_run
from intelmonitor.pipeline.extract import extract_documents
from intelmonitor.pipeline.indicators import store_run_indicators
from intelmonitor.pipeline.inference import Inference
from intelmonitor.pipeline.screen import screen_documents
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.pipeline.upcoming import store_upcoming
from intelmonitor.store.db import connect
from intelmonitor.store.documents import list_documents

V2_DB = EVAL_DIR / "db" / "v2.db"
META = EVAL_DIR / "v2" / "run.json"
# Stop before the custom path sends more than this many live Jev calls in one run.
MAX_LIVE_JEV = 80


@contextmanager
def answer_model():
    """The answer step on Sonnet 5.5; every other stage keeps the configured model."""
    settings = get_settings()
    before = settings.anthropic_model
    settings.anthropic_model = ANSWER_MODEL
    try:
        yield
    finally:
        settings.anthropic_model = before


def _dev_rows(conn: sqlite3.Connection, run_id: str) -> set[tuple[Any, ...]]:
    return {
        tuple(r)
        for r in conn.execute(
            "SELECT id, title, materiality_level, first_published, last_published "
            "FROM developments WHERE run_id = ?",
            (run_id,),
        )
    }


async def replay_upstream(conn: sqlite3.Connection, as_of: date) -> dict[str, Any]:
    """Screen, extract, merge and materiality as `im run` does, from recorded calls only."""
    run_id = as_of.isoformat()
    stored = _dev_rows(conn, run_id)
    store_detections(conn, as_of)
    docs = [d for d in list_documents(conn) if d.published_at.date() <= as_of]
    texts = [d for d in docs if d.collection != "data"]
    inf = Inference(conn, run_id, recorded_only=True)
    screens = await screen_documents(inf, conn, texts)
    await extract_documents(inf, conn, texts, screens)
    devs, _ = await build_developments(inf, conn, run_id, as_of)
    store_upcoming(conn, run_id, as_of, devs)
    base_id = previous_run(conn, run_id)
    store_run_indicators(conn, run_id, as_of, date.fromisoformat(base_id) if base_id else None)
    replayed = _dev_rows(conn, run_id)
    return {
        "run_id": run_id,
        "calls_replayed": inf.cache_hits,
        "live_calls": inf.calls,
        "developments": len(replayed),
        "same_as_stored": replayed == stored,
        "differences": len(replayed ^ stored),
    }


def _exported(
    conn: sqlite3.Connection,
    eval_id: str,
    question_id: str,
    subject_id: str,
    run_id: str,
    summary: str,
    state: str,
    development_ids: list[str],
    changes: dict[str, DevelopmentChange],
    facts: list[str],
    documents: set[str] | None = None,
) -> ExportedAnswer:
    """Citations resolve each cited development to its findings' documents and first quotes;
    `documents` limits them to the documents the answer was shown (custom questions)."""
    citations: list[Citation] = []
    for dev_id in development_ids:
        for r in conn.execute(
            "SELECT s.document_id, f.quotes FROM development_sources s "
            "JOIN findings f ON f.id = s.finding_id WHERE s.run_id = ? AND s.development_id = ? "
            "ORDER BY s.document_id, f.id",
            (run_id, dev_id),
        ):
            if documents is not None and r["document_id"] not in documents:
                continue
            quotes = json.loads(r["quotes"])
            citations.append(
                Citation(
                    document_id=r["document_id"],
                    quote=quotes[0]["text"] if quotes else None,
                    development_id=dev_id,
                )
            )
    return ExportedAnswer(
        variant="V2",
        eval_id=eval_id,
        question_id=question_id,
        subject_id=subject_id,
        run_id=run_id,
        summary=summary,
        state=state,  # type: ignore[arg-type]
        citations=citations,
        changes=[d for d in development_ids if d in changes],
        facts=facts,
    )


async def run() -> None:
    check_budget(5.0)
    if not V2_DB.exists():
        V2_DB.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FROZEN_DB, V2_DB)
    conn = connect(V2_DB)
    first_new = conn.execute("SELECT coalesce(max(id), 0) FROM inference_records").fetchone()[0]
    meta: dict[str, Any] = {"replay": [], "answer_seconds": {}, "custom": {}}
    started = time.monotonic()
    for as_of in (BASE_RUN, SCORED_RUN):
        t = time.monotonic()
        info = await replay_upstream(conn, as_of)
        info["seconds"] = round(time.monotonic() - t, 1)
        meta["replay"].append(info)
        print("replayed", info)

    questions = standing_questions()
    subjects = list(dict.fromkeys(q.subject_id for q in questions))
    for as_of in (BASE_RUN, SCORED_RUN):
        run_id = as_of.isoformat()
        base_id = previous_run(conn, run_id)
        changes = development_changes(conn, run_id, base_id)
        devs = load_run_developments(conn, run_id)
        inf = Inference(conn, run_id)
        t = time.monotonic()
        with answer_model():
            for subject_id in subjects:
                await answer_subject(
                    inf, conn, run_id, as_of, all_subjects()[subject_id], devs, changes, base_id
                )
        meta["answer_seconds"][run_id] = round(time.monotonic() - t, 1)
        print("answered", run_id, inf.calls, "calls", inf.cache_hits, "cached")

    # The exposure question through the custom-question path, on the same two runs.
    t = time.monotonic()
    with answer_model():
        draft_inf = Inference(conn, None)
        config = await draft_config(draft_inf, EXPOSURE_TEXT, "uob", None)
        EXPOSURE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        EXPOSURE_CONFIG.write_text(config.model_dump_json(indent=2))
        previous: tuple[str, str] | None = None
        custom: dict[str, Any] = {}
        for as_of, before in ((BASE_RUN, BASE_RUN - timedelta(days=7)), (SCORED_RUN, BASE_RUN)):
            run_id = as_of.isoformat()
            since = as_of - timedelta(days=config.lookback_days)
            found = candidates(conn, run_id, config, since, as_of)
            print("custom candidates", run_id, len(found))
            if len(found) > MAX_LIVE_JEV:
                raise RuntimeError(f"custom path would make {len(found)} live Jev calls")
            a = await answer_run(conn, EXPOSURE_ID, run_id, as_of, config, previous, before)
            previous = (a.state, a.summary)
            custom[run_id] = {
                "candidates": len(found),
                "summary": a.summary,
                "state": a.state,
                "development_ids": a.development_ids,
                "document_ids": a.document_ids,
            }
    meta["custom"] = custom
    meta["custom_seconds"] = round(time.monotonic() - t, 1)
    meta["wall_seconds"] = round(time.monotonic() - started, 1)
    # Calls this invocation added; a resumed run counts only what it made itself.
    meta["new_records"] = [
        dict(r)
        for r in conn.execute(
            "SELECT stage, engine, model, count(*) AS calls, sum(cost_usd) AS cost_usd, "
            "sum(duration_ms) AS duration_ms FROM inference_records WHERE id > ? "
            "GROUP BY 1, 2, 3",
            (first_new,),
        )
    ]
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps(meta, indent=2))
    export(conn, config)


def export(conn: sqlite3.Connection, config: CustomConfig) -> None:
    """The scored run's answers in the shared format."""
    run_id = SCORED_RUN.isoformat()
    base_id = previous_run(conn, run_id)
    changes = development_changes(conn, run_id, base_id)
    out: list[ExportedAnswer] = []
    for q in standing_questions():
        r = conn.execute(
            "SELECT * FROM question_answers WHERE run_id = ? AND subject_id = ? AND "
            "question_id = ?",
            (run_id, q.subject_id, q.question_id),
        ).fetchone()
        series = set(json.loads(r["series_ids"]))
        facts = [
            json.loads(f["fact"])["text"]
            for f in conn.execute(
                "SELECT series_id, fact FROM run_facts WHERE run_id = ? AND subject_id = ?",
                (run_id, q.subject_id),
            )
            if f["series_id"] in series
        ]
        out.append(
            _exported(
                conn,
                q.id,
                q.question_id,
                q.subject_id,
                run_id,
                r["summary"],
                r["state"],
                json.loads(r["development_ids"]),
                changes,
                facts,
            )
        )
    meta = json.loads(META.read_text())
    c = meta["custom"][run_id]
    out.append(
        _exported(
            conn,
            EXPOSURE_ID,
            "custom.exposure",
            config.subject_id,
            run_id,
            c["summary"],
            c["state"],
            c["development_ids"],
            changes,
            [],
            documents=set(c["document_ids"]),
        )
    )
    write_answers("V2", out)
    print("exported", len(out), "V2 answers")
