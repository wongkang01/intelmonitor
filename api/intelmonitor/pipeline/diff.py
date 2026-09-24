"""Step 9: what changed since the previous run (Run 2 vs Run 1): new developments, updated
developments (new sources) and changed question states, written to run_changes."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class DevelopmentChange:
    kind: Literal["new_development", "updated_development"]
    new_document_ids: list[str]


def previous_run(conn: sqlite3.Connection, as_of: str) -> str | None:
    """The latest complete run before `as_of`."""
    row = conn.execute(
        "SELECT id FROM runs WHERE as_of < ? AND status = 'complete' ORDER BY as_of DESC LIMIT 1",
        (as_of,),
    ).fetchone()
    return None if row is None else str(row["id"])


def development_documents(conn: sqlite3.Connection, run_id: str) -> dict[str, set[str]]:
    """Each development's document ids in a run."""
    out: dict[str, set[str]] = {}
    for r in conn.execute(
        "SELECT development_id, document_id FROM development_sources WHERE run_id = ?", (run_id,)
    ):
        out.setdefault(r["development_id"], set()).add(r["document_id"])
    return out


def compare(
    current: dict[str, set[str]], base: dict[str, set[str]]
) -> dict[str, DevelopmentChange]:
    """New and updated developments in `current` relative to `base`, by id."""
    changes: dict[str, DevelopmentChange] = {}
    for dev_id, docs in current.items():
        if dev_id not in base:
            changes[dev_id] = DevelopmentChange("new_development", sorted(docs))
        elif added := docs - base[dev_id]:
            changes[dev_id] = DevelopmentChange("updated_development", sorted(added))
    return changes


def development_changes(
    conn: sqlite3.Connection, run_id: str, base_id: str | None
) -> dict[str, DevelopmentChange]:
    """New and updated developments by id. Without a base run every development is new."""
    base = development_documents(conn, base_id) if base_id else {}
    return compare(development_documents(conn, run_id), base)


def store_changes(
    conn: sqlite3.Connection,
    run_id: str,
    base_id: str,
    dev_changes: dict[str, DevelopmentChange],
) -> int:
    """Write development and question-state changes against `base_id`; returns the row count."""
    conn.execute("DELETE FROM run_changes WHERE run_id = ?", (run_id,))
    rows: list[tuple[str, str, str, str | None, str, str]] = [
        (run_id, base_id, c.kind, None, dev_id, json.dumps({"new_documents": c.new_document_ids}))
        for dev_id, c in sorted(dev_changes.items())
    ]
    for r in conn.execute(
        "SELECT a.subject_id, a.question_id, b.state AS old_state, b.summary AS old_summary, "
        "a.state, a.summary FROM question_answers a JOIN question_answers b "
        "ON b.run_id = ? AND b.subject_id = a.subject_id AND b.question_id = a.question_id "
        "WHERE a.run_id = ? AND a.state != b.state ORDER BY a.subject_id, a.question_id",
        (base_id, run_id),
    ):
        detail = {
            "from": r["old_state"],
            "to": r["state"],
            "from_summary": r["old_summary"],
            "to_summary": r["summary"],
        }
        rows.append(
            (
                run_id,
                base_id,
                "question_state",
                r["subject_id"],
                r["question_id"],
                json.dumps(detail),
            )
        )
    conn.executemany(
        "INSERT INTO run_changes (run_id, base_run_id, kind, subject_id, ref_id, detail) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)
