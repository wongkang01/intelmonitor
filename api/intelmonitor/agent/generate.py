"""Generate agent over AG-UI. Phase 3 stub: it streams a well-formed AG-UI run that echoes the
dashboard state and says the agent is not wired yet. Phase 6 replaces `run_generate` with the
Claude Agent SDK agent and its dashboard tools."""

import uuid
from collections.abc import AsyncIterator

from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder

STUB_REPLY = "Generate is not connected yet. Use Build to add widgets for now."


async def run_generate(run: RunAgentInput) -> AsyncIterator[BaseEvent]:
    yield RunStartedEvent(thread_id=run.thread_id, run_id=run.run_id)
    yield StateSnapshotEvent(snapshot=run.state)
    message_id = uuid.uuid4().hex
    yield TextMessageStartEvent(message_id=message_id, role="assistant")
    yield TextMessageContentEvent(message_id=message_id, delta=STUB_REPLY)
    yield TextMessageEndEvent(message_id=message_id)
    yield RunFinishedEvent(thread_id=run.thread_id, run_id=run.run_id)


async def encode_events(run: RunAgentInput) -> AsyncIterator[str]:
    encoder = EventEncoder()
    async for event in run_generate(run):
        yield encoder.encode(event)
