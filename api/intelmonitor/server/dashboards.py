"""Dashboards: stored as DashboardSpec JSON. The starter dashboards in seed/dashboards.yaml are
inserted once, the first time the store has none, so deleting one keeps it deleted.
Every stored dashboard has a color, so reordering the sidebar never recolors one.
Deleting sets deleted_at and restoring clears it; every read skips deleted dashboards. A deleted
dashboard keeps its position, so an Undo puts it back where it was. The API purges it a day later
(purge_deleted in store/db.py). Reads leave out widgets that name a series no longer in the seed,
and skip a dashboard that names a subject no longer in it; it stays stored and comes back with it.
A dashboard made under a profile belongs to it: the sidebar lists the active profile's
dashboards plus those no profile made (the starter and older ones)."""

import json
import sqlite3
import uuid
from collections import Counter

import yaml
from pydantic import TypeAdapter, ValidationError

from intelmonitor.config import SEED_DIR
from intelmonitor.pipeline.subjects import all_subjects
from intelmonitor.server.custom_questions import keep_ids
from intelmonitor.server.queries import NotFoundError, now
from intelmonitor.server.widgets import (
    CUSTOM_PREFIX,
    DASHBOARD_COLORS,
    Dashboard,
    DashboardColor,
    DashboardSpec,
    QuestionWidget,
    SinceSettings,
    SinceWidget,
    WatchlistSettings,
    WatchlistWidget,
    Widget,
)
from intelmonitor.store.db import get_meta, set_meta


class StarterDashboard(DashboardSpec):
    id: str


class OrderError(ValueError):
    """A new sidebar order that is not exactly the listed dashboards."""


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
        if (spec := _stored_spec(row["spec"])) is None:
            continue
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
    conn: sqlite3.Connection,
    dashboard_id: str,
    spec: DashboardSpec,
    starter: bool,
    position: int,
    profile_id: str | None = None,
) -> None:
    if spec.color is None:
        spec = spec.model_copy(update={"color": _next_color(conn)})
    at = now()
    conn.execute(
        "INSERT OR IGNORE INTO dashboards "
        "(id, spec, starter, position, created_at, updated_at, profile_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (dashboard_id, spec.model_dump_json(), int(starter), position, at, at, profile_id),
    )
    conn.commit()


def _stored_spec(raw: str) -> DashboardSpec | None:
    """A stored spec without the widgets that no longer validate (an indicator whose series left
    its subject), or None when the dashboard itself names a subject removed from the seed."""
    try:
        return DashboardSpec.model_validate_json(raw)
    except ValidationError:
        pass
    data = json.loads(raw)
    data["widgets"] = [w for w in data.get("widgets", []) if _valid_widget(w)]
    try:
        return DashboardSpec.model_validate(data)
    except ValidationError:
        return None


def _valid_widget(widget: object) -> bool:
    try:
        _WIDGET.validate_python(widget)
    except ValidationError:
        return False
    return True


_WIDGET: TypeAdapter[Widget] = TypeAdapter(Widget)


def _from_row(row: sqlite3.Row) -> Dashboard | None:
    if (spec := _stored_spec(row["spec"])) is None:
        return None
    return Dashboard(
        **spec.model_dump(),
        id=row["id"],
        starter=bool(row["starter"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_dashboards(conn: sqlite3.Connection) -> list[Dashboard]:
    """Every dashboard, whichever profile made it."""
    rows = conn.execute(
        "SELECT * FROM dashboards WHERE deleted_at IS NULL ORDER BY position, created_at"
    ).fetchall()
    return [d for r in rows if (d := _from_row(r)) is not None]


def profile_dashboards(conn: sqlite3.Connection, profile_id: str | None) -> list[Dashboard]:
    """The sidebar's dashboards: the profile's own and those no profile made."""
    rows = conn.execute(
        "SELECT * FROM dashboards WHERE deleted_at IS NULL "
        "AND (profile_id IS NULL OR profile_id = ?) ORDER BY position, created_at",
        (profile_id,),
    ).fetchall()
    return [d for r in rows if (d := _from_row(r)) is not None]


def get_dashboard(conn: sqlite3.Connection, dashboard_id: str) -> Dashboard:
    row = conn.execute(
        "SELECT * FROM dashboards WHERE id = ? AND deleted_at IS NULL", (dashboard_id,)
    ).fetchone()
    if row is None or (dashboard := _from_row(row)) is None:
        raise NotFoundError(f"dashboard {dashboard_id}")
    return dashboard


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


def _default_widgets(subject_ids: list[str]) -> list[Widget]:
    """Widgets for a dashboard made by picking subjects, until the fixed dashboard layout replaces
    the widget grid: what changed, and a watchlist of its entities."""
    entities = [i for i in subject_ids if all_subjects()[i].type == "entity"]
    widgets: list[Widget] = [
        SinceWidget(id="since", order=0, type="since", size="L", settings=SinceSettings())
    ]
    if entities:
        widgets.append(
            WatchlistWidget(
                id="watchlist",
                order=1,
                type="watchlist",
                size="L",
                settings=WatchlistSettings(entity_ids=entities),
            )
        )
    return widgets


def create_dashboard(
    conn: sqlite3.Connection, spec: DashboardSpec, profile_id: str | None = None
) -> Dashboard:
    """Stores a new dashboard last in the sidebar. A spec with no widgets gets the default ones."""
    if not spec.widgets:
        spec = spec.model_copy(update={"widgets": _default_widgets(spec.subject_ids)})
    _keep_custom_questions(conn, spec)
    dashboard_id = uuid.uuid4().hex[:12]
    position = conn.execute("SELECT coalesce(max(position), -1) + 1 FROM dashboards").fetchone()[0]
    _insert(conn, dashboard_id, spec, starter=False, position=position, profile_id=profile_id)
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


def reorder_dashboards(
    conn: sqlite3.Connection, ids: list[str], profile_id: str | None
) -> list[Dashboard]:
    """Rewrites the sidebar order: `ids` lists every dashboard the profile sees once, first to
    last."""
    listed = {d.id for d in profile_dashboards(conn, profile_id)}
    if len(ids) != len(set(ids)) or set(ids) != listed:
        raise OrderError("the order must list every dashboard exactly once")
    conn.executemany(
        "UPDATE dashboards SET position = ? WHERE id = ?", [(i, d) for i, d in enumerate(ids)]
    )
    conn.commit()
    return profile_dashboards(conn, profile_id)


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
        if (spec := _stored_spec(row["spec"])) is None:
            continue
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
