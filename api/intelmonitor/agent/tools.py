"""Dashboard tools for the Generate agent. `DashboardEditor` holds the draft for one run: each
tool validates its arguments against the widget schemas, edits the draft, and reports the edit as
a JSON Patch on the AG-UI state `{"widgets": [...]}` plus a plain-words change line."""

import json
import uuid
from collections.abc import Callable
from typing import Any, get_args

from claude_agent_sdk import SdkMcpTool, create_sdk_mcp_server, tool
from claude_agent_sdk.types import McpSdkServerConfig
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from intelmonitor.pipeline.subjects import all_subjects, questions_for
from intelmonitor.server import custom_questions as cq
from intelmonitor.server.models import State
from intelmonitor.server.queries import NoRunError, Queries, subject_links
from intelmonitor.server.series import default_series, mapped_series
from intelmonitor.server.widgets import CUSTOM_PREFIX, Widget, WidgetType, catalog
from intelmonitor.store.db import connect

SERVER_NAME = "dashboard"
SIZE_WORD = {"S": "small", "M": "medium", "L": "large"}
STATE_LABEL: dict[State, str] = {
    "stable": "Stable",
    "watch": "Watch",
    "needs_attention": "Needs attention",
    "new": "New",
}
_WIDGET = TypeAdapter[Widget](Widget)


class DraftState(BaseModel):
    """The AG-UI shared state: the dashboard being built, widgets in layout order."""

    widgets: list[Widget] = Field(default_factory=list[Widget])


# JSON Patch operations (RFC 6902) on DraftState, sent as AG-UI STATE_DELTA events.
PatchOp = dict[str, Any]
ToolResult = dict[str, Any]


def _ok(text: str) -> ToolResult:
    return {"content": [{"type": "text", "text": text}]}


def _error(text: str) -> ToolResult:
    return {"content": [{"type": "text", "text": text}], "is_error": True}


def _validation_message(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors(include_url=False)
    )


def widget_name(widget_type: str) -> str:
    return next((t.name for t in catalog() if t.type == widget_type), widget_type)


def _question_label(subject_id: str, question_id: str) -> str | None:
    if not question_id.startswith(CUSTOM_PREFIX):
        return next(
            (q.label for q in questions_for(all_subjects()[subject_id]) if q.id == question_id),
            None,
        )
    conn = connect()
    try:
        row = conn.execute(
            "SELECT label FROM custom_questions WHERE id = ?", (question_id,)
        ).fetchone()
        return f"{row['label']}, custom" if row else None
    finally:
        conn.close()


def describe(widget: Widget) -> str:
    """Plain words for a widget, such as "Standing question (Enforcement), small, Banking
    regulation"."""
    subjects = all_subjects()
    name = widget_name(widget.type)
    parts = [SIZE_WORD[widget.size]]
    if widget.type == "question":
        label = _question_label(widget.settings.subject_id, widget.settings.question_id)
        name = f"{name} ({label})" if label else name
        parts.append(subjects[widget.settings.subject_id].name)
    elif widget.type == "indicator":
        name = f"{name} ({widget.settings.series().name})"
        parts.append(subjects[widget.settings.subject_id or ""].name)
    elif widget.type == "watchlist":
        names = [subjects[e].name for e in widget.settings.entity_ids]
        more = f" and {len(names) - 3} more" if len(names) > 3 else ""
        parts.append(", ".join(names[:3]) + more)
    elif widget.settings.subject_id:
        parts.append(subjects[widget.settings.subject_id].name)
    return f"{name}, {', '.join(parts)}"


def compact(widgets: list[Widget]) -> str:
    """The layout as the agent sees it: one line per widget in order."""
    if not widgets:
        return "(empty)"
    return "\n".join(
        f"{i}. id={w.id} type={w.type} size={w.size} "
        f"settings={json.dumps(w.settings.model_dump(exclude_none=True))} ({describe(w)})"
        for i, w in enumerate(widgets)
    )


