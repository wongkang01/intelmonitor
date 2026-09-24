"""The run log: one row per pipeline execution, with who started it and what it found.

compute_run writes it. The server reads it for run history, the run status chip and Run now."""

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from intelmonitor.pipeline.diff import DevelopmentChange

Trigger = Literal["scheduled", "manual"]


@dataclass(frozen=True)
class Outcome:
    """What one execution found, relative to what it replaced or to the previous run."""

    developments: int
    first_run: bool
    new_count: int
    updated_count: int
    needs_attention_count: int


def outcome(
    conn: sqlite3.Connection,
    run_id: str,
    changes: dict[str, DevelopmentChange],
    first_run: bool,
) -> Outcome:
    attention = {
        r["id"]
        for r in conn.execute(
            "SELECT id FROM developments WHERE run_id = ? AND needs_attention = 1", (run_id,)
        )
    }
    total = conn.execute(
        "SELECT count(*) FROM developments WHERE run_id = ?", (run_id,)
    ).fetchone()[0]
    return Outcome(
        developments=total,
        first_run=first_run,
        new_count=sum(c.kind == "new_development" for c in changes.values()),
        updated_count=sum(c.kind == "updated_development" for c in changes.values()),
        needs_attention_count=len(attention & changes.keys()),
    )


def result_line(o: Outcome) -> str:
    """ "4 new, 1 needs attention", "First run, 120 developments" or "No new developments"."""
    if o.first_run:
        return f"First run, {o.developments} developments"
    parts = [
        f"{o.new_count} new" if o.new_count else "",
        f"{o.updated_count} updated" if o.updated_count else "",
        f"{o.needs_attention_count} needs attention" if o.needs_attention_count else "",
    ]
    return ", ".join(p for p in parts if p) or "No new developments"


def start(
    conn: sqlite3.Connection,
    run_id: str,
    trigger: Trigger,
    triggered_by: str | None,
    sources: int,
    documents: int,
) -> int:
    cursor = conn.execute(
        "INSERT INTO run_log (run_id, trigger, triggered_by, status, sources, documents, "
        "started_at) VALUES (?, ?, ?, 'running', ?, ?, ?)",
        (run_id, trigger, triggered_by, sources, documents, datetime.now(UTC).isoformat()),
    )
    conn.commit()
    assert cursor.lastrowid is not None
    return cursor.lastrowid


def finish(
    conn: sqlite3.Connection, execution_id: int, o: Outcome, finished_at: str | None = None
) -> None:
    conn.execute(
        "UPDATE run_log SET status = 'complete', finished_at = ?, developments = ?, "
        "first_run = ?, new_count = ?, updated_count = ?, needs_attention_count = ? "
        "WHERE id = ?",
        (
            finished_at or datetime.now(UTC).isoformat(),
            o.developments,
            int(o.first_run),
            o.new_count,
            o.updated_count,
            o.needs_attention_count,
            execution_id,
        ),
    )
    conn.commit()


def fail(conn: sqlite3.Connection, execution_id: int, error: str) -> None:
    conn.execute(
        "UPDATE run_log SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
        (datetime.now(UTC).isoformat(), error, execution_id),
    )
    conn.commit()


def interrupt_stale(conn: sqlite3.Connection) -> None:
    """At server start, executions still marked running died with an earlier process."""
    conn.execute(
        "UPDATE run_log SET status = 'failed', finished_at = ?, error = 'interrupted' "
        "WHERE status = 'running'",
        (datetime.now(UTC).isoformat(),),
    )
    conn.commit()


def backfill(conn: sqlite3.Connection) -> None:
    """Log runs computed before the run log existed as scheduled executions, from their stored
    changes against the previous run."""
    for r in conn.execute(
        "SELECT * FROM runs WHERE id NOT IN (SELECT run_id FROM run_log)"
    ).fetchall():
        changes = {
            c["ref_id"]: DevelopmentChange(c["kind"], [])
            for c in conn.execute(
                "SELECT kind, ref_id FROM run_changes "
                "WHERE run_id = ? AND kind != 'question_state'",
                (r["id"],),
            )
        }
        sources = conn.execute(
            "SELECT count(DISTINCT source) FROM source_documents "
            "WHERE substr(published_at, 1, 10) <= ?",
            (r["as_of"],),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO run_log (run_id, trigger, status, sources, documents, started_at, "
            "finished_at, error) VALUES (?, 'scheduled', ?, ?, ?, ?, ?, ?)",
            (
                r["id"],
                r["status"],
                sources,
                r["documents"],
                r["started_at"],
                r["finished_at"],
                r["error"],
            ),
        )
        execution_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        if r["status"] == "complete":
            first = r["previous_run_id"] is None
            finish(conn, execution_id, outcome(conn, r["id"], changes, first), r["finished_at"])
    conn.commit()
