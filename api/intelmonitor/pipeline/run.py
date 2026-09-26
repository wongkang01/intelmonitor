"""`im run`: compute a pipeline run as of a date, from the documents published on or before it.

Every model call is cached in inference_records by its input, and every derived table is rebuilt
from those calls, so rerunning after a failure resumes where it stopped.

Recomputing a complete run keeps it complete while it runs: each step swaps its tables in one
transaction, so the app keeps serving the run instead of falling back to an older one.
"""

import sqlite3
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from intelmonitor.pipeline import runlog
from intelmonitor.pipeline.answers import answer_subjects
from intelmonitor.pipeline.developments import build_developments
from intelmonitor.pipeline.diff import development_changes, previous_run, store_changes
from intelmonitor.pipeline.extract import extract_documents
from intelmonitor.pipeline.graph import store_graph
from intelmonitor.pipeline.inference import Inference
from intelmonitor.pipeline.params import RUN_SPACING_DAYS
from intelmonitor.pipeline.screen import screen_documents
from intelmonitor.pipeline.upcoming import store_upcoming
from intelmonitor.store.db import connect, get_meta
from intelmonitor.store.documents import list_documents


def run_dates(conn: sqlite3.Connection) -> tuple[date, date]:
    """Run 1 (T0 minus RUN_SPACING_DAYS) and Run 2 (T0), from the T0 stored by ingest."""
    stored = get_meta(conn, "t0")
    if stored is None:
        raise RuntimeError("no T0 in the store: run `im ingest` first")
    t0 = date.fromisoformat(stored)
    return t0 - timedelta(days=RUN_SPACING_DAYS), t0


async def compute_run(
    as_of: date,
    log: Callable[[str], None] = print,
    trigger: runlog.Trigger = "cli",
    triggered_by: str | None = None,
) -> None:
    conn = connect()
    run_id = as_of.isoformat()
    docs = [d for d in list_documents(conn) if d.published_at.date() <= as_of]
    started = time.monotonic()
    started_at = datetime.now(UTC).isoformat()
    existing = conn.execute("SELECT status FROM runs WHERE id = ?", (run_id,)).fetchone()
    recompute = existing is not None and existing["status"] == "complete"
    execution_id = runlog.start(
        conn, run_id, trigger, triggered_by, len({d.source for d in docs}), len(docs)
    )
    if recompute:
        conn.execute("UPDATE runs SET documents = ? WHERE id = ?", (len(docs), run_id))
    else:
        conn.execute(
            "INSERT OR REPLACE INTO runs (id, as_of, status, documents, started_at) "
            "VALUES (?, ?, 'running', ?, ?)",
            (run_id, run_id, len(docs), started_at),
        )
    conn.commit()
    inf = Inference(conn, run_id)

    def step(name: str) -> None:
        log(
            f"[{run_id}] {name} ({time.monotonic() - started:.0f}s, "
            f"{inf.calls} calls, {inf.cache_hits} cached)"
        )

    try:
        step(f"screen {len(docs)} documents")
        screens = await screen_documents(inf, conn, docs)
        relevant = sum(s.relevant for s in screens.values())
        step(f"extract from {relevant} relevant documents")
        _, ex = await extract_documents(inf, conn, docs, screens)
        step(
            f"extracted {ex.kept}/{ex.proposed} findings, "
            f"{ex.quotes_verified}/{ex.quotes_proposed} quotes verified; merge"
        )
        devs, merge = await build_developments(inf, conn, run_id, as_of)
        step(
            f"{merge.developments} developments from {merge.findings} findings "
            f"({merge.merged_pairs}/{merge.pairs} candidate pairs merged)"
        )
        upcoming = store_upcoming(conn, run_id, as_of, devs)
        base_id = previous_run(conn, run_id)
        changes = development_changes(conn, run_id, base_id)
        step(f"{upcoming} upcoming dates; answer questions (base run {base_id})")
        await answer_subjects(inf, conn, run_id, as_of, changes, base_id)
        if base_id:
            step(f"{store_changes(conn, run_id, base_id, changes)} changes vs {base_id}")
        conn.execute("UPDATE runs SET previous_run_id = ? WHERE id = ?", (base_id, run_id))
        nodes, edges = store_graph(conn, run_id, changes)
        step(f"graph {nodes} nodes, {edges} edges")
    except Exception as error:
        message = f"{type(error).__name__}: {error}"
        runlog.fail(conn, execution_id, message)
        if not recompute:
            conn.execute(
                "UPDATE runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
                (datetime.now(UTC).isoformat(), message, run_id),
            )
            conn.commit()
        raise
    conn.execute(
        "UPDATE runs SET status = 'complete', started_at = ?, finished_at = ?, error = NULL "
        "WHERE id = ?",
        (started_at, datetime.now(UTC).isoformat(), run_id),
    )
    conn.commit()
    # Like the run's stored changes, the counts compare with the previous as-of date, so a rerun
    # of a date reports what the date found, not what the rerun changed.
    outcome = runlog.outcome(conn, run_id, changes, base_id is None)
    runlog.finish(conn, execution_id, outcome)
    previous = date.fromisoformat(base_id) if base_id else None
    step(f"complete: {runlog.result_line(outcome, previous)}")