class DashboardEditor:
    """One run's draft. `on_patch` receives each edit's JSON Patch as it happens."""

    def __init__(self, widgets: list[Widget], on_patch: Callable[[list[PatchOp]], None]) -> None:
        self.widgets = list(widgets)
        self.changes: list[str] = []
        self._on_patch = on_patch

    def _index(self, widget_id: str) -> int | None:
        return next((i for i, w in enumerate(self.widgets) if w.id == widget_id), None)

    def _state(self) -> str:
        return f"Dashboard now:\n{compact(self.widgets)}"

    def add(
        self, widget_type: str, size: str, settings: dict[str, Any], position: int | None
    ) -> ToolResult:
        try:
            widget = _WIDGET.validate_python(
                {
                    "id": f"w-{uuid.uuid4().hex[:8]}",
                    "order": 0,
                    "type": widget_type,
                    "size": size,
                    "settings": settings,
                }
            )
        except ValidationError as e:
            return _error(f"Invalid widget: {_validation_message(e)}")
        at = len(self.widgets) if position is None else max(0, min(position, len(self.widgets)))
        self.widgets.insert(at, widget)
        self.changes.append(f"Added {describe(widget)}.")
        self._on_patch([{"op": "add", "path": f"/widgets/{at}", "value": _dump(widget)}])
        return _ok(f"Added {widget.id}. {self._state()}")

    async def add_custom(
        self, text: str, subject_id: str, size: str, position: int | None
    ) -> ToolResult:
        """Drafts a custom question (config plus answers for every run) and adds its widget."""
        conn = connect()
        try:
            request = cq.CustomQuestionRequest(text=text, subject_id=subject_id)
            draft = await cq.create_draft(Queries(conn), request)
        except ValidationError as e:
            return _error(f"Invalid question: {_validation_message(e)}")
        except cq.CapReachedError as e:
            return _error(f"{e} Suggest the closest built-in widget instead.")
        finally:
            conn.close()
        settings = {"subject_id": draft.subject.id, "question_id": draft.id}
        added = self.add("question", size, settings, position)
        if added.get("is_error"):
            return added
        latest = draft.runs[-1] if draft.runs else None
        answer = f" Latest answer: {STATE_LABEL[latest.state]}, {latest.summary}" if latest else ""
        return _ok(
            f"Drafted custom question {draft.id} ({draft.label}): {draft.question} "
            f"Lookback {draft.lookback_days} days.{answer}\n{added['content'][0]['text']}"
        )

    def update(
        self, widget_id: str, size: str | None, settings: dict[str, Any] | None
    ) -> ToolResult:
        i = self._index(widget_id)
        if i is None:
            return _error(f"No widget {widget_id!r}. {self._state()}")
        old = self.widgets[i]
        merged = {**old.settings.model_dump(), **(settings or {})}
        try:
            widget = _WIDGET.validate_python(
                {**_dump(old), "size": size or old.size, "settings": merged}
            )
        except ValidationError as e:
            return _error(f"Invalid update: {_validation_message(e)}")
        if widget == old:
            return _ok(f"No change. {self._state()}")
        self.widgets[i] = widget
        self.changes.append(f"Changed {describe(widget)}.")
        self._on_patch([{"op": "replace", "path": f"/widgets/{i}", "value": _dump(widget)}])
        return _ok(f"Updated {widget_id}. {self._state()}")

    def remove(self, widget_id: str) -> ToolResult:
        i = self._index(widget_id)
        if i is None:
            return _error(f"No widget {widget_id!r}. {self._state()}")
        removed = self.widgets.pop(i)
        self.changes.append(f"Removed {describe(removed)}.")
        self._on_patch([{"op": "remove", "path": f"/widgets/{i}"}])
        return _ok(f"Removed {widget_id}. {self._state()}")

    def reorder(self, ids: list[str]) -> ToolResult:
        current = [w.id for w in self.widgets]
        if sorted(ids) != sorted(current):
            return _error(f"ids must list every widget exactly once. {self._state()}")
        if ids == current:
            return _ok(f"No change. {self._state()}")
        by_id = {w.id: w for w in self.widgets}
        self.widgets = [by_id[i] for i in ids]
        self.changes.append("Rearranged the widgets.")
        self._on_patch(
            [{"op": "replace", "path": "/widgets", "value": [_dump(w) for w in self.widgets]}]
        )
        return _ok(f"Reordered. {self._state()}")


def _dump(widget: Widget) -> dict[str, Any]:
    return widget.model_dump(mode="json")


def list_subjects(subject_ids: list[str] | None) -> ToolResult:
    """Every subject with its links and new-development counts; with `subject_ids`, those
    subjects only, each with its standing questions and their current answer state, and its listed
    series (the default one flagged) for indicator widgets."""
    subjects = all_subjects()
    unknown = [i for i in subject_ids or [] if i not in subjects]
    if unknown:
        return _error(f"Unknown subject ids: {', '.join(unknown)}")
    conn = connect()
    try:
        q = Queries(conn)
        out: list[dict[str, Any]] = []
        for sid in subject_ids or list(subjects):
            s = subjects[sid]
            summary = q.subject_summary(sid)
            links = subject_links(sid)
            row: dict[str, Any] = {
                "id": s.id,
                "name": s.name,
                "type": s.type,
                "kind": s.kind,
                "topics": [t.id for t in links.topics],
                "groups": [g.id for g in links.groups],
                "entities": [e.id for e in links.entities],
                "new_developments": summary.new_developments,
                "needs_attention": summary.needs_attention,
            }
            if subject_ids:
                row["questions"] = [
                    {
                        "id": a.question_id,
                        "label": a.label,
                        "state": STATE_LABEL[a.state],
                        **({"custom": True, "question": a.question} if a.custom else {}),
                    }
                    for a in q.answers(sid)
                ]
                default = default_series(sid)
                row["series"] = [
                    {
                        "id": d.id,
                        "name": d.name,
                        "role": role,
                        **({"default": True} if d == default else {}),
                    }
                    for d, role in mapped_series(sid)
                    if d.listed
                ]
            out.append(row)
        return _ok(json.dumps(out))
    except NoRunError as e:
        return _error(str(e))
    finally:
        conn.close()


