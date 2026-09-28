"""Generate agent over AG-UI. Claude (Claude Agent SDK) edits the dashboard draft through the
in-process tools in `tools.py`; this module maps the SDK stream to AG-UI events:
TEXT_MESSAGE_* for Claude's words, TOOL_CALL_* for each tool call as it is written, and
STATE_DELTA (JSON Patch on `{"widgets": [...]}`) for each edit as it lands.

The server is stateless: every run gets the conversation and the current draft from the page
(`RunAgentInput.messages` and `.state`), so manual edits made between prompts are what the agent
sees. After Claude's reply, one more text message lists the run's changes in plain words."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateDeltaEvent,
    StateSnapshotEvent,
    SystemMessage,
    TextInputContent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
    UserMessage,
)
from ag_ui.encoder import EventEncoder
from claude_agent_sdk import (
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    ToolResultBlock,
    query,
)
from claude_agent_sdk import UserMessage as SdkUserMessage
from pydantic import ValidationError

from intelmonitor.agent.tools import SERVER_NAME, DashboardEditor, DraftState, build_server, compact
from intelmonitor.config import get_settings
from intelmonitor.pipeline.claude import scrub_parent_env
from intelmonitor.server.widgets import catalog

MAX_TURNS = 24
_TOOL_PREFIX = f"mcp__{SERVER_NAME}__"


def _catalog_text() -> str:
    lines: list[str] = []
    for t in catalog():
        props = t.settings_schema.get("properties", {})
        required = t.settings_schema.get("required", [])
        assert isinstance(props, dict) and isinstance(required, list)
        settings = ", ".join(
            f"{name}{'' if name in required else ' (optional)'}"
            + (
                f": {spec['description']}"
                if isinstance(spec, dict) and spec.get("description")
                else ""
            )
            for name, spec in props.items()
        )
        lines.append(
            f'- {t.type} "{t.name}": {t.description}. Sizes {"/".join(t.sizes)}. '
            f"Settings: {settings}."
        )
    return "\n".join(lines)


SYSTEM = f"""You build IntelMonitor dashboards for a financial supervision analyst. You change the \
dashboard only through your tools. You never write UI code and never invent widget types.

Layout: a 4-column grid packed from the top left in widget order. Sizes: S is 1x1, M is 2x1, L \
is 2x2. You choose type, size and order; the app places the widgets.

Widget types:
{_catalog_text()}

Subjects are topics, groups and entities with ids such as "singapore-banks" or "ocbc". Call \
list_subjects first to find ids; pass subject_ids to see a subject's standing questions and \
their states, and its measured series (pegs, supply, rates, FX, banking ratios) for Indicator \
widgets. Use only ids the tools return.

A new dashboard usually has 5 to 8 widgets: "Since your last review" (L) first, with no \
subject_id so it covers every subject on the dashboard; a Watchlist (L) of the members when a \
group or several entities are involved; a Monitor summary (M) for each main subject; Direction \
of travel and Upcoming (S) for the main topic; Developments (M); and a Standing question (S) on \
the most pressing question (Needs attention, then Watch). Mix sizes so the grid packs \
without gaps.

Follow-up requests edit the current dashboard in place: update, remove or reorder existing \
widgets by id, and add only what is asked. Rebuild from scratch only when the user asks for a \
different dashboard.

