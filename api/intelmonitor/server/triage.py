"""Analyst review and triage: Mark reviewed per subject, read, flagged and dismissed per
development, and the subjects the analyst follows. The POC is single-user, so all of it is global
state. Queries reads it back (baseline, is_read) to count what is new."""

import sqlite3
from datetime import datetime

from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.server.models import Review, SubjectRef, Triage, TriageChange
from intelmonitor.server.queries import NotFoundError, Queries, now, subject, subject_ref
from intelmonitor.store.db import get_meta, set_meta


def mark_reviewed(q: Queries, subject_ids: list[str]) -> list[Review]:
    """Sets each subject's review watermark to the latest run."""
    at = now()
    reviews: list[Review] = []
    for sid in dict.fromkeys(subject_ids):
        cursor = q.conn.execute(
            "INSERT INTO analyst_actions (kind, subject_id, run_id, created_at) "
            "VALUES ('review', ?, ?, ?)",
            (sid, q.run.id, at),
        )
        assert cursor.lastrowid is not None
        reviews.append(
            Review(
                id=cursor.lastrowid,
                subject_id=sid,
                run_id=q.run.id,
                created_at=datetime.fromisoformat(at),
            )
        )
    q.conn.commit()
    return reviews


def undo_review(conn: sqlite3.Connection, review_id: int) -> None:
    """Removes a review, so the subject's watermark goes back to its review before."""
    cursor = conn.execute(
        "DELETE FROM analyst_actions WHERE id = ? AND kind = 'review'", (review_id,)
    )
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"review {review_id}")


def set_triage(q: Queries, development_id: str, change: TriageChange) -> Triage:
    """Applies the given states. Read records the latest run, so a later change unreads it."""
    q.development(development_id)
    at = now()
    q.conn.execute(
        "INSERT OR IGNORE INTO development_triage (development_id) VALUES (?)", (development_id,)
    )
    # Not relevant hides the development too.
    dismissed = True if change.not_relevant else change.dismissed
    for column, value, on in (
        ("read_run_id", change.read, q.run.id),
        ("flagged_at", change.flagged, at),
        ("dismissed_at", dismissed, at),
        ("not_relevant_at", change.not_relevant, at),
    ):
        if value is not None:
            q.conn.execute(
                f"UPDATE development_triage SET {column} = ? WHERE development_id = ?",
                (on if value else None, development_id),
            )
    q.conn.commit()
    return triage(q, development_id)


def triage(q: Queries, development_id: str) -> Triage:
    row = q.conn.execute(
        "SELECT * FROM development_triage WHERE development_id = ?", (development_id,)
    ).fetchone()
    return Triage(
        development_id=development_id,
        read=row is not None and q.is_read(development_id, row["read_run_id"]),
        flagged=row is not None and row["flagged_at"] is not None,
        dismissed=row is not None and row["dismissed_at"] is not None,
        not_relevant=row is not None and row["not_relevant_at"] is not None,
    )


def mark_read(q: Queries, development_ids: list[str]) -> None:
    q.conn.executemany(
        "INSERT INTO development_triage (development_id, read_run_id) VALUES (?, ?) "
        "ON CONFLICT (development_id) DO UPDATE SET read_run_id = excluded.read_run_id",
        [(i, q.run.id) for i in development_ids],
    )
    q.conn.commit()


# ---- follows


def followed_ids(conn: sqlite3.Connection) -> list[str]:
    """Followed subjects still in the seed, oldest follow first."""
    seeded = all_subjects()
    return [
        str(r["subject_id"])
        for r in conn.execute("SELECT subject_id FROM follows ORDER BY created_at, rowid")
        if r["subject_id"] in seeded
    ]


def follows(conn: sqlite3.Connection) -> list[SubjectRef]:
    return [subject_ref(i) for i in followed_ids(conn)]


def follow(conn: sqlite3.Connection, subject_ids: list[str]) -> None:
    at = now()
    conn.executemany(
        "INSERT OR IGNORE INTO follows (subject_id, created_at) VALUES (?, ?)",
        [(subject(i).id, at) for i in subject_ids],
    )
    conn.commit()


def unfollow(conn: sqlite3.Connection, subject_id: str) -> None:
    conn.execute("DELETE FROM follows WHERE subject_id = ?", (subject(subject_id).id,))
    conn.commit()


def seed_follows(conn: sqlite3.Connection) -> None:
    """Once per store: follow every subject on a dashboard, in sidebar order."""
    if get_meta(conn, "follows_seeded"):
        return
    rows = conn.execute(
        "SELECT j.value AS id FROM dashboards d, json_each(d.spec, '$.subject_ids') j "
        "WHERE d.deleted_at IS NULL ORDER BY d.position, d.created_at, j.key"
    )
    follow(conn, list(dict.fromkeys(str(r["id"]) for r in rows)))
    set_meta(conn, "follows_seeded", now())
