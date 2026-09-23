"""Dashboards: stored as DashboardSpec JSON. The starter dashboards in seed/dashboards.yaml are
inserted once, the first time the store has none, so deleting one keeps it deleted."""

import sqlite3
import uuid

import yaml
from pydantic import TypeAdapter

from intelmonitor.config import SEED_DIR
from intelmonitor.server.custom_questions import keep_ids
from intelmonitor.server.queries import NotFoundError, now
from intelmonitor.server.widgets import CUSTOM_PREFIX, Dashboard, DashboardSpec, QuestionWidget
from intelmonitor.store.db import get_meta, set_meta


class StarterDashboard(DashboardSpec):
    id: str


def seed_dashboards(conn: sqlite3.Connection) -> None:
    if get_meta(conn, "dashboards_seeded"):
        return
    raw = yaml.safe_load((SEED_DIR / "dashboards.yaml").read_text())
    for position, d in enumerate(TypeAdapter(list[StarterDashboard]).validate_python(raw)):
        spec = DashboardSpec.model_validate(d.model_dump(exclude={"id"}))
        _insert(conn, d.id, spec, starter=True, position=position)
    set_meta(conn, "dashboards_seeded", now())


def _insert(
    conn: sqlite3.Connection, dashboard_id: str, spec: DashboardSpec, starter: bool, position: int
) -> None:
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
    rows = conn.execute("SELECT * FROM dashboards ORDER BY position, created_at").fetchall()
    return [_from_row(r) for r in rows]


def get_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> Dashboard:
    row = conn.execute("SELECT * FROM dashboards WHERE id = ?", (dashboard_id,)).fetchone()
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
    _keep_custom_questions(conn, spec)
    cursor = conn.execute(
        "UPDATE dashboards SET spec = ?, updated_at = ? WHERE id = ?",
        (spec.model_dump_json(), now(), dashboard_id),
    )
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"dashboard {dashboard_id}")
    return get_dashboard(conn, dashboard_id)


def delete_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> None:
    cursor = conn.execute("DELETE FROM dashboards WHERE id = ?", (dashboard_id,))
    conn.commit()
    if cursor.rowcount == 0:
        raise NotFoundError(f"dashboard {dashboard_id}")