_WIDGET_TYPES = list(get_args(WidgetType))
_SETTINGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": "The widget type's settings; see the catalog in the system prompt.",
    "properties": {
        "subject_id": {"type": "string", "description": "A subject id from list_subjects"},
        "question_id": {"type": "string", "description": "Standing question widgets only"},
        "series_id": {
            "type": "string",
            "description": "Indicator widgets only: a series id from list_subjects",
        },
        "entity_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Watchlist widgets only: entity ids in display order",
        },
    },
}


def build_server(editor: DashboardEditor) -> tuple[McpSdkServerConfig, list[str]]:
    """The in-process MCP server over `editor`, and the tool names to allow."""

    @tool(
        "add_widget",
        "Add a widget. Arguments are checked against the widget's schema; an invalid call "
        "returns the reason so you can fix it.",
        {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": _WIDGET_TYPES},
                "size": {"type": "string", "enum": ["S", "M", "L"]},
                "settings": _SETTINGS_SCHEMA,
                "position": {
                    "type": "integer",
                    "description": "0-based index in the layout order; omit to append",
                },
            },
            "required": ["type", "size", "settings"],
        },
    )
    async def add_widget(args: dict[str, Any]) -> ToolResult:
        return editor.add(args["type"], args["size"], args["settings"], args.get("position"))

    @tool(
        "update_widget",
        "Change a widget's size or settings. Settings given are merged into the current ones.",
        {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "size": {"type": "string", "enum": ["S", "M", "L"]},
                "settings": _SETTINGS_SCHEMA,
            },
            "required": ["id"],
        },
    )
    async def update_widget(args: dict[str, Any]) -> ToolResult:
        return editor.update(args["id"], args.get("size"), args.get("settings"))

    @tool(
        "remove_widget",
        "Remove a widget.",
        {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
    )
    async def remove_widget(args: dict[str, Any]) -> ToolResult:
        return editor.remove(args["id"])

    @tool(
        "reorder",
        "Set the layout order. List every widget id exactly once, first = top left.",
        {
            "type": "object",
            "properties": {"ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["ids"],
        },
    )
    async def reorder(args: dict[str, Any]) -> ToolResult:
        return editor.reorder(list(args["ids"]))

    @tool(
        "list_subjects",
        "List topics, groups and entities with their ids, links and new-development counts. "
        "Pass subject_ids to also get those subjects' standing questions and answer states, "
        "and their measured series for Indicator widgets.",
        {
            "type": "object",
            "properties": {"subject_ids": {"type": "array", "items": {"type": "string"}}},
        },
    )
    async def list_subjects_tool(args: dict[str, Any]) -> ToolResult:
        ids = args.get("subject_ids")
        return list_subjects(list(ids) if ids else None)

    @tool(
        "create_custom_widget",
        "Create a custom standing question for an angle no standing question covers, and add a "
        "Standing question widget that shows it. The question is drafted and answered for "
        "every run, which takes up to a minute. It becomes the user's once they keep the "
        "change and create the dashboard.",
        {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The angle in the user's words, as one question",
                },
                "subject_id": {"type": "string", "description": "A subject id"},
                "size": {"type": "string", "enum": ["S", "M"]},
                "position": {
                    "type": "integer",
                    "description": "0-based index in the layout order; omit to append",
                },
            },
            "required": ["question", "subject_id"],
        },
    )
    async def create_custom_widget(args: dict[str, Any]) -> ToolResult:
        return await editor.add_custom(
            str(args["question"]),
            str(args["subject_id"]),
            str(args.get("size") or "S"),
            args.get("position"),
        )

    tools: list[SdkMcpTool[Any]] = [
        add_widget,
        update_widget,
        remove_widget,
        reorder,
        list_subjects_tool,
        create_custom_widget,
    ]
    server = create_sdk_mcp_server(SERVER_NAME, tools=tools)
    return server, [f"mcp__{SERVER_NAME}__{t.name}" for t in tools]
