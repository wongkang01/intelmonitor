"""Jev (TypeSafe System One) through OpenRouter."""

from collections.abc import Mapping
from functools import lru_cache

from typesafe_sdk import AsyncTypeSafeClient, Question, SystemOneResponse

from intelmonitor.config import get_settings


@lru_cache
def jev_client() -> AsyncTypeSafeClient:
    settings = get_settings()
    return AsyncTypeSafeClient(
        api_key=settings.openrouter_api_key,
        base_url=settings.typesafe_base_url,
        model=settings.typesafe_default_model,
    )


async def ask_jev(state: str, questions: Mapping[str, Question]) -> SystemOneResponse:
    """One System One call: every question is answered against the same state (fan-out)."""
    # The SDK's recursive JSONContent alias is opaque to pyright; the call itself is typed.
    return await jev_client().system_one(state, questions)  # pyright: ignore[reportUnknownMemberType]
