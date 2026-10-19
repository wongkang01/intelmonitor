"""Jev (TypeSafe System One) through OpenRouter."""

import asyncio
from collections.abc import Mapping
from weakref import WeakKeyDictionary

from typesafe_sdk import AsyncTypeSafeClient, Question, SystemOneResponse

from intelmonitor.config import get_settings

# The SDK default (10 s) is too short for a full screening fan-out over a long document.
JEV_TIMEOUT_SECONDS = 180.0

# One client per event loop: its connection pool is bound to the loop it first ran on, and
# `im run --both` and the server's "Run now" each start a fresh loop for every run.
_clients: WeakKeyDictionary[asyncio.AbstractEventLoop, AsyncTypeSafeClient] = WeakKeyDictionary()


def jev_client() -> AsyncTypeSafeClient:
    loop = asyncio.get_running_loop()
    if (client := _clients.get(loop)) is None:
        settings = get_settings()
        client = _clients[loop] = AsyncTypeSafeClient(
            api_key=settings.openrouter_api_key,
            base_url=settings.typesafe_base_url,
            model=settings.typesafe_default_model,
            timeout=JEV_TIMEOUT_SECONDS,
        )
    return client


async def ask_jev(state: str, questions: Mapping[str, Question]) -> SystemOneResponse:
    """One System One call: every question is answered against the same state (fan-out)."""
    # The SDK's recursive JSONContent alias is opaque to pyright; the call itself is typed.
    return await jev_client().system_one(state, questions)  # pyright: ignore[reportUnknownMemberType]