If a request does not fit the catalog, add the closest widget and say so. When the user wants \
an angle no standing question covers (check the subject's questions with list_subjects), call \
create_custom_widget with that angle as one question and the subject it is about: it drafts a \
custom standing question, answers it and adds a Standing question widget for it. When the angle \
is about a measured series of the subject (an exchange rate such as the SGD against the ringgit, \
a peg, a ratio), pass its ids from list_subjects as series_ids: the answers then get the \
series' facts, and at M the widget shows the first series' line beside the answer. Create at \
most two per request.

Write no text before or between tool calls. When done, reply with one plain sentence of at most \
25 words on what the dashboard is for. Do not recap the widgets or use lists or markdown: the \
app lists each change itself."""


def _user_text(message: UserMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    return " ".join(p.text for p in message.content if isinstance(p, TextInputContent))


def _result_text(block: ToolResultBlock) -> str:
    content = block.content
    return content if isinstance(content, str) else json.dumps(content) if content else ""


def build_prompt(run: RunAgentInput, draft: DraftState) -> str:
    """The conversation so far, the current draft, and the latest request."""
    turns: list[str] = []
    for m in run.messages:
        if isinstance(m, UserMessage):
            turns.append(f"User: {_user_text(m)}")
        elif isinstance(m, AssistantMessage) and m.content:
            turns.append(f"You: {m.content}")
        elif isinstance(m, SystemMessage):
            turns.append(f"(Note: {m.content})")
    request = turns.pop() if turns and turns[-1].startswith("User: ") else "User: (no request)"
    history = "\n".join(turns) or "(none)"
    return (
        f"Conversation so far:\n{history}\n\n"
        f"Current dashboard, in layout order (includes the user's manual edits):\n"
        f"{compact(draft.widgets)}\n\n"
        f"Latest request:\n{request.removeprefix('User: ')}"
    )


class _StreamMapper:
    """Turns raw Anthropic stream events from the SDK into AG-UI text and tool call events."""

    def __init__(self, emit: Callable[[BaseEvent], None]) -> None:
        self._emit = emit
        self._blocks: dict[int, tuple[str, str]] = {}  # content index -> (kind, AG-UI id)

    def handle(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "message_start":
            self._blocks.clear()
        elif kind == "content_block_start":
            block = event["content_block"]
            if block["type"] == "text":
                message_id = uuid.uuid4().hex
                self._blocks[event["index"]] = ("text", message_id)
                self._emit(TextMessageStartEvent(message_id=message_id, role="assistant"))
            elif block["type"] == "tool_use":
                self._blocks[event["index"]] = ("tool", block["id"])
                self._emit(
                    ToolCallStartEvent(
                        tool_call_id=block["id"],
                        tool_call_name=str(block["name"]).removeprefix(_TOOL_PREFIX),
                    )
                )
        elif kind == "content_block_delta":
            block = self._blocks.get(event["index"])
            delta = event["delta"]
            if block and block[0] == "text" and delta.get("text"):
                self._emit(TextMessageContentEvent(message_id=block[1], delta=delta["text"]))
            elif block and block[0] == "tool" and delta.get("partial_json"):
                self._emit(ToolCallArgsEvent(tool_call_id=block[1], delta=delta["partial_json"]))
        elif kind == "content_block_stop":
            block = self._blocks.pop(event["index"], None)
            if block and block[0] == "text":
                self._emit(TextMessageEndEvent(message_id=block[1]))
            elif block:
                self._emit(ToolCallEndEvent(tool_call_id=block[1]))

    def close(self) -> None:
        """Ends anything left open, so the run can finish cleanly."""
        for kind, block_id in self._blocks.values():
            if kind == "text":
                self._emit(TextMessageEndEvent(message_id=block_id))
            else:
                self._emit(ToolCallEndEvent(tool_call_id=block_id))
        self._blocks.clear()


def _say(emit: Callable[[BaseEvent], None], text: str) -> None:
    message_id = uuid.uuid4().hex
    emit(TextMessageStartEvent(message_id=message_id, role="assistant"))
    emit(TextMessageContentEvent(message_id=message_id, delta=text))
    emit(TextMessageEndEvent(message_id=message_id))


async def _drive(run: RunAgentInput, draft: DraftState, emit: Callable[[BaseEvent], None]) -> None:
    editor = DashboardEditor(
        draft.widgets,
        lambda ops: emit(StateDeltaEvent.model_validate({"delta": ops})),
    )
    server, allowed = build_server(editor)
    scrub_parent_env()
    options = ClaudeAgentOptions(
        model=get_settings().anthropic_model,
        system_prompt=SYSTEM,
        tools=[],
        mcp_servers={SERVER_NAME: server},
        allowed_tools=allowed,
        # No user settings, account connectors or skills: only the dashboard tools.
        setting_sources=[],
        strict_mcp_config=True,
        skills=[],
        include_partial_messages=True,
        max_turns=MAX_TURNS,
    )
    mapper = _StreamMapper(emit)
    result: ResultMessage | None = None
    async for message in query(prompt=build_prompt(run, draft), options=options):
        if isinstance(message, StreamEvent) and message.parent_tool_use_id is None:
            mapper.handle(message.event)
        elif isinstance(message, SdkUserMessage) and isinstance(message.content, list):
            for block in message.content:
                if isinstance(block, ToolResultBlock):
                    emit(
                        ToolCallResultEvent(
                            message_id=uuid.uuid4().hex,
                            tool_call_id=block.tool_use_id,
                            content=_result_text(block),
                        )
                    )
        elif isinstance(message, ResultMessage):
            result = message
    mapper.close()
    if result is None or result.is_error:
        raise RuntimeError(result.result if result and result.result else "the agent stopped")
    if editor.changes:
        _say(emit, "\n".join(editor.changes))
    elif not result.result:
        _say(emit, "No changes.")


async def run_generate(run: RunAgentInput) -> AsyncIterator[BaseEvent]:
    yield RunStartedEvent(thread_id=run.thread_id, run_id=run.run_id)
    try:
        draft = DraftState.model_validate(run.state or {})
    except ValidationError as e:
        yield RunErrorEvent(message=f"The dashboard state is invalid: {e.error_count()} errors")
        return
    yield StateSnapshotEvent(snapshot=draft.model_dump(mode="json"))

    queue: asyncio.Queue[BaseEvent | None] = asyncio.Queue()
    failed: list[str] = []

    async def drive() -> None:
        try:
            await _drive(run, draft, queue.put_nowait)
        except Exception as e:  # reported to the page as RUN_ERROR
            failed.append(str(e) or type(e).__name__)
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(drive())
    try:
        while (event := await queue.get()) is not None:
            yield event
        await task
    finally:
        task.cancel()  # the page closed the stream
    if failed:
        yield RunErrorEvent(message=f"Generate failed: {failed[0]}")
    else:
        yield RunFinishedEvent(thread_id=run.thread_id, run_id=run.run_id)


async def encode_events(run: RunAgentInput) -> AsyncIterator[str]:
    encoder = EventEncoder()
    async for event in run_generate(run):
        yield encoder.encode(event)
