"""Dashboards: stored as DashboardSpec JSON. The starter dashboards in seed/dashboards.yaml are
inserted once, the first time the store has none, so deleting one keeps it deleted.
Every stored dashboard has a color, so reordering the sidebar never recolors one.
Deleting sets deleted_at and restoring clears it; every read skips deleted dashboards. A deleted
dashboard keeps its position, so an Undo puts it back where it was. The API purges it a day later
(purge_deleted in store/db.py)."""

import sqlite3
import uuid
from collections import Counter

import yaml
from pydantic import TypeAdapter

from intelmonitor.config import SEED_DIR
from intelmonitor.server.custom_questions import keep_ids
from intelmonitor.server.queries import NotFoundError, now
from intelmonitor.server.widgets import (
    CUSTOM_PREFIX,
    DASHBOARD_COLORS,
    Dashboard,
    DashboardColor,
    DashboardSpec,
    QuestionWidget,
)
from intelmonitor.store.db import get_meta, set_meta


class StarterDashboard(DashboardSpec):
    id: str


class OrderError(ValueError):
    """A new sidebar order that is not exactly the stored dashboards."""


def seed_dashboards(conn: sqlite3.Connection) -> None:
    _store_colors(conn)
    if get_meta(conn, "dashboards_seeded"):
        return
    raw = yaml.safe_load((SEED_DIR / "dashboards.yaml").read_text())
    for position, d in enumerate(TypeAdapter(list[StarterDashboard]).validate_python(raw)):
        spec = DashboardSpec.model_validate(d.model_dump(exclude={"id"}))
        _insert(conn, d.id, spec, starter=True, position=position)
    set_meta(conn, "dashboards_seeded", now())


def _store_colors(conn: sqlite3.Connection) -> None:
    """Stores the color that dashboards saved before colors were stored showed, which came from
    their position."""
    rows = conn.execute(
        "SELECT id, spec, position FROM dashboards WHERE json_extract(spec, '$.color') IS NULL"
    ).fetchall()
    for row in rows:
        spec = DashboardSpec.model_validate_json(row["spec"])
        spec.color = DASHBOARD_COLORS[row["position"] % len(DASHBOARD_COLORS)]
        conn.execute(
            "UPDATE dashboards SET spec = ? WHERE id = ?", (spec.model_dump_json(), row["id"])
        )
    conn.commit()


def _next_color(conn: sqlite3.Connection) -> DashboardColor:
    """The least used color, earliest in the palette on a tie."""
    used = Counter(d.color for d in list_dashboards(conn))
    return min(DASHBOARD_COLORS, key=lambda c: used[c])


def _insert(
    conn: sqlite3.Connection, dashboard_id: str, spec: DashboardSpec, starter: bool, position: int
) -> None:
    if spec.color is None:
        spec = spec.model_copy(update={"color": _next_color(conn)})
    at = now()
    conn.execute(
        "INSERT OR IGNORE INTO dashboards (id, spec, starter, position, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (dashboard_id, spec.model_dump_json(), int(starter), position, at, at),
    )
    conn.commit()


def _from_row(row: sqlite3.Row) -> Dashboard:
    spec = DashboardSpec.model_validate_json(row["spec"])
    return Dashboard(
        **spec.model_dump(),
        id=row["id"],
        starter=bool(row["starter"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_dashboards(conn: sqlite3.Connection) -> list[Dashboard]:
    rows = conn.execute(
        "SELECT * FROM dashboards WHERE deleted_at IS NULL ORDER BY position, created_at"
    ).fetchall()
    return [_from_row(r) for r in rows]


def get_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> Dashboard:
    row = conn.execute(
        "SELECT * FROM dashboards WHERE id = ? AND deleted_at IS NULL", (dashboard_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"dashboard {dashboard_id}")
    return _from_row(row)


def _keep_custom_questions(conn: sqlite3.Connection, spec: DashboardSpec) -> None:
    """A saved dashboard keeps the draft custom questions its widgets show (Generate adds
    widgets for drafts, which become the user's questions once the dashboard is created)."""
    keep_ids(
        conn,
        [
            w.settings.question_id
            for w in spec.widgets
            if isinstance(w, QuestionWidget) and w.settings.question_id.startswith(CUSTOM_PREFIX)
        ],
    )


def create_dashboard(conn: sqlite3.Connection, spec: DashboardSpec) -> Dashboard:
    _keep_custom_questions(conn, spec)
    dashboard_id = uuid.uuid4().hex[:12]
    position = conn.execute("SELECT coalesce(max(position), -1) + 1 FROM dashboards").fetchone()[0]
    _insert(conn, dashboard_id, spec, starter=False, position=position)
    return get_dashboard(conn, dashboard_id)


def update_dashboard(conn: sqlite3.Connection, dashboard_id: str, spec: DashboardSpec) -> Dashboard:
    """Replaces the spec; a spec without a color keeps the stored one."""
    if spec.color is None:
        spec = spec.model_copy(update={"color": get_dashboard(conn, dashboard_id).color})
    _keep_custom_questions(conn, spec)
    cursor = conn.execute(
        "UPDATE dashboards SET spec = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        (spec.model_dump_json(), now(), dashboard_id),
    )
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"dashboard {dashboard_id}")
    return get_dashboard(conn, dashboard_id)


def reorder_dashboards(conn: sqlite3.Connection, ids: list[str]) -> list[Dashboard]:
    """Rewrites the sidebar order: `ids` lists every dashboard once, first to last."""
    stored = {r["id"] for r in conn.execute("SELECT id FROM dashboards WHERE deleted_at IS NULL")}
    if len(ids) != len(set(ids)) or set(ids) != stored:
        raise OrderError("the order must list every dashboard exactly once")
    conn.executemany(
        "UPDATE dashboards SET position = ? WHERE id = ?", [(i, d) for i, d in enumerate(ids)]
    )
    conn.commit()
    return list_dashboards(conn)


def delete_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> None:
    cursor = conn.execute(
        "UPDATE dashboards SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
        (now(), dashboard_id),
    )
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"dashboard {dashboard_id}")


def restore_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> Dashboard:
    """Undoes a delete. Restoring a dashboard that is not deleted changes nothing."""
    conn.execute("UPDATE dashboards SET deleted_at = NULL WHERE id = ?", (dashboard_id,))
    conn.commit()
    return get_dashboard(conn, dashboard_id)


def drop_question_widgets(conn: sqlite3.Connection, question_id: str) -> None:
    """Removes the widgets that show a custom question from every dashboard, deleted ones too, so
    a restored dashboard never shows a question that is gone."""
    for row in conn.execute("SELECT id, spec FROM dashboards").fetchall():
        spec = DashboardSpec.model_validate_json(row["spec"])
        kept = [
            w
            for w in spec.widgets
            if not (isinstance(w, QuestionWidget) and w.settings.question_id == question_id)
        ]
        if len(kept) != len(spec.widgets):
            conn.execute(
                "UPDATE dashboards SET spec = ?, updated_at = ? WHERE id = ?",
                (spec.model_copy(update={"widgets": kept}).model_dump_json(), now(), row["id"]),
            )
    conn.commit()
