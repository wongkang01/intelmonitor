"""Run history, the run status chip and Run now.

The POC has no scheduler, so runs are manual: `im run` on the command line, or Run now in the app,
which fetches the measured series up to today and then recomputes Run 2 (as of T0) over the stored
corpus without ingesting documents. Model calls and a day's series responses are cached, so it is
quick."""

import asyncio
import logging
import sqlite3
import threading
from datetime import date, datetime
from statistics import median

from intelmonitor.ingest.series.collect import fetch_series
from intelmonitor.pipeline import runlog
from intelmonitor.pipeline.run import compute_run, run_dates
from intelmonitor.server.models import RunInfo, RunStatus
from intelmonitor.store.db import connect

log = logging.getLogger("uvicorn.error")


class RunInProgressError(RuntimeError):
    """Run now while a run is already in progress."""


def _how(trigger: str, triggered_by: str | None) -> str:
    if trigger == "manual":
        return f"Run now, {triggered_by}" if triggered_by else "Run now"
    return "Command line"


def _run_info(r: sqlite3.Row) -> RunInfo:
    started = datetime.fromisoformat(r["started_at"])
    finished = datetime.fromisoformat(r["finished_at"]) if r["finished_at"] else None
    complete = r["status"] == "complete"
    previous = date.fromisoformat(r["previous_run_id"]) if r["previous_run_id"] else None
    outcome = runlog.Outcome(
        developments=r["developments"] or 0,
        first_run=bool(r["first_run"]),
        new_count=r["new_count"] or 0,
        updated_count=r["updated_count"] or 0,
        needs_attention_count=r["needs_attention_count"] or 0,
    )
    return RunInfo(
        execution_id=r["id"],
        id=r["run_id"],
        as_of=date.fromisoformat(r["as_of"]),
        previous_run_id=r["previous_run_id"],
        status=r["status"],
        trigger=r["trigger"],
        how=_how(r["trigger"], r["triggered_by"]),
        sources=r["sources"],
        documents=r["documents"],
        developments=outcome.developments,
        new_count=outcome.new_count,
        updated_count=outcome.updated_count,
        needs_attention_count=outcome.needs_attention_count,
        result=runlog.result_line(outcome, previous) if complete else None,
        started_at=started,
        finished_at=finished,
        duration_seconds=(finished - started).total_seconds() if finished else None,
    )


def list_runs(conn: sqlite3.Connection) -> list[RunInfo]:
    """Every execution, newest first."""
    rows = conn.execute(
        "SELECT l.*, r.as_of, r.previous_run_id FROM run_log l JOIN runs r ON r.id = l.run_id "
        "ORDER BY l.started_at DESC, l.id DESC"
    ).fetchall()
    return [_run_info(r) for r in rows]


def _estimate(conn: sqlite3.Connection, run_id: str) -> float | None:
    """Median duration of the run's complete executions, else of any complete execution."""
    rows = conn.execute(
        "SELECT run_id, started_at, finished_at FROM run_log WHERE status = 'complete'"
    ).fetchall()
    durations: dict[str, list[float]] = {}
    for r in rows:
        seconds = (
            datetime.fromisoformat(r["finished_at"]) - datetime.fromisoformat(r["started_at"])
        ).total_seconds()
        durations.setdefault(r["run_id"], []).append(seconds)
    same = durations.get(run_id)
    every = [s for d in durations.values() for s in d]
    return median(same) if same else median(every) if every else None


class _RunNow:
    """The one Run now this process may have in flight."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active: RunStatus | None = None


_run_now = _RunNow()


def status(conn: sqlite3.Connection) -> RunStatus:
    """Run now from this process, else a run in progress elsewhere, such as `im run`."""
    if active := _run_now.active:
        return active
    r = conn.execute(
        "SELECT * FROM run_log WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    if r is None:
        return RunStatus(
            running=False,
            run_id=None,
            how=None,
            started_at=None,
            sources=None,
            estimate_seconds=None,
        )
    return RunStatus(
        running=True,
        run_id=r["run_id"],
        how=_how(r["trigger"], r["triggered_by"]),
        started_at=datetime.fromisoformat(r["started_at"]),
        sources=r["sources"],
        estimate_seconds=_estimate(conn, r["run_id"]),
    )


def run_now(conn: sqlite3.Connection, triggered_by: str) -> RunStatus:
    """Start recomputing Run 2 in a background thread; refuses while any run is in progress."""
    if not _run_now.lock.acquire(blocking=False):
        raise RunInProgressError("a run is already in progress")
    try:
        if status(conn).running:
            raise RunInProgressError("a run is already in progress")
        as_of = run_dates(conn)[1]
        run_id = as_of.isoformat()
        sources = conn.execute(
            "SELECT count(DISTINCT source) FROM source_documents "
            "WHERE substr(published_at, 1, 10) <= ?",
            (run_id,),
        ).fetchone()[0]
        started = RunStatus(
            running=True,
            run_id=run_id,
            how=_how("manual", triggered_by),
            started_at=datetime.now().astimezone(),
            sources=sources,
            estimate_seconds=_estimate(conn, run_id),
        )
    except BaseException:
        _run_now.lock.release()
        raise
    _run_now.active = started

    def work() -> None:
        try:
            try:
                fetch_series(connect(), date.today(), log=log.info)
            except Exception:
                log.exception("Series fetch failed; the run goes ahead with the stored series")
            asyncio.run(compute_run(as_of, log.info, "manual", triggered_by))
        except Exception:
            log.exception("Run now failed")
        finally:
            _run_now.active = None
            _run_now.lock.release()

    threading.Thread(target=work, name="run-now", daemon=True).start()
    return started
